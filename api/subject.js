const { createClient } = require('@supabase/supabase-js');
const { applyMiddleware } = require('./lib/middleware');
const iconv = require('iconv-lite');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

function escapeHtml(unsafe) {
    if (!unsafe) return '';
    const anchors = [];
    let text = unsafe;
    let counter = 0;

    text = text.replace(/>>\d+/g, match => {
        anchors.push(match);
        return `___ANCHOR${counter++}___`;
    });

    text = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');

    anchors.forEach((anchor, i) => {
        const num = anchor.substring(2);
        text = text.replace(`___ANCHOR${i}___`, `>>${num}`);
    });

    return text;
}

module.exports = async (req, res) => {
    await applyMiddleware(req, res, async () => {
        if (req.method !== 'GET') {
            return res.status(405).json({ error: 'Method Not Allowed' });
        }

        try {
            const { data: threads, error } = await supabase
                .from('threads')
                .select('id, title, created_at, replies(count)')
                .order('created_at', { ascending: false });
            if (error) throw error;

            const content = threads.map(thread => {
                const count = thread.replies[0]?.count || 0;
                return `${thread.id}.dat<>${escapeHtml(thread.title)} (${count})`;
            }).join('\n');

            const shiftJisBuffer = iconv.encode(content, 'Shift_JIS');
            res.setHeader('Content-Type', 'text/plain; charset=Shift_JIS');
            res.send(shiftJisBuffer);
        } catch (error) {
            res.status(500).send('エラーが発生しました');
        }
    });
};