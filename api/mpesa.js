const { createVercelAdapter } = require('../lib/adapter');
const mpesa = require('../lib/mpesa');

module.exports = createVercelAdapter(mpesa.handler);
