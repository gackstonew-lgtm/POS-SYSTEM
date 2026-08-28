const https = require('https');
const { getSupabaseClient, jsonResponse } = require('./db');
const { verifyTokenFromHeader } = require('./auth');

const MPESA_ENV = process.env.MPESA_ENVIRONMENT || 'sandbox';
const MPESA_KEY = process.env.MPESA_CONSUMER_KEY || '';
const MPESA_SECRET = process.env.MPESA_CONSUMER_SECRET || '';
const MPESA_SHORTCODE = process.env.MPESA_SHORTCODE || '';
const MPESA_PASSKEY = process.env.MPESA_PASSKEY || '';
const MPESA_CALLBACK_URL = process.env.MPESA_CALLBACK_URL || '';

function getMpesaBaseUrl() {
  return MPESA_ENV === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';
}

function normalizeKenyanPhone(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;

  if (digits.length === 10 && digits.startsWith('0')) {
    digits = '254' + digits.slice(1);
  } else if (digits.length === 9 && (digits.startsWith('7') || digits.startsWith('1'))) {
    digits = '254' + digits;
  }

  return /^254(7|1)\d{8}$/.test(digits) ? digits : null;
}

let cachedToken = null;
let tokenExpiresAt = 0;

function httpRequest(url, method = 'GET', payload = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (res.statusCode >= 400) {
            const msg = parsed.errorMessage || parsed.ResponseDescription || 'M-PESA API error.';
            return reject(new Error(msg));
          }
          resolve(parsed);
        } catch (e) {
          reject(new Error('Invalid JSON response from M-PESA API.'));
        }
      });
    });

    req.on('error', (err) => reject(new Error(`Network error contacting M-PESA: ${err.message}`)));

    if (payload) {
      req.write(JSON.stringify(payload));
    }
    req.end();
  });
}

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && tokenExpiresAt > now + 60) {
    return cachedToken;
  }

  const credentials = Buffer.from(`${MPESA_KEY}:${MPESA_SECRET}`).toString('base64');
  const url = `${getMpesaBaseUrl()}/oauth/v1/generate?grant_type=client_credentials`;

  const response = await httpRequest(url, 'GET', null, {
    Authorization: `Basic ${credentials}`
  });

  if (!response.access_token) {
    throw new Error('Unable to authenticate with M-PESA Daraja.');
  }

  cachedToken = response.access_token;
  const expiresIn = Number(response.expires_in || 3599);
  tokenExpiresAt = now + expiresIn;

  return cachedToken;
}

