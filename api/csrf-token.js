const { applyMiddleware, applyCsrfToken } = require('./lib/middleware');

module.exports = async (req, res) => {
    await applyMiddleware(req, res, async () => {
        if (req.method !== 'GET') {
            return res.status(405).json({ error: 'Method Not Allowed' });
        }
        await applyCsrfToken(req, res);
    });
};