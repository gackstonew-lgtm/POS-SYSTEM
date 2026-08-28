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
  const q = String(params.q || '').trim().toLowerCase();
  const category = String(params.category || '').trim();

  const client = getSupabaseClient();

  try {
    let queryBuilder = client
      .from('products')
      .select('id, sku, barcode, name, category, selling_price, stock_quantity')
      .is('deleted_at', null)
      .eq('is_active', true)
      .gt('stock_quantity', 0);

    if (q !== '') {
      queryBuilder = queryBuilder.or(`name.ilike.%${q}%,sku.ilike.%${q}%,barcode.ilike.%${q}%`);
    }

    if (category !== '') {
      queryBuilder = queryBuilder.eq('category', category);
    }

    queryBuilder = queryBuilder.order('name', { ascending: true }).limit(80);

    const { data: products, error } = await queryBuilder;

    if (error) {
      throw new Error(error.message);
    }

    return jsonResponse(200, {
      success: true,
      products: (products || []).map((p) => ({
        id: Number(p.id),
        sku: String(p.sku),
        barcode: p.barcode ? String(p.barcode) : null,
        name: String(p.name),
        category: String(p.category),
        price: Number(p.selling_price),
        stock: Number(p.stock_quantity)
      }))
    });
  } catch (error) {
    return jsonResponse(500, { success: false, message: error.message || 'Error searching products.' });
  }
};
