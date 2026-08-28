const { createVercelAdapter } = require('../lib/adapter');
const reports = require('../lib/reports');

module.exports = createVercelAdapter(reports.handler);
