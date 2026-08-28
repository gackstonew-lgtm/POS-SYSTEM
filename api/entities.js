const { createVercelAdapter } = require('../lib/adapter');
const entities = require('../lib/entities');

module.exports = createVercelAdapter(entities.handler);
