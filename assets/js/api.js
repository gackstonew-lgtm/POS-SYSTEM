(function (window) {
  'use strict';

  const TOKEN_KEY = 'karing_pos_token';
  const USER_KEY = 'karing_pos_user';

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || '';
  }

  function setSession(token, user, remember = true) {
    if (remember) {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } else {
      sessionStorage.setItem(TOKEN_KEY, token);
      sessionStorage.setItem(USER_KEY, JSON.stringify(user));
    }
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
  }

  function getStoredUser() {
    const raw = localStorage.getItem(USER_KEY) || sessionStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  async function request(endpoint, options = {}) {
    const token = getToken();
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...options.headers
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const url = endpoint.startsWith('http') ? endpoint : `/.netlify/functions${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

    try {
      const response = await fetch(url, {
        ...options,
        headers
      });

      const data = await response.json();

      if (response.status === 401 && !endpoint.includes('/auth')) {
        clearSession();
        window.location.href = '/login.html';
        throw new Error(data.message || 'Session expired. Please log in again.');
      }

      if (!response.ok || (data && data.success === false)) {
        throw new Error(data.message || `Request failed with status ${response.status}`);
      }

      return data;
    } catch (err) {
      throw err;
    }
  }

  const KaringApi = {
    getToken,
    getStoredUser,
    setSession,
    clearSession,

    async login(email, password) {
      const res = await request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });

      if (res.token && res.user) {
        setSession(res.token, res.user, true);
      }

      return res;
    },

    async logout() {
      try {
        await request('/auth/logout', { method: 'POST' });
      } catch (e) {}
      clearSession();
      window.location.href = '/login.html';
    },

    async getCurrentUser() {
      const res = await request('/auth/me', { method: 'GET' });
      if (res.user) {
        setSession(getToken(), res.user, true);
      }
      return res.user;
    },

    async getDashboardMetrics() {
      return request('/dashboard', { method: 'GET' });
    },

    async searchProducts(q = '', category = '') {
      const params = new URLSearchParams({ q, category });
      return request(`/products?${params.toString()}`, { method: 'GET' });
    },

    async getEntityList(entity, q = '', page = 1, perPage = 10) {
      const params = new URLSearchParams({ entity, q, page, perPage });
      return request(`/entities?${params.toString()}`, { method: 'GET' });
    },

    async getEntityRecord(entity, id) {
      const params = new URLSearchParams({ entity, id });
      return request(`/entities?${params.toString()}`, { method: 'GET' });
    },

    async saveEntityRecord(entity, payload) {
      return request('/entities', {
        method: 'POST',
        body: JSON.stringify({ entity, ...payload })
      });
    },

    async deleteEntityRecord(entity, id) {
      return request('/entities', {
        method: 'POST',
        body: JSON.stringify({ entity, action: 'delete', id })
      });
    },

    async submitCheckout(payload) {
      return request('/checkout', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    },

    async initiateMpesaStk(saleId, phoneNumber) {
      return request('/mpesa/stkpush', {
        method: 'POST',
        body: JSON.stringify({ sale_id: saleId, phone_number: phoneNumber })
      });
    },

    async checkMpesaStatus(saleId, checkoutRequestId = '') {
      const params = new URLSearchParams({ sale_id: saleId, checkout_request_id: checkoutRequestId, action: 'status' });
      return request(`/mpesa?${params.toString()}`, { method: 'GET' });
    },

    async getReportData(filters = {}) {
      const params = new URLSearchParams(filters);
      return request(`/reports?${params.toString()}`, { method: 'GET' });
    },

    async getReceiptData(saleId) {
      const params = new URLSearchParams({ sale_id: saleId });
      return request(`/receipts?${params.toString()}`, { method: 'GET' });
    },

    async getUsersList(q = '', page = 1) {
      const params = new URLSearchParams({ q, page });
      return request(`/users?${params.toString()}`, { method: 'GET' });
    },

    async saveUser(payload) {
      return request('/users', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    }
  };

  window.KaringApi = KaringApi;
})(window);
