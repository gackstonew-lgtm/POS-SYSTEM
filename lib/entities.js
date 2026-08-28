const { getSupabaseClient, jsonResponse } = require('./db');
const { verifyTokenFromHeader } = require('./auth');

const ENTITY_CONFIGS = {
  products: {
    table: 'products',
    primary: 'id',
    search: ['sku', 'barcode', 'name', 'category'],
    order: 'name ASC',
    roles: ['super_admin', 'admin'],
    fields: ['sku', 'barcode', 'name', 'category', 'cost_price', 'selling_price', 'stock_quantity', 'reorder_level', 'is_active'],
    unique: ['sku']
  },
  customers: {
    table: 'customers',
    primary: 'id',
    search: ['name', 'phone', 'email'],
    order: 'name ASC',
    roles: ['super_admin', 'admin'],
    fields: ['name', 'phone', 'email', 'balance', 'notes', 'is_active']
  },
  suppliers: {
    table: 'suppliers',
    primary: 'id',
    search: ['name', 'contact_person', 'phone', 'category'],
    order: 'name ASC',
    roles: ['super_admin', 'admin'],
    fields: ['name', 'contact_person', 'phone', 'email', 'category', 'balance', 'is_active']
  },
  employees: {
    table: 'employees',
    primary: 'id',
    search: ['name', 'phone', 'role', 'shift'],
    order: 'name ASC',
    roles: ['super_admin', 'admin'],
    fields: ['name', 'phone', 'email', 'role', 'shift', 'salary', 'is_active']
  },
  expenses: {
    table: 'expenses',
    primary: 'id',
    search: ['category', 'description', 'payment_method'],
    order: 'expense_date DESC, id DESC',
    roles: ['super_admin', 'admin'],
    fields: ['expense_date', 'category', 'description', 'amount', 'payment_method']
  }
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(200, { success: true });
  }

  try {
    const user = verifyTokenFromHeader(event.headers);
    if (!user) {
      return jsonResponse(401, { success: false, message: 'Unauthorized session.' });
    }

    const params = event.queryStringParameters || {};
    const entityKey = String(params.entity || '').trim();
    const config = ENTITY_CONFIGS[entityKey];
    const client = getSupabaseClient();
    const eventPath = String(event.path || '');

    if (event.httpMethod === 'POST' && event.body) {
      let body = {};
      try {
        body = JSON.parse(event.body);
      } catch (e) {
        body = {};
      }

      const postEntity = String(body.entity || entityKey).trim();
      const postConfig = ENTITY_CONFIGS[postEntity];
      
      if (body.action === 'stock_adjust') {
        if (!user || !['super_admin', 'admin'].includes(user.role)) {
          return jsonResponse(403, { success: false, message: 'Permission denied.' });
        }

        const productId = Number(body.id || 0);
        const adjustType = String(body.type || 'in').toLowerCase();
        const qtyInput = Number(body.quantity || 0);

        if (productId <= 0) {
          return jsonResponse(400, { success: false, message: 'Invalid product ID.' });
        }
        if (qtyInput < 0) {
          return jsonResponse(422, { success: false, message: 'Quantity cannot be negative.' });
        }

        const { data: prod, error: fetchErr } = await client
          .from('products')
          .select('*')
          .eq('id', productId)
          .is('deleted_at', null)
          .single();

        if (fetchErr || !prod) {
          return jsonResponse(404, { success: false, message: 'Product not found.' });
        }

        const currentStock = Number(prod.stock_quantity || 0);
        let newStock = currentStock;

        if (adjustType === 'in') {
          newStock = currentStock + qtyInput;
        } else if (adjustType === 'out') {
          if (currentStock < qtyInput) {
            return jsonResponse(422, { success: false, message: `Cannot remove ${qtyInput} units. Current stock is only ${currentStock}.` });
          }
          newStock = currentStock - qtyInput;
        } else if (adjustType === 'set') {
          newStock = qtyInput;
        } else {
          return jsonResponse(400, { success: false, message: 'Invalid stock adjustment type.' });
        }

        const { error: updateErr } = await client
          .from('products')
          .update({ stock_quantity: newStock, updated_at: new Date().toISOString() })
          .eq('id', productId);

        if (updateErr) {
          throw new Error(updateErr.message);
        }

        return jsonResponse(200, {
          success: true,
          message: `Stock updated successfully for ${prod.name}. New Stock: ${newStock}`,
          stock_quantity: newStock
        });
      }

      if (body.action === 'delete' || eventPath.endsWith('/delete')) {
        if (!postConfig) {
          return jsonResponse(400, { success: false, message: 'Invalid entity specified for delete.' });
        }

        if (!postConfig.roles.includes(user.role)) {
          return jsonResponse(403, { success: false, message: 'Permission denied.' });
        }

        const idToDelete = Number(body.id || 0);
        if (idToDelete <= 0) {
          return jsonResponse(400, { success: false, message: 'Invalid ID for deletion.' });
        }

        const { error } = await client
          .from(postConfig.table)
          .update({ deleted_at: new Date().toISOString() })
          .eq(postConfig.primary, idToDelete);

        if (error) {
          throw new Error(error.message);
        }

        return jsonResponse(200, { success: true, message: 'Record deleted successfully.' });
      }

      if (postConfig) {
        if (!postConfig.roles.includes(user.role)) {
          return jsonResponse(403, { success: false, message: 'Permission denied.' });
        }

        const id = Number(body.id || 0);
        const clean = {};
        const errors = [];

        for (const fieldName of postConfig.fields) {
          let val = body[fieldName];
          if (val === undefined || val === null) {
            val = (fieldName === 'is_active') ? true : '';
          }
          if (fieldName === 'is_active') {
            val = Boolean(Number(val));
          }
          clean[fieldName] = val;
        }

        if (postConfig.unique) {
          for (const uField of postConfig.unique) {
            const uVal = String(clean[uField] || '').trim();
            if (uVal !== '') {
              const { data: existing, error: countError } = await client
                .from(postConfig.table)
                .select('id')
                .ilike(uField, uVal)
                .neq(postConfig.primary, id)
                .is('deleted_at', null);

              if (countError) {
                throw new Error(countError.message);
              }

              if (existing && existing.length > 0) {
                errors.push(`${uField.toUpperCase()} '${uVal}' is already taken.`);
              }
            }
          }
        }

        if (errors.length > 0) {
          return jsonResponse(422, { success: false, message: errors.join(' ') });
        }

        if (id > 0) {
          const { error } = await client
            .from(postConfig.table)
            .update(clean)
            .eq(postConfig.primary, id);

          if (error) {
            throw new Error(error.message);
          }

          return jsonResponse(200, { success: true, message: 'Record updated successfully.', id });
        } else {
          const { data: newRecord, error } = await client
            .from(postConfig.table)
            .insert(clean)
            .select()
            .single();

          if (error) {
            throw new Error(error.message);
          }

          return jsonResponse(200, { success: true, message: 'Record created successfully.', id: newRecord.id });
        }
      }
    }

    if (event.httpMethod === 'DELETE') {
      if (!config || !config.roles.includes(user.role)) {
        return jsonResponse(403, { success: false, message: 'Permission denied.' });
      }

      const id = Number(params.id || 0);
      if (id <= 0) {
        return jsonResponse(400, { success: false, message: 'Invalid record ID.' });
      }

      const { error } = await client
        .from(config.table)
        .update({ deleted_at: new Date().toISOString() })
        .eq(config.primary, id);

      if (error) {
        throw new Error(error.message);
      }

      return jsonResponse(200, { success: true, message: 'Record deleted successfully.' });
    }

    if (entityKey === 'categories') {
      const { data: prods } = await client.from('products').select('category').is('deleted_at', null);
      const { data: supps } = await client.from('suppliers').select('category').is('deleted_at', null);
      const set = new Set(['Grocery', 'Beverages', 'Household', 'Personal Care', 'Packaging', 'Grains']);
      (prods || []).forEach(p => p.category && set.add(p.category));
      (supps || []).forEach(s => s.category && set.add(s.category));
      const categoriesList = Array.from(set).filter(Boolean).sort().map(c => ({ id: c, name: c }));
      return jsonResponse(200, { success: true, rows: categoriesList, total: categoriesList.length, page: 1, pages: 1 });
    }

    if (!config) {
      return jsonResponse(400, { success: false, message: 'Valid entity parameter required (products, customers, suppliers, employees, expenses).' });
    }

    if (!config.roles.includes(user.role)) {
      return jsonResponse(403, { success: false, message: 'Permission denied for this module.' });
    }

    const singleId = Number(params.id || 0);
    if (singleId > 0) {
      const { data: record, error } = await client
        .from(config.table)
        .select('*')
        .eq(config.primary, singleId)
        .is('deleted_at', null)
        .limit(1);

      if (error) {
        throw new Error(error.message);
      }

      if (!record || record.length === 0) {
        return jsonResponse(404, { success: false, message: 'Record not found.' });
      }

      return jsonResponse(200, { success: true, record: record[0] });
    }

    const q = String(params.q || '').trim();
    const page = Math.max(1, Number(params.page || 1));
    const perPage = Math.max(1, Number(params.perPage || 10));
    const offset = (page - 1) * perPage;

    let queryBuilder = client
      .from(config.table)
      .select('*', { count: 'exact' })
      .is('deleted_at', null);

    if (q !== '') {
      const searchConditions = config.search.map(field => `${field}.ilike.%${q}%`);
      queryBuilder = queryBuilder.or(searchConditions.join(','));
    }

    const orderParts = config.order.split(' ');
    const orderColumn = orderParts[0];
    const ascending = orderParts[1] ? orderParts[1].toUpperCase() !== 'DESC' : true;
    queryBuilder = queryBuilder.order(orderColumn, { ascending });

    queryBuilder = queryBuilder.range(offset, offset + perPage - 1);

    const { data: rows, error: listError, count: total } = await queryBuilder;

    if (listError) {
      throw new Error(listError.message);
    }

    return jsonResponse(200, {
      success: true,
      rows: rows || [],
      total: total || 0,
      page,
      pages: Math.max(1, Math.ceil((total || 0) / perPage))
    });
  } catch (error) {
    return jsonResponse(500, { success: false, message: error.message || 'Internal server error.' });
  }
};
