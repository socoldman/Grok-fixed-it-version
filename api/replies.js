const { createClient } = require('@supabase/supabase-js');
const { applyMiddleware, applyCsrfProtection } = require('./lib/middleware');
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

function validateInput(input) {
    if (!input || typeof input !== 'string') return false;
    const maxLength = 1000;
    if (input.length > maxLength) return false;
    const dangerousPatterns = [/javascript:/i, /data:/i, /vbscript:/i, /onload=/i, /onerror=/i, /<script/i, /<iframe/i, /<object/i, /<embed/i];
    return !dangerousPatterns.some(pattern => pattern.test(input));
}

module.exports = async (req, res) => {
    await applyMiddleware(req, res, async () => {
        if (req.method === 'GET') {
            const { thread_id } = req.query;
            if (!thread_id) {
                return res.status(400).json({ error: 'スレッドIDが必要です' });
            }
            try {
                const { data, error } = await supabase
                    .from('replies')
                    .select('*')
                    .eq('thread_id', thread_id.toString())
                    .order('created_at', { ascending: true });
                if (error) throw error;
                res.status(200).json(data);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        } else if (req.method === 'POST') {
            await applyCsrfProtection(req, res, async () => {
                const { thread_id, content, user_id } = req.body;
                if (!thread_id || !content) {
                    return res.status(400).json({ error: 'スレッドIDと本文は必須です' });
                }
                if (!validateInput(content)) {
                    return res.status(400).json({ error: '無効な入力内容です' });
                }
                try {
                    const sanitizedContent = DOMPurify.sanitize(content);
                    const { data, error } = await supabase
                        .from('replies')
                        .insert([{ thread_id, content: sanitizedContent, user_id: user_id || '名無しさん' }])
                        .select();
                    if (error) throw error;
                    res.status(200).json(data);
                } catch (error) {
                    res.status(500).json({ error: '返信作成に失敗しました', details: error.message });
                }
            });
        } else {
            res.status(405).json({ error: 'Method Not Allowed' });
        }
    });
};