require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Netlify Functions run on Node 20, which has no native WebSocket global.
// @supabase/supabase-js's realtime-js module requires a WebSocket implementation
// to be provided explicitly on Node < 22, or it throws at client-creation time.
// This app doesn't use realtime subscriptions at all (only REST queries), but the
// client still initializes its realtime module internally, so we supply the
// "ws" package as the transport to satisfy that requirement.
const ws = require('ws');

let supabase = null;

function getSupabaseClient() {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !serviceKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
    }

    supabase = createClient(url, serviceKey, {
      auth: { persistSession: false },
      realtime: { transport: ws }
    });
  }

  return supabase;
}

async function query(sql, params = []) {
  const client = getSupabaseClient();
  const { data, error } = await client.rpc('execute_query', {
    query_text: sql,
    query_params: params
  });

  if (error) {
    throw new Error(error.message);
  }

  return data || [];
}

async function supabaseInsert(table, record) {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from(table)
    .insert(record)
    .select();

  if (error) {
    throw new Error(error.message);
  }

  return data ? data[0] : null;
}

async function supabaseUpdate(table, updates, filters) {
  const client = getSupabaseClient();
  let query = client.from(table).update(updates);

  for (const [key, value] of Object.entries(filters)) {
    if (value === null) {
      query = query.is(key, null);
    } else {
      query = query.eq(key, value);
    }
  }

  const { data, error } = await query.select();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

async function supabaseSelect(table, options = {}) {
  const client = getSupabaseClient();
  let query = client.from(table).select(options.select || '*');

  if (options.filters) {
    for (const [key, value] of Object.entries(options.filters)) {
      if (value === null) {
        query = query.is(key, null);
      } else if (typeof value === 'object' && value.like) {
        query = query.ilike(key, value.like);
      } else if (typeof value === 'object' && value.gte) {
        query = query.gte(key, value.gte);
      } else if (typeof value === 'object' && value.lte) {
        query = query.lte(key, value.lte);
      } else if (typeof value === 'object' && value.in) {
        query = query.in(key, value.in);
      } else {
        query = query.eq(key, value);
      }
    }
  }

  if (options.order) {
    const [column, ascending] = options.order;
    query = query.order(column, { ascending: ascending !== false });
  }

  if (options.limit) {
    query = query.limit(options.limit);
  }

  if (options.offset !== undefined && options.limit) {
    query = query.range(options.offset, options.offset + options.limit - 1);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return data || [];
}

async function supabaseDelete(table, filters) {
  const client = getSupabaseClient();
  let query = client.from(table).delete();

  for (const [key, value] of Object.entries(filters)) {
    if (value === null) {
      query = query.is(key, null);
    } else {
      query = query.eq(key, value);
    }
  }

  const { error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return true;
}

async function supabaseUpsert(table, record, onConflict) {
  const client = getSupabaseClient();
  let query = client.from(table).upsert(record, { onConflict });

  const { data, error } = await query.select();

  if (error) {
    throw new Error(error.message);
  }

  return data ? data[0] : null;
}

async function getTransactionConnection() {
  return getSupabaseClient();
}

function jsonResponse(statusCode, data, headers = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      ...headers
    },
    body: JSON.stringify(data)
  };
}

module.exports = {
  getSupabaseClient,
  query,
  supabaseInsert,
  supabaseUpdate,
  supabaseSelect,
  supabaseDelete,
  supabaseUpsert,
  getTransactionConnection,
  jsonResponse
};
