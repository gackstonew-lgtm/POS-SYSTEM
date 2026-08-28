const { createVercelAdapter } = require('../lib/adapter');
const receipts = require('../lib/receipts');

module.exports = createVercelAdapter(receipts.handler);
