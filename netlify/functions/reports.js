const { getSupabaseClient, jsonResponse } = require('./db');
const { verifyTokenFromHeader } = require('./auth');

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
  const firstDayOfMonth = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  const todayStr = d.toISOString().slice(0, 10);

  const from = String(params.from || firstDayOfMonth).trim();
  const to = String(params.to || todayStr).trim();
  const cashierId = Number(params.cashier_id || 0);
  const phone = String(params.phone || '').trim().replace(/\D+/g, '');

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
      .select('total')
      .gte('created_at', `${from}T00:00:00`)
      .lte('created_at', `${to}T23:59:59`);

    if (cashierId > 0) {
      salesQuery = salesQuery.eq('cashier_id', cashierId);
    }

    const { data: salesData, error: salesError } = await salesQuery;

    if (salesError) {
      throw new Error(salesError.message);
    }

    const salesTotal = (salesData || []).reduce((sum, sale) => sum + Number(sale.total), 0);
    const salesCount = (salesData || []).length;

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

    const { data: topProducts, error: topProductsError } = await client
      .from('sale_items')
      .select('product_id, quantity, line_total, products!sale_items_product_id_fkey(name)')
      .gte('sales.created_at', `${from}T00:00:00`)
      .lte('sales.created_at', `${to}T23:59:59`)
      .order('quantity', { ascending: false })
      .limit(10);

    let mpesaQuery = client
      .from('mpesa_transactions')
      .select('*')
      .gte('created_at', `${from}T00:00:00`)
      .lte('created_at', `${to}T23:59:59`);

    if (cashierId > 0) {
      mpesaQuery = mpesaQuery.eq('sales.cashier_id', cashierId);
    }

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

    const today = new Date().toISOString().split('T')[0];

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

    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();

    const { data: monthlyMpesaData, error: monthlyMpesaError } = await client
      .from('mpesa_transactions')
      .select('amount')
      .eq('status', 'success')
      .gte('created_at', `${currentYear}-${String(currentMonth).padStart(2, '0')}-01T00:00:00`)
      .lte('created_at', `${currentYear}-${String(currentMonth).padStart(2, '0')}-31T23:59:59`);

    if (monthlyMpesaError) {
      throw new Error(monthlyMpesaError.message);
    }

    const monthlyMpesa = (monthlyMpesaData || []).reduce((sum, tx) => sum + Number(tx.amount), 0);

    const { count: pendingMpesa, error: pendingError } = await client
      .from('mpesa_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');

    if (pendingError) {
      throw new Error(pendingError.message);
    }

    const { count: failedMpesa, error: failedError } = await client
      .from('mpesa_transactions')
      .select('id', { count: 'exact', head: true })
      .in('status', ['failed', 'cancelled', 'timeout']);

    if (failedError) {
      throw new Error(failedError.message);
    }

    const groupedTopProducts = {};
    (topProducts || []).forEach(item => {
      const name = item.products ? item.products.name : 'Unknown';
      if (!groupedTopProducts[name]) {
        groupedTopProducts[name] = { name, qty: 0, total: 0 };
      }
      groupedTopProducts[name].qty += Number(item.quantity);
      groupedTopProducts[name].total += Number(item.line_total);
    });

    return jsonResponse(200, {
      success: true,
      filters: { from, to, cashierId, phone },
      cashiers: cashiers || [],
      sales: { total: salesTotal, count: salesCount },
      expenseTotal,
      netProfit: salesTotal - expenseTotal,
      topProducts: Object.values(groupedTopProducts).sort((a, b) => b.qty - a.qty).slice(0, 10),
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
