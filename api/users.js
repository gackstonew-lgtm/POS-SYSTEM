const { createVercelAdapter } = require('../lib/adapter');
const users = require('../lib/users');

module.exports = createVercelAdapter(users.handler);
