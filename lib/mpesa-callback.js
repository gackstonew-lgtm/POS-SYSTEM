const { getSupabaseClient, jsonResponse } = require('./db');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(200, { ResultCode: 0, ResultDesc: 'OK' });
  }

  let payload = {};
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return jsonResponse(200, { ResultCode: 1, ResultDesc: 'Invalid callback payload' });
  }

  const callback = payload.Body?.stkCallback;
  if (!callback) {
    return jsonResponse(200, { ResultCode: 1, ResultDesc: 'Missing stkCallback' });
  }

  const merchantRequestId = String(callback.MerchantRequestID || '');
  const checkoutRequestId = String(callback.CheckoutRequestID || '');
  const resultCode = Number(callback.ResultCode ?? -1);
  const resultDescription = String(callback.ResultDesc || 'No result description');
  const metadataItems = callback.CallbackMetadata?.Item || [];

  const metadata = {};
  if (Array.isArray(metadataItems)) {
    metadataItems.forEach((item) => {
      if (item && item.Name) {
        metadata[String(item.Name)] = item.Value ?? null;
      }
    });
  }

  const receipt = metadata.MpesaReceiptNumber ? String(metadata.MpesaReceiptNumber) : null;
  const phone = metadata.PhoneNumber ? String(metadata.PhoneNumber) : null;
  const amount = metadata.Amount ? Number(metadata.Amount) : null;
  let transactionDate = metadata.TransactionDate ? String(metadata.TransactionDate) : null;

  if (transactionDate && /^\d{14}$/.test(transactionDate)) {
    transactionDate = `${transactionDate.slice(0,4)}-${transactionDate.slice(4,6)}-${transactionDate.slice(6,8)} ${transactionDate.slice(8,10)}:${transactionDate.slice(10,12)}:${transactionDate.slice(12,14)}`;
  }

  let status = 'failed';
  if (resultCode === 0) {
    status = 'success';
  } else if (resultCode === 1032) {
    status = 'cancelled';
  } else if (resultCode === 1037 || resultCode === 1025) {
    status = 'timeout';
  }

  const client = getSupabaseClient();

  try {
    const { data: existingTx, error: txError } = await client
      .from('mpesa_transactions')
      .select('*')
      .eq('checkout_request_id', checkoutRequestId)
      .limit(1);

    if (txError) {
      throw new Error(txError.message);
    }

    const transaction = existingTx && existingTx.length > 0 ? existingTx[0] : null;

    if (!transaction) {
      const { error: insertError } = await client
        .from('mpesa_transactions')
        .insert({
          merchant_request_id: merchantRequestId,
          checkout_request_id: checkoutRequestId,
          receipt_number: receipt,
          phone_number: phone,
          amount: amount || 0,
          status,
          result_code: resultCode,
          result_description: resultDescription,
          transaction_date: transactionDate,
          raw_callback: payload
        });

      if (insertError) {
        throw new Error(insertError.message);
      }

      return jsonResponse(200, { ResultCode: 0, ResultDesc: 'Callback stored without matching sale' });
    }

    const alreadySuccessful = (transaction.status === 'success');

    const { error: updateError } = await client
      .from('mpesa_transactions')
      .update({
        merchant_request_id: merchantRequestId,
        receipt_number: receipt || transaction.receipt_number,
        phone_number: phone || transaction.phone_number,
        amount: amount || transaction.amount,
        status,
        result_code: resultCode,
        result_description: resultDescription,
        transaction_date: transactionDate || transaction.transaction_date,
        raw_callback: payload
      })
      .eq('id', transaction.id);

    if (updateError) {
      throw new Error(updateError.message);
    }

    if (status === 'success' && !alreadySuccessful) {
      const saleId = Number(transaction.sale_id);

      const { data: sales, error: saleError } = await client
        .from('sales')
        .select('payment_status')
        .eq('id', saleId)
        .limit(1);

      if (saleError) {
        throw new Error(saleError.message);
      }

      const sale = sales && sales.length > 0 ? sales[0] : null;

      if (sale && sale.payment_status !== 'paid') {
        const { data: items, error: itemsError } = await client
          .from('sale_items')
          .select('product_id, quantity')
          .eq('sale_id', saleId);

        if (itemsError) {
          throw new Error(itemsError.message);
        }

        for (const item of (items || [])) {
          const { data: products, error: productError } = await client
            .from('products')
            .select('stock_quantity, name')
            .eq('id', item.product_id)
            .limit(1);

          if (productError) {
            throw new Error(productError.message);
          }

          const product = products && products.length > 0 ? products[0] : null;

          if (!product || Number(product.stock_quantity) < Number(item.quantity)) {
            throw new Error('Insufficient stock while completing M-PESA sale.');
          }

          const { error: stockUpdateError } = await client
            .from('products')
            .update({ stock_quantity: Number((Number(product.stock_quantity) - Number(item.quantity)).toFixed(4)) })
            .eq('id', item.product_id);

          if (stockUpdateError) {
            throw new Error(stockUpdateError.message);
          }
        }

        const { error: saleUpdateError } = await client
          .from('sales')
          .update({ payment_status: 'paid' })
          .eq('id', saleId);

        if (saleUpdateError) {
          throw new Error(saleUpdateError.message);
        }
      }
    } else if (status !== 'success' && transaction.sale_id) {
      const { error: failedUpdateError } = await client
        .from('sales')
        .update({ payment_status: 'failed' })
        .eq('id', transaction.sale_id)
        .neq('payment_status', 'paid');

      if (failedUpdateError) {
        throw new Error(failedUpdateError.message);
      }
    }

    return jsonResponse(200, { ResultCode: 0, ResultDesc: 'Callback processed successfully' });
  } catch (error) {
    return jsonResponse(200, { ResultCode: 1, ResultDesc: error.message || 'Callback error' });
  }
};
