const { applyMiddleware } = require('./lib/middleware');

module.exports = async (req, res) => {
    await applyMiddleware(req, res, async () => {
        if (req.method !== 'GET') {
            return res.status(405).json({ error: 'Method Not Allowed' });
        }

        try {
            if (!process.env.SUPABASE_URL) throw new Error('SUPABASE_URLが設定されていません');
            if (!process.env.SUPABASE_ANON_KEY) throw new Error('SUPABASE_ANON_KEYが設定されていません');

            const config = {
                supabaseUrl: process.env.SUPABASE_URL,
                environment: process.env.NODE_ENV || 'development'
            };
            res.status(200).json(config);
        } catch (error) {
            res.status(500).json({ error: '設定情報の取得に失敗しました', details: error.message });
        }
    });
};