const { createVercelAdapter } = require('../lib/adapter');
const checkout = require('../lib/checkout');

module.exports = createVercelAdapter(checkout.handler);
