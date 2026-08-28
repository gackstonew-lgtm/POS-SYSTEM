function createVercelAdapter(handler) {
  return async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');

    if (req.method === 'OPTIONS') {
      return res.status(200).json({ success: true });
    }

    let parsedBody = req.body;
    if (Buffer.isBuffer(parsedBody)) {
      parsedBody = parsedBody.toString('utf-8');
    } else if (typeof parsedBody === 'object' && parsedBody !== null) {
      parsedBody = JSON.stringify(parsedBody);
    } else if (!parsedBody) {
      parsedBody = '{}';
    }

    const event = {
      httpMethod: req.method,
      headers: req.headers || {},
      queryStringParameters: req.query || {},
      body: parsedBody,
      path: req.url || ''
    };

    try {
      const response = await handler(event);
      const statusCode = response.statusCode || 200;

      if (response.headers) {
        Object.entries(response.headers).forEach(([k, v]) => res.setHeader(k, v));
      }

      let bodyData = response.body;
      if (typeof bodyData === 'string') {
        try {
          bodyData = JSON.parse(bodyData);
        } catch (e) {}
      }

      return res.status(statusCode).json(bodyData);
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  };
}

module.exports = { createVercelAdapter };
