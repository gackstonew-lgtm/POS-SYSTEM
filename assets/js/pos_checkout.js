(function () {
    'use strict';

    const state = {
        products: [],
        cart: new Map(),
        searchTimer: null,
        taxRate: 0
    };

    const els = {
        productSearch: document.getElementById('productSearch'),
        categoryFilter: document.getElementById('categoryFilter'),
        productGrid: document.getElementById('productGrid'),
        cartList: document.getElementById('cartList'),
        cartCount: document.getElementById('cartCount'),
        clearCartBtn: document.getElementById('clearCartBtn'),
        globalDiscount: document.getElementById('globalDiscount'),
        customerName: document.getElementById('customerName'),
        mpesaPhone: document.getElementById('mpesaPhone'),
        subtotalAmount: document.getElementById('subtotalAmount'),
        discountAmount: document.getElementById('discountAmount'),
        taxAmount: document.getElementById('taxAmount'),
        totalAmount: document.getElementById('totalAmount'),
        cashCheckoutBtn: document.getElementById('cashCheckoutBtn'),
        cardCheckoutBtn: document.getElementById('cardCheckoutBtn'),
        mpesaCheckoutBtn: document.getElementById('mpesaCheckoutBtn'),
        checkoutAlert: document.getElementById('checkoutAlert')
    };

    function money(amount) {
        return window.KaringLayout.money(amount);
    }

    function escapeHtml(value) {
        return window.KaringLayout.escapeHtml(value);
    }

    function showAlert(type, message) {
        if (!els.checkoutAlert) return;
        els.checkoutAlert.className = `alert alert-${type} mt-3 mb-0`;
        els.checkoutAlert.textContent = message;
    }

    function hideAlert() {
        if (!els.checkoutAlert) return;
        els.checkoutAlert.className = 'alert mt-3 mb-0 d-none';
        els.checkoutAlert.textContent = '';
    }

    function normalizeKenyanPhone(phone) {
        let digits = String(phone || '').replace(/\D/g, '');
        if (digits.length === 10 && digits.startsWith('0')) {
            digits = `254${digits.slice(1)}`;
        }
        if (digits.length === 9 && (digits.startsWith('7') || digits.startsWith('1'))) {
            digits = `254${digits}`;
        }
        return /^254(7|1)\d{8}$/.test(digits) ? digits : null;
    }

    async function loadCategories() {
        if (!els.categoryFilter) return;
        try {
            const res = await window.KaringApi.getEntityList('categories');
            const categories = res.rows || [];
            if (categories.length > 0) {
                const currentVal = els.categoryFilter.value;
                els.categoryFilter.innerHTML = '<option value="">All Categories</option>' +
                    categories.map(c => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('');
                els.categoryFilter.value = currentVal;
            }
        } catch (e) {}
    }

    async function loadProducts() {
        if (!els.productGrid) return;
        const q = els.productSearch ? els.productSearch.value.trim() : '';
        const category = els.categoryFilter ? els.categoryFilter.value : '';

        els.productGrid.innerHTML = `
            <div class="empty-state">
                <div>
                    <div class="spinner-border text-success mb-3" role="status"></div>
                    <div>Loading products...</div>
                </div>
            </div>
        `;

        try {
            const data = await window.KaringApi.searchProducts(q, category);
            state.products = data.products || [];
            renderProducts();
        } catch (error) {
            els.productGrid.innerHTML = `
                <div class="empty-state">
                    <div>
                        <i class="bi bi-exclamation-triangle fs-1 d-block mb-2"></i>
                        ${escapeHtml(error.message)}
                    </div>
                </div>
            `;
        }
    }

    function renderProducts() {
        if (!state.products.length) {
            els.productGrid.innerHTML = `
                <div class="empty-state">
                    <div>
                        <i class="bi bi-search fs-1 d-block mb-2"></i>
                        No matching products found.
                    </div>
                </div>
            `;
            return;
        }

        els.productGrid.innerHTML = state.products.map((product) => `
            <button class="product-card text-start" type="button" data-product-id="${product.id}">
                <div class="product-name">${escapeHtml(product.name)}</div>
                <div class="product-code">SKU: ${escapeHtml(product.sku)}</div>
                <div class="product-stock">Stock: ${Number(product.stock)}</div>
                <div class="product-price">${money(product.price)}</div>
            </button>
        `).join('');
    }

    function addToCart(productId) {
        const product = state.products.find((item) => String(item.id) === String(productId));

        if (!product) return;

        const existing = state.cart.get(product.id);
        const nextQuantity = existing ? existing.quantity + 1 : 1;

        if (nextQuantity > Number(product.stock)) {
            showAlert('warning', 'Not enough stock available for this product.');
            return;
        }

        state.cart.set(product.id, {
            id: product.id,
            sku: product.sku,
            name: product.name,
            price: Number(product.price),
            stock: Number(product.stock),
            quantity: nextQuantity,
            discount: existing ? existing.discount : 0
        });

        hideAlert();
        renderCart();
    }

    function updateCartQuantity(productId, quantity) {
        const item = state.cart.get(Number(productId));
        if (!item) return;

        const safeQuantity = Math.max(1, Math.min(Number(quantity || 1), item.stock));
        item.quantity = safeQuantity;
        state.cart.set(item.id, item);
        renderCart();
    }

    function removeFromCart(productId) {
        state.cart.delete(Number(productId));
        renderCart();
    }

    function getTotals() {
        const subtotal = Array.from(state.cart.values()).reduce((sum, item) => {
            return sum + (item.price * item.quantity);
        }, 0);
        const discount = Math.min(Number(els.globalDiscount ? els.globalDiscount.value || 0 : 0), subtotal);
        const taxable = Math.max(subtotal - discount, 0);
        const tax = taxable * state.taxRate;
        const total = taxable + tax;

        return { subtotal, discount, tax, total };
    }

    function renderCart() {
        if (!els.cartList) return;
        const items = Array.from(state.cart.values());

        if (!items.length) {
            els.cartList.innerHTML = `
                <div class="empty-state">
                    <div>
                        <i class="bi bi-cart3 fs-1 d-block mb-2"></i>
                        Select products to begin a sale.
                    </div>
                </div>
            `;
            if (els.cartCount) els.cartCount.textContent = 'No items added';
        } else {
            els.cartList.innerHTML = items.map((item) => `
                <div class="cart-item" data-cart-id="${item.id}">
                    <div>
                        <div class="cart-item-name">${escapeHtml(item.name)}</div>
                        <div class="cart-item-meta">${money(item.price)} x ${item.quantity}</div>
                        <div class="cart-item-meta fw-bold">${money(item.price * item.quantity)}</div>
                    </div>
                    <div class="qty-control" aria-label="Quantity for ${escapeHtml(item.name)}">
                        <button type="button" data-qty-action="decrease">-</button>
                        <input type="number" min="1" max="${item.stock}" value="${item.quantity}" data-qty-input>
                        <button type="button" data-qty-action="increase">+</button>
                    </div>
                    <button type="button" class="remove-btn" data-remove-item aria-label="Remove ${escapeHtml(item.name)}">
                        <i class="bi bi-x-lg"></i>
                    </button>
                </div>
            `).join('');
            const count = items.reduce((sum, item) => sum + item.quantity, 0);
            if (els.cartCount) els.cartCount.textContent = `${count} item${count === 1 ? '' : 's'} in cart`;
        }

        const totals = getTotals();
        if (els.subtotalAmount) els.subtotalAmount.textContent = money(totals.subtotal);
        if (els.discountAmount) els.discountAmount.textContent = money(totals.discount);
        if (els.taxAmount) els.taxAmount.textContent = money(totals.tax);
        if (els.totalAmount) els.totalAmount.textContent = money(totals.total);
    }

    async function submitCheckout(paymentMethod) {
        const items = Array.from(state.cart.values());

        if (!items.length) {
            showAlert('warning', 'Add at least one product before checkout.');
            return;
        }

        if (paymentMethod === 'mpesa' && (!els.mpesaPhone || !els.mpesaPhone.value.trim())) {
            showAlert('warning', 'Enter the customer Mpesa phone number.');
            if (els.mpesaPhone) els.mpesaPhone.focus();
            return;
        }

        const payload = {
            customer_name: els.customerName ? (els.customerName.value.trim() || 'Walk-in customer') : 'Walk-in customer',
            payment_method: paymentMethod,
            mpesa_phone: els.mpesaPhone ? els.mpesaPhone.value.trim() : '',
            discount: Number(els.globalDiscount ? els.globalDiscount.value || 0 : 0),
            items: items.map((item) => ({
                product_id: item.id,
                sku: item.sku,
                name: item.name,
                price: item.price,
                quantity: item.quantity
            }))
        };

        setCheckoutLoading(true);
        hideAlert();

        try {
            const data = await window.KaringApi.submitCheckout(payload);

            if (paymentMethod !== 'mpesa') {
                state.cart.clear();
                if (els.globalDiscount) els.globalDiscount.value = '0';
                if (els.mpesaPhone) els.mpesaPhone.value = '';
                renderCart();
            }
            showAlert(paymentMethod === 'mpesa' ? 'info' : 'success', data.message || `Sale ${data.sale_reference} completed successfully.`);
            return data;
        } catch (error) {
            showAlert('danger', error.message);
            throw error;
        } finally {
            setCheckoutLoading(false);
        }
    }

    function setCheckoutLoading(isLoading) {
        if (els.cashCheckoutBtn) {
            els.cashCheckoutBtn.disabled = isLoading;
            els.cashCheckoutBtn.innerHTML = isLoading
                ? '<span class="spinner-border spinner-border-sm"></span> Processing'
                : '<i class="bi bi-cash-stack"></i> Cash';
        }
        if (els.cardCheckoutBtn) {
            els.cardCheckoutBtn.disabled = isLoading;
            els.cardCheckoutBtn.innerHTML = isLoading
                ? '<span class="spinner-border spinner-border-sm"></span> Processing'
                : '<i class="bi bi-credit-card"></i> Card';
        }
        if (els.mpesaCheckoutBtn) {
            els.mpesaCheckoutBtn.disabled = isLoading;
            els.mpesaCheckoutBtn.innerHTML = isLoading
                ? '<span class="spinner-border spinner-border-sm"></span> Processing'
                : '<i class="bi bi-phone"></i> M-PESA';
        }
    }

    async function sendMpesaStk(saleId) {
        const phone = normalizeKenyanPhone(els.mpesaPhone ? els.mpesaPhone.value : '');
        if (!phone) {
            showAlert('warning', 'Enter a valid Kenyan phone number, for example 254712345678.');
            if (els.mpesaPhone) els.mpesaPhone.focus();
            return;
        }

        showAlert('info', 'Sending STK Push...');

        const data = await window.KaringApi.initiateMpesaStk(saleId, phone);

        showAlert('info', 'Waiting for customer...');
        await pollMpesaStatus(saleId, data.checkout_request_id);
    }

    async function pollMpesaStatus(saleId, checkoutRequestId) {
        const startedAt = Date.now();
        const timeoutMs = 120000;

        return new Promise((resolve, reject) => {
            const timer = setInterval(async () => {
                try {
                    const data = await window.KaringApi.checkMpesaStatus(saleId, checkoutRequestId);

                    if (data.status === 'success') {
                        clearInterval(timer);
                        showAlert('success', `Payment Successful. Receipt: ${data.receipt_number || 'M-PESA confirmed'}`);
                        window.open(`/modules/receipts/receipt.html?sale_id=${saleId}`, '_blank');
                        resolve(data);
                    } else if (data.status === 'cancelled') {
                        clearInterval(timer);
                        showAlert('warning', 'Cancelled by customer.');
                        reject(new Error('Cancelled'));
                    } else if (data.status === 'timeout') {
                        clearInterval(timer);
                        showAlert('warning', 'Payment timed out. Ask the customer to try again.');
                        reject(new Error('Timeout'));
                    } else if (data.status === 'failed') {
                        clearInterval(timer);
                        showAlert('danger', data.result_description || 'Payment Failed.');
                        reject(new Error('Payment Failed'));
                    } else if (Date.now() - startedAt > timeoutMs) {
                        clearInterval(timer);
                        showAlert('warning', 'Timeout while waiting for customer confirmation.');
                        reject(new Error('Timeout'));
                    }
                } catch (error) {
                    clearInterval(timer);
                    reject(error);
                }
            }, 4000);
        });
    }

    if (els.productSearch) {
        els.productSearch.addEventListener('input', () => {
            clearTimeout(state.searchTimer);
            state.searchTimer = setTimeout(loadProducts, 250);
        });
    }

    if (els.categoryFilter) {
        els.categoryFilter.addEventListener('change', loadProducts);
    }

    if (els.productGrid) {
        els.productGrid.addEventListener('click', (event) => {
            const card = event.target.closest('[data-product-id]');
            if (card) {
                addToCart(card.dataset.productId);
            }
        });
    }

    if (els.cartList) {
        els.cartList.addEventListener('click', (event) => {
            const itemEl = event.target.closest('[data-cart-id]');
            if (!itemEl) return;

            const productId = Number(itemEl.dataset.cartId);
            const item = state.cart.get(productId);

            if (event.target.closest('[data-remove-item]')) {
                removeFromCart(productId);
                return;
            }

            const action = event.target.dataset.qtyAction;
            if (action === 'increase') {
                updateCartQuantity(productId, item.quantity + 0.25);
            }
            if (action === 'decrease') {
                updateCartQuantity(productId, item.quantity - 0.25);
            }
        });

        els.cartList.addEventListener('change', (event) => {
            if (!event.target.matches('[data-qty-input]')) return;
            const itemEl = event.target.closest('[data-cart-id]');
            updateCartQuantity(Number(itemEl.dataset.cartId), Number(event.target.value));
        });
    }

    if (els.globalDiscount) {
        els.globalDiscount.addEventListener('input', renderCart);
    }

    if (els.clearCartBtn) {
        els.clearCartBtn.addEventListener('click', () => {
            state.cart.clear();
            renderCart();
            hideAlert();
        });
    }

    if (els.cashCheckoutBtn) els.cashCheckoutBtn.addEventListener('click', () => submitCheckout('cash').catch(() => {}));
    if (els.cardCheckoutBtn) els.cardCheckoutBtn.addEventListener('click', () => submitCheckout('card').catch(() => {}));
    if (els.mpesaCheckoutBtn) {
        els.mpesaCheckoutBtn.addEventListener('click', async () => {
            setCheckoutLoading(true);
            try {
                const phone = normalizeKenyanPhone(els.mpesaPhone ? els.mpesaPhone.value : '');
                if (!phone) {
                    showAlert('warning', 'Enter a valid Kenyan phone number, for example 254712345678.');
                    if (els.mpesaPhone) els.mpesaPhone.focus();
                    return;
                }

                const checkout = await submitCheckout('mpesa');
                if (!checkout || !checkout.sale_id) return;
                await sendMpesaStk(checkout.sale_id);
                state.cart.clear();
                if (els.globalDiscount) els.globalDiscount.value = '0';
                if (els.mpesaPhone) els.mpesaPhone.value = '';
                renderCart();
            } catch (error) {
                if (!['Cancelled', 'Timeout', 'Payment Failed'].includes(error.message)) {
                    showAlert('danger', error.message || 'M-PESA payment could not be completed.');
                }
            } finally {
                setCheckoutLoading(false);
            }
        });
    }

    window.KaringLayout.init({ allowedRoles: ['super_admin', 'admin', 'cashier'] });
    loadCategories();
    loadProducts();
    renderCart();
})();
