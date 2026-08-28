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

  const client = getSupabaseClient();

  try {
    const today = new Date().toISOString().split('T')[0];

    const { data: salesData, error: salesError } = await client
      .from('sales')
      .select('total')
      .gte('created_at', `${today}T00:00:00`)
      .lte('created_at', `${today}T23:59:59`);

    if (salesError) {
      throw new Error(salesError.message);
    }

    const salesToday = (salesData || []).reduce((sum, sale) => sum + Number(sale.total), 0);
    const transactionsToday = (salesData || []).length;

    const { data: productsData, error: productsError } = await client
      .from('products')
      .select('stock_quantity, reorder_level')
      .is('deleted_at', null)
      .eq('is_active', true);

    if (productsError) {
      throw new Error(productsError.message);
    }

    const lowStockCount = (productsData || []).filter(
      p => Number(p.stock_quantity) <= Number(p.reorder_level ?? 5)
    ).length;

    const { data: expensesData, error: expensesError } = await client
      .from('expenses')
      .select('amount')
      .is('deleted_at', null)
      .eq('expense_date', today);

    if (expensesError) {
      throw new Error(expensesError.message);
    }

    const expensesToday = (expensesData || []).reduce((sum, exp) => sum + Number(exp.amount), 0);

    return jsonResponse(200, {
      success: true,
      data: {
        salesToday,
        transactionsToday,
        lowStockCount: lowStockCount || 0,
        expensesToday
      }
    });
  } catch (error) {
    return jsonResponse(500, { success: false, message: error.message || 'Error fetching dashboard metrics.' });
  }
};
