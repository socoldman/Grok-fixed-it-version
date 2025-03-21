const { createClient } = require('@supabase/supabase-js');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;
const DOMPurify = require('dompurify')(new JSDOM('').window);

// Supabaseクライアントの初期化
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    throw new Error('SupabaseのURLとAnonキーが必要です');
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const window = new JSDOM('').window;
const purify = DOMPurify(window);

// 入力検証関数
function validateInput(input, type = 'content') {
    const maxLength = type === 'title' ? 100 : 1000;
    return typeof input === 'string' && input.length > 0 && input.length <= maxLength && !/<script/i.test(input);
}

export default async function handler(req, res) {
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
        const { title, content, user_id } = req.body;
        if (!title || !content) {
            return res.status(400).json({ error: 'タイトルと本文は必須です' });
        }
        if (!validateInput(title, 'title') || !validateInput(content)) {
            return res.status(400).json({ error: '無効な入力内容です' });
        }
        try {
            const sanitizedTitle = purify.sanitize(title);
            const sanitizedContent = purify.sanitize(content);
            const { data, error } = await supabase
                .from('threads')
                .insert([{ title: sanitizedTitle, content: sanitizedContent, user_id: user_id || '名無しさん' }])
                .select();
            if (error) throw error;
            res.status(201).json(data);
        } catch (error) {
            res.status(500).json({ error: 'スレッド作成に失敗しました', details: error.message });
        }
    } else {
        res.status(405).json({ error: 'Method Not Allowed' });
    }
}
