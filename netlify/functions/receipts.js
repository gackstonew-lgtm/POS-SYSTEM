const { getSupabaseClient, jsonResponse } = require('./db');
const { verifyTokenFromHeader } = require('./auth');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(200, { success: true });
  }

  const user = verifyTokenFromHeader(event.headers);
  if (!user) {
    return jsonResponse(401, { success: false, message: 'Unauthorized session.' });
  }

  const params = event.queryStringParameters || {};
  const saleId = Number(params.sale_id || 0);

  if (saleId <= 0) {
    return jsonResponse(404, { success: false, message: 'Receipt not found.' });
  }

  const client = getSupabaseClient();

  try {
    const { data: sales, error: salesError } = await client
      .from('sales')
      .select('*, users!sales_cashier_id_fkey(name)')
      .eq('id', saleId)
      .limit(1);

    if (salesError) {
      throw new Error(salesError.message);
    }

    const sale = sales && sales.length > 0 ? sales[0] : null;
    if (!sale) {
      return jsonResponse(404, { success: false, message: 'Receipt not found.' });
    }

    const { data: mpesaTx, error: mpesaError } = await client
      .from('mpesa_transactions')
      .select('receipt_number, phone_number, transaction_date')
      .eq('sale_id', saleId)
      .eq('status', 'success')
      .limit(1);

    if (mpesaError) {
      throw new Error(mpesaError.message);
    }

    const mpesa = mpesaTx && mpesaTx.length > 0 ? mpesaTx[0] : null;

    const { data: items, error: itemsError } = await client
      .from('sale_items')
      .select('*, products!sale_items_product_id_fkey(name)')
      .eq('sale_id', saleId)
      .order('id', { ascending: true });

    if (itemsError) {
      throw new Error(itemsError.message);
    }

    return jsonResponse(200, {
      success: true,
      sale: {
        id: Number(sale.id),
        reference: String(sale.reference),
        created_at: String(sale.created_at),
        cashier_name: sale.users ? sale.users.name : 'Cashier',
        customer_name: sale.customer_name ? String(sale.customer_name) : 'Walk-in customer',
        payment_method: String(sale.payment_method),
        payment_status: String(sale.payment_status),
        subtotal: Number(sale.subtotal),
        discount: Number(sale.discount),
        tax: Number(sale.tax),
        total: Number(sale.total),
        mpesa_receipt: mpesa ? mpesa.receipt_number : null,
        mpesa_phone: mpesa ? mpesa.phone_number : null,
        mpesa_date: mpesa ? mpesa.transaction_date : null
      },
      items: (items || []).map((line) => ({
        id: Number(line.id),
        name: line.products ? line.products.name : 'Unknown product',
        quantity: Number(line.quantity),
        unit_price: Number(line.unit_price),
        line_total: Number(line.line_total)
      }))
    });
  } catch (error) {
    return jsonResponse(500, { success: false, message: error.message || 'Error fetching receipt.' });
  }
};
