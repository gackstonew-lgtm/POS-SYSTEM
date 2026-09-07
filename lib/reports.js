const { getSupabaseClient, jsonResponse } = require('./db');
const { verifyTokenFromHeader } = require('./auth');

function isValidDate(dateStr) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(200, { success: true });
  }

  const user = verifyTokenFromHeader(event.headers);
  if (!user || !['super_admin', 'admin'].includes(user.role)) {
    return jsonResponse(403, { success: false, message: 'Permission denied. Reports are restricted to Admins.' });
  }

  const params = event.queryStringParameters || {};
  const d = new Date();
  const currentYear = d.getFullYear();
  const currentMonth = d.getMonth() + 1;
  const currentMonthStr = String(currentMonth).padStart(2, '0');
  const currentDayStr = String(d.getDate()).padStart(2, '0');
  const firstDayOfMonth = `${currentYear}-${currentMonthStr}-01`;
  const todayStr = `${currentYear}-${currentMonthStr}-${currentDayStr}`;

  const from = String(params.from || firstDayOfMonth).trim();
  const to = String(params.to || todayStr).trim();
  const cashierId = Number(params.cashier_id || 0);
  const phone = String(params.phone || '').trim().replace(/\D+/g, '');

  if (!isValidDate(from) || !isValidDate(to)) {
    return jsonResponse(400, {
      success: false,
      message: 'Invalid date format. Expected valid YYYY-MM-DD calendar dates.'
    });
  }

  if (from > to) {
    return jsonResponse(400, {
      success: false,
      message: 'Invalid date range. "from" date must be earlier than or equal to "to" date.'
    });
  }

  const client = getSupabaseClient();

  try {
    const { data: cashiers, error: cashiersError } = await client
      .from('users')
      .select('id, name')
      .in('role', ['cashier', 'admin', 'super_admin'])
      .order('name', { ascending: true });

    if (cashiersError) {
      throw new Error(cashiersError.message);
    }

    let salesQuery = client
      .from('sales')
      .select('id, reference, payment_method, payment_status, total, created_at, cashier_id, users!sales_cashier_id_fkey(name), sale_items(id, quantity, unit_price, line_total, products(id, name, sku))')
      .eq('payment_status', 'paid')
      .gte('created_at', `${from}T00:00:00`)
      .lte('created_at', `${to}T23:59:59`)
      .order('created_at', { ascending: false });

    if (cashierId > 0) {
      salesQuery = salesQuery.eq('cashier_id', cashierId);
    }

    const { data: salesData, error: salesError } = await salesQuery;

    if (salesError) {
      throw new Error(salesError.message);
    }

    const salesTotal = (salesData || []).reduce((sum, sale) => sum + Number(sale.total), 0);
    const salesCount = (salesData || []).length;

    const soldProducts = [];
    for (const sale of (salesData || [])) {
      const d = new Date(sale.created_at);
      const dateStr = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const timeStr = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      const method = String(sale.payment_method || '').toLowerCase().trim();
      const paymentType = method === 'mpesa' ? 'M-PESA' : (method ? method.charAt(0).toUpperCase() + method.slice(1) : 'Cash');

      for (const item of (sale.sale_items || [])) {
        soldProducts.push({
          id: item.id,
          sale_id: sale.id,
          sale_reference: sale.reference,
          product_name: item.products ? item.products.name : 'Unknown',
          sku: item.products ? item.products.sku : '',
          quantity: Number(item.quantity),
          unit_price: Number(item.unit_price),
          amount: Number(item.line_total),
          payment_type: paymentType,
          cashier_name: sale.users ? sale.users.name : 'Cashier',
          date: dateStr,
          time: timeStr,
          created_at: sale.created_at
        });
      }
    }

    let mpesaQuery = client
      .from('mpesa_transactions')
      .select('*')
      .gte('created_at', `${from}T00:00:00`)
      .lte('created_at', `${to}T23:59:59`);

    if (phone !== '') {
      mpesaQuery = mpesaQuery.ilike('phone_number', `%${phone}%`);
    }

    const { data: mpesaTransactions, error: mpesaError } = await mpesaQuery
      .order('created_at', { ascending: false })
      .limit(100);

    if (mpesaError) {
      throw new Error(mpesaError.message);
    }

    const mpesaSuccessTotal = (mpesaTransactions || [])
      .filter(tx => tx.status === 'success')
      .reduce((sum, tx) => sum + Number(tx.amount), 0);

    const today = todayStr;

    const { data: todayMpesaData, error: todayMpesaError } = await client
      .from('mpesa_transactions')
      .select('amount')
      .eq('status', 'success')
      .gte('created_at', `${today}T00:00:00`)
      .lte('created_at', `${today}T23:59:59`);

    if (todayMpesaError) {
      throw new Error(todayMpesaError.message);
    }

    const todayMpesa = (todayMpesaData || []).reduce((sum, tx) => sum + Number(tx.amount), 0);

    const lastDayOfMonth = new Date(Date.UTC(currentYear, currentMonth, 0)).getUTCDate();
    const lastDayStr = String(lastDayOfMonth).padStart(2, '0');

    const { data: monthlyMpesaData, error: monthlyMpesaError } = await client
      .from('mpesa_transactions')
      .select('amount')
      .eq('status', 'success')
      .gte('created_at', `${currentYear}-${currentMonthStr}-01T00:00:00`)
      .lte('created_at', `${currentYear}-${currentMonthStr}-${lastDayStr}T23:59:59`);

    if (monthlyMpesaError) {
      throw new Error(monthlyMpesaError.message);
    }

    const monthlyMpesa = (monthlyMpesaData || []).reduce((sum, tx) => sum + Number(tx.amount), 0);

    const { count: pendingMpesa, error: pendingError } = await client
      .from('mpesa_transactions')
      .select('id', { count: 'exact' })
      .eq('status', 'pending');

    if (pendingError) {
      throw new Error(pendingError.message);
    }

    const { count: failedMpesa, error: failedError } = await client
      .from('mpesa_transactions')
      .select('id', { count: 'exact' })
      .in('status', ['failed', 'cancelled', 'timeout']);

    if (failedError) {
      throw new Error(failedError.message);
    }

    const { data: expensesData, error: expensesError } = await client
      .from('expenses')
      .select('amount')
      .is('deleted_at', null)
      .gte('expense_date', from)
      .lte('expense_date', to);

    if (expensesError) {
      throw new Error(expensesError.message);
    }

    const expenseTotal = (expensesData || []).reduce((sum, exp) => sum + Number(exp.amount), 0);

    const groupedTopProducts = {};
    for (const item of soldProducts) {
      const name = item.product_name || 'Unknown';
      if (!groupedTopProducts[name]) {
        groupedTopProducts[name] = { name, qty: 0, total: 0 };
      }
      groupedTopProducts[name].qty = Number((groupedTopProducts[name].qty + item.quantity).toFixed(4));
      groupedTopProducts[name].total = Number((groupedTopProducts[name].total + item.amount).toFixed(2));
    }

    return jsonResponse(200, {
      success: true,
      filters: { from, to, cashierId, phone },
      cashiers: cashiers || [],
      sales: { total: salesTotal, count: salesCount },
      expenseTotal,
      netProfit: salesTotal - expenseTotal,
      topProducts: Object.values(groupedTopProducts).sort((a, b) => b.qty - a.qty).slice(0, 10),
      soldProducts,
      mpesa: {
        summary: { total: mpesaSuccessTotal, count: (mpesaTransactions || []).filter(tx => tx.status === 'success').length },
        todayMpesa,
        monthlyMpesa,
        pendingMpesa: pendingMpesa || 0,
        failedMpesa: failedMpesa || 0,
        transactions: (mpesaTransactions || []).map((tx) => ({
          id: Number(tx.id),
          sale_id: tx.sale_id ? Number(tx.sale_id) : null,
          reference: tx.account_reference || 'Pending sale',
          receipt_number: tx.receipt_number || '',
          phone_number: tx.phone_number || '',
          amount: Number(tx.amount),
          status: tx.status,
          cashier_name: '',
          result_description: tx.result_description || '',
          transaction_date: tx.transaction_date || tx.created_at
        }))
      }
    });
  } catch (error) {
    return jsonResponse(500, { success: false, message: error.message || 'Error generating reports.' });
  }
};
