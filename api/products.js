const { createVercelAdapter } = require('../lib/adapter');
const products = require('../lib/products');

module.exports = createVercelAdapter(products.handler);
