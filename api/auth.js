const { createVercelAdapter } = require('../lib/adapter');
const auth = require('../lib/auth');

module.exports = createVercelAdapter(auth.handler);
