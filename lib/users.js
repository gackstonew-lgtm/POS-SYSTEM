const bcrypt = require('bcryptjs');
const { getSupabaseClient, jsonResponse } = require('./db');
const { verifyTokenFromHeader } = require('./auth');

const ROLE_LABELS = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  cashier: 'Cashier'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(200, { success: true });
  }

  const currentUser = verifyTokenFromHeader(event.headers);
  if (!currentUser || currentUser.role !== 'super_admin') {
    return jsonResponse(403, { success: false, message: 'Permission denied. Super Admin access required.' });
  }

  const params = event.queryStringParameters || {};
  const client = getSupabaseClient();

  if (event.httpMethod === 'POST') {
    let body = {};
    try {
      body = JSON.parse(event.body || '{}');
    } catch (e) {
      return jsonResponse(422, { success: false, message: 'Invalid payload.' });
    }

    const id = Number(body.id || 0);
    const name = String(body.name || '').trim();
    const email = String(body.email || '').trim();
    const role = String(body.role || '').trim();
    const password = String(body.password || '');
    const isActive = (body.is_active === undefined || body.is_active === null) ? true : Boolean(body.is_active);

    const errors = [];
    if (!name) errors.push('Name is required.');
    if (!email || !/\S+@\S+\.\S+/.test(email)) errors.push('A valid email is required.');
    if (!ROLE_LABELS[role]) errors.push('Choose a valid role.');
    if (id === 0 && password.length < 8) errors.push('Password must be at least 8 characters.');

    const { data: dupes, error: dupeError } = await client
      .from('users')
      .select('id')
      .ilike('email', email)
      .neq('id', id);

    if (dupeError) {
      throw new Error(dupeError.message);
    }

    if (dupes && dupes.length > 0) {
      errors.push('Email address is already in use.');
    }

    if (errors.length > 0) {
      return jsonResponse(422, { success: false, message: errors.join(' ') });
    }

    if (id > 0) {
      const updateData = {
        name,
        email,
        role,
        is_active: isActive
      };

      const { error: updateError } = await client
        .from('users')
        .update(updateData)
        .eq('id', id);

      if (updateError) {
        throw new Error(updateError.message);
      }

      if (password !== '') {
        if (password.length < 8) {
          return jsonResponse(422, { success: false, message: 'Password must be at least 8 characters.' });
        }
        const hash = await bcrypt.hash(password, 10);
        const { error: pwError } = await client
          .from('users')
          .update({ password_hash: hash })
          .eq('id', id);

        if (pwError) {
          throw new Error(pwError.message);
        }
      }

      return jsonResponse(200, { success: true, message: 'User updated successfully.' });
    } else {
      const hash = await bcrypt.hash(password, 10);
      const { error: insertError } = await client
        .from('users')
        .insert({
          name,
          email,
          password_hash: hash,
          role,
          is_active: isActive
        });

      if (insertError) {
        throw new Error(insertError.message);
      }

      return jsonResponse(200, { success: true, message: 'User created successfully.' });
    }
  }

  const id = Number(params.id || 0);
  if (id > 0) {
    const { data: users, error } = await client
      .from('users')
      .select('id, name, email, role, is_active')
      .eq('id', id)
      .limit(1);

    if (error) {
      throw new Error(error.message);
    }

    if (!users || users.length === 0) {
      return jsonResponse(404, { success: false, message: 'User not found.' });
    }

    return jsonResponse(200, { success: true, user: users[0] });
  }

  const q = String(params.q || '').trim();
  const page = Math.max(1, Number(params.page || 1));
  const perPage = Math.max(1, Number(params.perPage || 10));
  const offset = (page - 1) * perPage;

  let queryBuilder = client
    .from('users')
    .select('id, name, email, role, is_active, last_login_at, created_at', { count: 'exact' });

  if (q !== '') {
    queryBuilder = queryBuilder.or(`name.ilike.%${q}%,email.ilike.%${q}%,role.ilike.%${q}%`);
  }

  queryBuilder = queryBuilder
    .order('name', { ascending: true })
    .range(offset, offset + perPage - 1);

  const { data: users, error: listError, count: total } = await queryBuilder;

  if (listError) {
    throw new Error(listError.message);
  }

  return jsonResponse(200, {
    success: true,
    users: (users || []).map((u) => ({
      ...u,
      role_label: ROLE_LABELS[u.role] || u.role
    })),
    total: total || 0,
    page,
    pages: Math.max(1, Math.ceil((total || 0) / perPage))
  });
};
