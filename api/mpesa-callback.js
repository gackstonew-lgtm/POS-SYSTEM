const { createVercelAdapter } = require('../lib/adapter');
const mpesaCallback = require('../lib/mpesa-callback');

module.exports = createVercelAdapter(mpesaCallback.handler);
