const { createClient } = require('@supabase/supabase-js');
const { applyMiddleware, applyCsrfProtection } = require('./lib/middleware');
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

function validateInput(input, type = 'content') {
    if (!input || typeof input !== 'string') return false;
    const maxLength = type === 'title' ? 100 : 1000;
    if (input.length > maxLength) return false;
    const dangerousPatterns = [/javascript:/i, /data:/i, /vbscript:/i, /onload=/i, /onerror=/i, /<script/i, /<iframe/i, /<object/i, /<embed/i];
    return !dangerousPatterns.some(pattern => pattern.test(input));
}

module.exports = async (req, res) => {
    await applyMiddleware(req, res, async () => {
        if (req.method === 'GET') {
            try {
                const { data, error } = await supabase
                    .from('threads')
                    .select('*, replies(count)')
                    .order('created_at', { ascending: false });
                if (error) throw error;
                res.status(200).json(data);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        } else if (req.method === 'POST') {
            await applyCsrfProtection(req, res, async () => {
                const { title, content, user_id } = req.body;
                if (!title || !content) {
                    return res.status(400).json({ error: 'タイトルと本文は必須です' });
                }
                if (!validateInput(title, 'title') || !validateInput(content)) {
                    return res.status(400).json({ error: '無効な入力内容です' });
                }
                try {
                    const sanitizedTitle = DOMPurify.sanitize(title);
                    const sanitizedContent = DOMPurify.sanitize(content);
                    const { data, error } = await supabase
                        .from('threads')
                        .insert([{ title: sanitizedTitle, content: sanitizedContent, user_id: user_id || '名無しさん' }])
                        .select();
                    if (error) throw error;
                    res.status(200).json(data);
                } catch (error) {
                    res.status(500).json({ error: 'スレッド作成に失敗しました', details: error.message });
                }
            });
        } else {
            res.status(405).json({ error: 'Method Not Allowed' });
        }
    });
};