function getTimestamp() {
  const d = new Date();
  const YYYY = d.getFullYear();
  const MM = String(d.getMonth() + 1).padStart(2, '0');
  const DD = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${YYYY}${MM}${DD}${hh}${mm}${ss}`;
}

function getPassword(timestamp) {
  return Buffer.from(`${MPESA_SHORTCODE}${MPESA_PASSKEY}${timestamp}`).toString('base64');
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(200, { success: true });
  }

  const user = verifyTokenFromHeader(event.headers);
  if (!user) {
    return jsonResponse(401, { success: false, message: 'Unauthorized session.' });
  }

  const params = event.queryStringParameters || {};
  const path = String(event.path || '');
  const client = getSupabaseClient();

  try {
    if (path.endsWith('/status') || params.action === 'status') {
      const saleId = Number(params.sale_id || 0);
      const checkoutRequestId = String(params.checkout_request_id || '').trim();

      if (saleId <= 0 && !checkoutRequestId) {
        return jsonResponse(422, { success: false, message: 'Missing payment reference.' });
      }

      let queryBuilder = client
        .from('mpesa_transactions')
        .select('*, sales!mpesa_transactions_sale_id_fkey(payment_status, reference)');

      if (saleId > 0) {
        queryBuilder = queryBuilder.eq('sale_id', saleId);
      } else {
        queryBuilder = queryBuilder.eq('checkout_request_id', checkoutRequestId);
      }

      queryBuilder = queryBuilder.order('id', { ascending: false }).limit(1);

      const { data: rows, error } = await queryBuilder;

      if (error) {
        throw new Error(error.message);
      }

      const tx = rows && rows.length > 0 ? rows[0] : null;
      if (!tx) {
        return jsonResponse(200, { success: true, status: 'not_found', message: 'Waiting for STK Push to be sent.' });
      }

      const sale = tx.sales;

      return jsonResponse(200, {
        success: true,
        status: tx.status,
        sale_id: tx.sale_id ? Number(tx.sale_id) : null,
        sale_reference: sale ? sale.reference : null,
        payment_status: sale ? sale.payment_status : null,
        receipt_number: tx.receipt_number,
        phone_number: tx.phone_number,
        transaction_date: tx.transaction_date,
        result_code: tx.result_code,
        result_description: tx.result_description
      });
    }

    if (path.endsWith('/token') || params.action === 'token') {
      const token = await getAccessToken();
      return jsonResponse(200, { success: true, access_token: token });
    }

    if (event.httpMethod === 'POST' || path.endsWith('/stkpush')) {
      let body = {};
      try {
        body = JSON.parse(event.body || '{}');
      } catch (e) {
        return jsonResponse(422, { success: false, message: 'Invalid STK push request body.' });
      }

      const saleId = Number(body.sale_id || 0);
      const phoneInput = String(body.phone_number || '').trim();

      if (saleId <= 0) {
        return jsonResponse(422, { success: false, message: 'Missing sale reference.' });
      }

      const normalizedPhone = normalizeKenyanPhone(phoneInput);
      if (!normalizedPhone) {
        return jsonResponse(422, { success: false, message: 'Enter a valid Kenyan phone number, for example 254712345678.' });
      }

      const { data: sales, error: saleError } = await client
        .from('sales')
        .select('id, total, payment_method, payment_status')
        .eq('id', saleId)
        .limit(1);

      if (saleError) {
        throw new Error(saleError.message);
      }

      const sale = sales && sales.length > 0 ? sales[0] : null;

      if (!sale) {
        throw new Error('Sale not found.');
      }
      if (sale.payment_method !== 'mpesa') {
        throw new Error('This sale is not marked as M-PESA.');
      }
      if (sale.payment_status === 'paid') {
        throw new Error('This sale is already paid.');
      }

      const { data: existingTx, error: txError } = await client
        .from('mpesa_transactions')
        .select('*')
        .eq('sale_id', saleId)
        .in('status', ['pending', 'success'])
        .order('id', { ascending: false })
        .limit(1);

      if (txError) {
        throw new Error(txError.message);
      }

      const transaction = existingTx && existingTx.length > 0 ? existingTx[0] : null;

      if (transaction && transaction.status === 'success') {
        throw new Error('This M-PESA payment is already completed.');
      }
      if (transaction && transaction.status === 'pending') {
        return jsonResponse(200, {
          success: true,
          message: 'STK Push already sent. Waiting for customer confirmation.',
          sale_id: saleId,
          checkout_request_id: transaction.checkout_request_id,
          status: 'pending'
        });
      }

      const token = await getAccessToken();
      const timestamp = getTimestamp();
      const password = getPassword(timestamp);

      const stkPayload = {
        BusinessShortCode: MPESA_SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: Math.round(Number(sale.total)),
        PartyA: normalizedPhone,
        PartyB: MPESA_SHORTCODE,
        PhoneNumber: normalizedPhone,
        CallBackURL: MPESA_CALLBACK_URL,
        AccountReference: `SALE-${saleId}`,
        TransactionDesc: 'Karing Enterprise POS Sale'
      };

      const stkResponse = await httpRequest(
        `${getMpesaBaseUrl()}/mpesa/stkpush/v1/processrequest`,
        'POST',
        stkPayload,
        {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      );

      if (stkResponse.ResponseCode !== '0') {
        const msg = stkResponse.errorMessage || stkResponse.ResponseDescription || 'Unable to send STK Push.';
        throw new Error(msg);
      }

      const { error: insertError } = await client
        .from('mpesa_transactions')
        .insert({
          sale_id: saleId,
          merchant_request_id: stkResponse.MerchantRequestID || null,
          checkout_request_id: stkResponse.CheckoutRequestID || null,
          phone_number: normalizedPhone,
          amount: Number(sale.total),
          status: 'pending',
          result_description: stkResponse.CustomerMessage || stkResponse.ResponseDescription || 'STK Push sent.'
        });

      if (insertError) {
        throw new Error(insertError.message);
      }

      return jsonResponse(200, {
        success: true,
        message: 'STK Push sent. Waiting for customer...',
        sale_id: saleId,
        merchant_request_id: stkResponse.MerchantRequestID || null,
        checkout_request_id: stkResponse.CheckoutRequestID || null,
        status: 'pending'
      });
    }

    return jsonResponse(400, { success: false, message: 'Invalid M-PESA operation.' });
  } catch (error) {
    return jsonResponse(500, { success: false, message: error.message || 'M-PESA handler error.' });
  }
};
