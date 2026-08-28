const { createVercelAdapter } = require('../lib/adapter');
const dashboard = require('../lib/dashboard');

module.exports = createVercelAdapter(dashboard.handler);
