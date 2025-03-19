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
    } else {
        res.status(405).json({ error: 'Method Not Allowed' });
    }
}
