const API_URL = window.location.origin;
let supabaseClient = null;
let csrfToken = null;

async function fetchCsrfToken() {
    try {
        const response = await fetch('/api/csrf-token', { credentials: 'include' });
        if (!response.ok) throw new Error('CSRFトークンの取得に失敗');
        const data = await response.json();
        csrfToken = data.csrfToken;
        console.log('CSRFトークンを取得:', csrfToken);
        return csrfToken;
    } catch (error) {
        console.warn('CSRFトークン取得エラー:', error);
        return null;
    }
}

// リアルタイム更新のサブスクリプション
function setupRealtimeSubscriptions() {
    if (!supabaseClient) {
        console.warn('Supabaseクライアントが初期化されていないため、リアルタイム更新を設定できません');
        return;
    }

    try {
        supabaseClient
            .channel('public:threads')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'threads' }, () => {
                // URLからスレッドIDを取得
                const urlParams = new URLSearchParams(window.location.search);
                const threadId = urlParams.get('thread');
                
                if (!threadId) {
                    // スレッド一覧表示中の場合は一覧を更新
                    fetchThreads();
                }
            })
            .subscribe();

        supabaseClient
            .channel('public:replies')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'replies' }, payload => {
                // URLからスレッドIDを取得
                const urlParams = new URLSearchParams(window.location.search);
                const threadId = urlParams.get('thread');
                
                if (threadId && payload.new && payload.new.thread_id === threadId) {
                    // 現在表示中のスレッドへの書き込みがあった場合は更新
                    fetchPosts(threadId);
                }
            })
            .subscribe();
    } catch (error) {
        console.error('リアルタイム更新の設定に失敗:', error);
    }
}

// Supabaseクライアントの初期化関数
function initSupabase() {
    fetch('/api/config', { credentials: 'include' })
        .then(response => {
            if (!response.ok) throw new Error('設定の取得に失敗');
            return response.json();
        })
        .then(data => {
            supabaseClient = window.supabase.createClient(data.url, data.anonKey, {
                auth: { persistSession: false }
            });
            console.log('Supabaseクライアント初期化成功');
            loadInitialData();
            setupRealtimeSubscriptions();
        })
        .catch(error => {
            console.error('Supabase初期化エラー:', error);
            document.getElementById("threads-list").innerHTML = `
                <div class="error"><p>データベース接続に失敗しました: ${error.message}</p></div>
            `;
        });
}

// フォールバックの環境変数設定を削除
window.addEventListener('error', function(event) {
    if (event.message && (
        event.message.includes('Cannot read properties of null') || 
        event.message.includes('from') || 
        event.message.includes('channel')
    )) {
        console.error('Supabaseクライアントのエラーが発生しました。');
        document.getElementById("threads-list").innerHTML = `
            <div class="error">
                <p>データベース接続に失敗しました。管理者にお問い合わせください。</p>
            </div>
        `;
    }
}, {once: true});

// 初期データの取得
function loadInitialData() {
    // CSRFトークンを取得
    fetchCsrfToken();
    
    // URLからスレッドIDを取得
    const urlParams = new URLSearchParams(window.location.search);
    const threadId = urlParams.get('thread');
    
    if (threadId) {
        // スレッドIDがある場合はスレッド詳細を表示
        displayThreadDetail(threadId);
    } else {
        // スレッドIDがない場合はスレッド一覧を表示
        fetchThreads();
    }
}

async function fetchCsrfToken() {
    try {
        const response = await fetch('/csrf-token');
        if (!response.ok) {
            const errorData = await response.json();
            console.warn('CSRFトークンの取得に失敗:', errorData);
            return;
        }
        
        const data = await response.json();
        csrfToken = data.csrfToken;
        console.log('CSRFトークンを取得しました');
    } catch (error) {
        console.warn('CSRFトークンの取得中にエラーが発生しました:', error);
        // エラーが発生してもアプリは続行
    }
}

// **スレッド一覧を取得＆表示**
async function fetchThreads() {
    try {
        const { data: threads, error } = await supabaseClient
            .from('threads')
            .select(`
                *,
                replies: replies(count)
            `)
            .order('created_at', { ascending: false });

        if (error) throw error;

        const threadsListDiv = document.getElementById("threads-list");
        threadsListDiv.innerHTML = "";

        if (threads.length === 0) {
            threadsListDiv.innerHTML = "<p>まだスレッドがありません。</p>";
            return;
        }

        threads.forEach((thread, index) => {
            const threadDiv = document.createElement("div");
            threadDiv.className = "thread";
            threadDiv.innerHTML = `
                <div class="thread-header">
                    <strong>${index + 1}. ${escapeHtml(thread.title)}</strong>
                    <span class="thread-meta">
                        レス数: ${thread.replies[0]?.count || 0}
                        <button class="open-thread-btn" data-thread-id="${thread.id}">スレッドを開く</button>
                    </span>
                </div>
                <p class="thread-content">${escapeHtml(thread.content)}</p>
            `;

            threadsListDiv.appendChild(threadDiv);
        });

        // イベントリスナーをバインド
        bindOpenThreadLinks();

    } catch (error) {
        console.error("スレッドの取得に失敗:", error);
        document.getElementById("threads-list").innerHTML = `
            <div class="error">スレッドの取得に失敗しました: ${error.message}</div>
        `;
    }
}

// スレッドを開く
function openThread(threadId) {
    // 現在のURLを保存
    const currentUrl = window.location.href;
    
    // 新しいURLを作成（クエリパラメータでスレッドIDを渡す）
    const newUrl = currentUrl.split('?')[0] + `?thread=${threadId}`;
    
    // URLを変更（ページ遷移なし）
    window.history.pushState({ threadId }, '', newUrl);
    
    // スレッドの詳細を表示
    displayThreadDetail(threadId);
}

// スレッドの詳細を表示
async function displayThreadDetail(threadId) {
    try {
        // スレッド情報を取得
        const { data: thread, error: threadError } = await supabaseClient
            .from('threads')
            .select('*')
            .eq('id', threadId)
            .single();

        if (threadError) throw threadError;

        // スレッド詳細を表示するためのHTMLを作成
        const threadsListDiv = document.getElementById("threads-list");
        threadsListDiv.innerHTML = `
            <div class="thread-detail">
                <div class="thread-navigation">
                    <button id="back-to-list-btn">← スレッド一覧に戻る</button>
                </div>
                <div class="thread-header">
                    <h3>${escapeHtml(thread.title)}</h3>
                    <span class="thread-date">作成日: ${new Date(thread.created_at).toLocaleString()}</span>
                </div>
                <div class="thread-original-post">
                    <div class="post" id="post-1">
                        <div class="post-header">
                            <span class="post-number">1</span>
                            <span class="post-date">${new Date(thread.created_at).toLocaleString()}</span>
                        </div>
                        <div class="post-content">${escapeHtml(thread.content)}</div>
                    </div>
                </div>
                
                <div id="posts-container">読み込み中...</div>
                
                <div class="post-form">
                    <h4>書き込む</h4>
                    <textarea id="post-content" 
                        placeholder="コメントを入力 (>>1 でレスアンカーを付けられます)"></textarea>
                    <div class="post-buttons">
                        <button id="post-comment-btn">書き込む</button>
                        <button id="read-all-btn">全部読む</button>
                        <button id="read-latest-btn">最新50</button>
                        <button id="read-prev-btn">前100</button>
                        <button id="read-next-btn">次100</button>
                    </div>
                </div>
            </div>
        `;

        // ボタンのイベントリスナーを設定
        document.getElementById('back-to-list-btn').addEventListener('click', fetchThreads);
        document.getElementById('post-comment-btn').addEventListener('click', () => postComment(threadId));
        document.getElementById('read-all-btn').addEventListener('click', () => fetchPosts(threadId, 1000, 0));
        document.getElementById('read-latest-btn').addEventListener('click', () => fetchPosts(threadId, 50, 0));
        document.getElementById('read-prev-btn').addEventListener('click', () => fetchPosts(threadId, 100, currentOffset - 100));
        document.getElementById('read-next-btn').addEventListener('click', () => fetchPosts(threadId, 100, currentOffset + 100));

        // キー入力イベントも設定
        document.getElementById('post-content').addEventListener('keydown', (event) => handlePostInput(event, threadId));

        // IDコントロールを追加
        addIdControls();

        // レスを取得して表示
        fetchPosts(threadId);

    } catch (error) {
        console.error("スレッド詳細の取得に失敗:", error);
        document.getElementById("threads-list").innerHTML = `
            <div class="error">
                <p>スレッド詳細の取得に失敗しました: ${error.message}</p>
                <button onclick="fetchThreads()">スレッド一覧に戻る</button>
            </div>
        `;
    }
}

// 現在のオフセット（ページネーション用）
let currentOffset = 0;

// レスを取得して表示
async function fetchPosts(threadId, limit = 1000, offset = 0) {
    currentOffset = offset;
    
    try {
        const { data: posts, error } = await supabaseClient
            .from('replies')
            .select('*')
            .eq('thread_id', threadId)
            .order('created_at', { ascending: true })
            .range(offset, offset + limit - 1);

        if (error) throw error;

        const postsContainer = document.getElementById("posts-container");
        
        if (!postsContainer) return;

        if (posts.length === 0) {
            postsContainer.innerHTML = "<p class='no-posts'>まだ書き込みがありません。</p>";
            return;
        }

        // スレッド本文を取得
        const { data: thread, error: threadError } = await supabaseClient
            .from('threads')
            .select('*')
            .eq('id', threadId)
            .single();

        if (threadError) throw threadError;

        // 全レスの内容をマップに保存（ホバー表示用）
        const allPosts = new Map();
        // スレッド本文を1番として保存
        allPosts.set(1, {
            content: thread.content,
            date: new Date(thread.created_at).toLocaleString(),
            user_id: thread.user_id || '名無しさん'
        });
        
        // レスの内容を保存
        posts.forEach((post, index) => {
            const postNumber = offset + index + 2;
            allPosts.set(postNumber, {
                content: post.content,
                date: new Date(post.created_at).toLocaleString(),
                user_id: post.user_id || '名無しさん'
            });
        });

        // 改行を処理する関数（空の改行は5行までに制限）
        function formatContent(content) {
            // 連続する改行を検出して制限する
            let formattedContent = content.replace(/(\n\s*){6,}/g, '\n\n\n\n\n');
            // 改行をHTMLの<br>タグに変換
            return formattedContent.replace(/\n/g, '<br>');
        }

        // HTMLを生成
        let postsHTML = '';
        
        posts.forEach((post, index) => {
            const postNumber = offset + index + 2; // スレッド本文が1番なので、レスは2番から
            if (postNumber > 1000) return; // 1000レス制限

            // コンテンツ内のアンカーをリンクに変換
            let contentWithLinks = post.content.replace(
                />>\d+/g,
                match => {
                    const num = match.substring(2);
                    const targetPost = allPosts.get(parseInt(num));
                    if (targetPost) {
                        return `<a href="#post-${num}" class="anchor" onclick="highlightPost(${num})">${match}</a>`;
                    }
                    return match;
                }
            );
            
            // 改行を処理
            contentWithLinks = formatContent(contentWithLinks);
            
            // 投稿のHTMLを生成
            postsHTML += generatePostHtml(post, postNumber, contentWithLinks);
        });
        
        // HTMLをDOMに適用
        postsContainer.innerHTML = postsHTML;

        // スレッド本文の改行も反映
        const threadPost = document.getElementById('post-1');
        if (threadPost) {
            const contentDiv = threadPost.querySelector('.post-content');
            if (contentDiv) {
                contentDiv.innerHTML = formatContent(thread.content);
            }
            // スレッド本文にもIDを表示
            const footerDiv = document.createElement('div');
            footerDiv.className = 'post-footer';
            footerDiv.innerHTML = `<span class="post-id">${thread.user_id || '名無しさん'}</span>`;
            threadPost.appendChild(footerDiv);
        }

    } catch (error) {
        console.error("レスの取得に失敗:", error);
        const postsContainer = document.getElementById("posts-container");
        if (postsContainer) {
            postsContainer.innerHTML = `
                <div class="error">
                    <p>レスの取得に失敗しました: ${error.message}</p>
                    <button onclick="fetchPosts('${threadId}')">再試行</button>
                </div>
            `;
        }
    }
}

// レスアンカークリック時のハイライト処理
function highlightPost(number) {
    // 前回のハイライトを削除
    const previousHighlight = document.querySelector('.post-highlight');
    if (previousHighlight) {
        previousHighlight.classList.remove('post-highlight');
    }

    // 新しいレスをハイライト
    const targetPost = document.getElementById(`post-${number}`);
    if (targetPost) {
        targetPost.classList.add('post-highlight');
        targetPost.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

// ID生成とCookie管理のための関数
function generateRandomId() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let id = '';
    for (let i = 0; i < 8; i++) {
        id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
}

// ユーザーID管理
function getUserId() {
    let userId = localStorage.getItem('userId');
    if (!userId) {
        // ランダムIDの生成
        userId = 'ID:' + Math.random().toString(36).substring(2, 8);
        localStorage.setItem('userId', userId);
    }
    return userId;
}

// ID検索機能
function searchByUserId(userId) {
    const posts = document.querySelectorAll('.post');
    posts.forEach(post => {
        const postId = post.querySelector('.post-id').textContent.replace('ID: ', '');
        if (postId === userId) {
            post.classList.add('highlight-id');
        } else {
            post.classList.remove('highlight-id');
        }
    });
}

// セッションIDの生成と管理
function generateSessionId() {
    const random = Math.random().toString(36).substring(2, 8);
    return `ID:${random}`;
}

function getSessionId() {
    let sessionId = sessionStorage.getItem('sessionId');
    if (!sessionId) {
        sessionId = generateSessionId();
        sessionStorage.setItem('sessionId', sessionId);
    }
    return sessionId;
}

// NGリストの管理（3種類）
function getNgList(type) {
    const key = `ngList_${type}`;
    const ngList = localStorage.getItem(key);
    return ngList ? JSON.parse(ngList) : [];
}

function addToNgList(type, value) {
    const ngList = getNgList(type);
    if (!ngList.includes(value)) {
        ngList.push(value);
        localStorage.setItem(`ngList_${type}`, JSON.stringify(ngList));
        return true;
    }
    return false;
}

function removeFromNgList(type, value) {
    const ngList = getNgList(type);
    const index = ngList.indexOf(value);
    if (index > -1) {
        ngList.splice(index, 1);
        localStorage.setItem(`ngList_${type}`, JSON.stringify(ngList));
        return true;
    }
    return false;
}

// 投稿フォームにNG機能のUIを追加
function addIdControls() {
    const postForm = document.querySelector('.post-form');
    if (!postForm) return;

    const idControls = document.createElement('div');
    idControls.className = 'id-controls';
    idControls.innerHTML = `
        <div class="id-input-group">
            <input type="text" id="user-id" placeholder="IDを入力" readonly>
        </div>
        <div class="ng-controls">
            <div class="ng-section">
                <h4>ID NG設定</h4>
                <div class="ng-input-group">
                    <input type="text" id="ng-id" placeholder="NGにするIDを入力">
                    <button onclick="toggleNgValue('id', document.getElementById('ng-id').value)">追加/削除</button>
                </div>
                <div id="ng-id-list" class="ng-list"></div>
            </div>
            <div class="ng-section">
                <h4>スレッドタイトル NG設定</h4>
                <div class="ng-input-group">
                    <input type="text" id="ng-title" placeholder="NGにするタイトルを入力">
                    <button onclick="toggleNgValue('title', document.getElementById('ng-title').value)">追加/削除</button>
                </div>
                <div id="ng-title-list" class="ng-list"></div>
            </div>
            <div class="ng-section">
                <h4>単語 NG設定</h4>
                <div class="ng-input-group">
                    <input type="text" id="ng-word" placeholder="NGにする単語を入力">
                    <button onclick="toggleNgValue('word', document.getElementById('ng-word').value)">追加/削除</button>
                </div>
                <div id="ng-word-list" class="ng-list"></div>
            </div>
        </div>
    `;

    postForm.insertBefore(idControls, postForm.firstChild);

    // セッションIDを表示
    document.getElementById('user-id').value = getSessionId();
    
    // 現在のNGリストを表示
    updateNgLists();
}

// NGリストの表示を更新
function updateNgLists() {
    ['id', 'title', 'word'].forEach(type => {
        const list = getNgList(type);
        const container = document.getElementById(`ng-${type}-list`);
        if (container) {
            container.innerHTML = list.map(value => `
                <div class="ng-item">
                    <span>${escapeHtml(value)}</span>
                    <button onclick="toggleNgValue('${type}', '${value}')">削除</button>
                </div>
            `).join('');
        }
    });
}

// NG値の追加/削除をトグル
function toggleNgValue(type, value) {
    if (!value.trim()) return;
    
    if (getNgList(type).includes(value)) {
        removeFromNgList(type, value);
    } else {
        addToNgList(type, value);
    }
    
    // 入力フィールドをクリア
    document.getElementById(`ng-${type}`).value = '';
    
    // NGリストの表示を更新
    updateNgLists();
    
    // 表示を更新
    updateDisplay();
}

// スレッドとレスの表示を更新
function updateDisplay() {
    // スレッド一覧の場合
    const threads = document.querySelectorAll('.thread');
    threads.forEach(thread => {
        const title = thread.querySelector('.thread-header strong').textContent;
        const shouldHide = isNgContent('title', title);
        thread.style.display = shouldHide ? 'none' : '';
    });

    // レスの場合
    const posts = document.querySelectorAll('.post');
    posts.forEach(post => {
        const postId = post.querySelector('.post-id').textContent.replace('ID: ', '');
        const content = post.querySelector('.post-content').textContent;
        const shouldHide = 
            isNgContent('id', postId) || 
            getNgList('word').some(word => content.includes(word));
        
        if (shouldHide) {
            post.classList.add('ng-post');
        } else {
            post.classList.remove('ng-post');
        }
    });
}

// コンテンツがNGリストに該当するかチェック
function isNgContent(type, value) {
    const ngList = getNgList(type);
    if (type === 'word') {
        return ngList.some(word => value.includes(word));
    }
    return ngList.includes(value);
}

// エンターキーでの投稿処理
function handlePostInput(event, threadId) {
    // Ctrl + Enterで投稿
    if (event.key === 'Enter' && event.ctrlKey) {
        event.preventDefault(); // デフォルトの改行を防止
        postComment(threadId);
    }
}

// 入力値の検証関数を修正
function validateInput(input, type = 'content') {
    if (!input || typeof input !== 'string') {
        throw new Error('不正な入力です');
    }
    
    // 文字数制限を300文字に統一
    const maxLength = 300;
    
    if (input.length > maxLength) {
        throw new Error(`${type === 'title' ? 'タイトル' : '本文'}は300文字以内にしてください`);
    }
    
    // 危険な文字列のパターン
    const dangerousPatterns = [
        /javascript:/i,
        /data:/i,
        /vbscript:/i,
        /onload=/i,
        /onerror=/i,
        /<script/i,
        /<iframe/i,
        /<object/i,
        /<embed/i
    ];
    
    if (dangerousPatterns.some(pattern => pattern.test(input))) {
        throw new Error('不正な文字列が含まれています');
    }
    
    return true;
}

async function postThread() {
    try {
        if (!csrfToken) {
            csrfToken = await fetchCsrfToken();
            if (!csrfToken) throw new Error('CSRFトークンが取得できません');
        }

        const titleInput = document.getElementById('thread-title');
        const contentInput = document.getElementById('thread-content');
        const title = titleInput.value.trim();
        const content = contentInput.value.trim();

        if (!title || !content) throw new Error('タイトルと本文は必須です');
        validateInput(title, 'title'); // 入力検証を追加
        validateInput(content);

        const userId = getUserId();
        const postData = { title, content, user_id: userId };

        const response = await fetch(`${API_URL}/api/threads`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            },
            body: JSON.stringify(postData),
            credentials: 'include'
        });

        if (!response.ok) {
            const errorData = await response.json();
            if (response.status === 403 && errorData.error === 'Invalid CSRF token') {
                csrfToken = await fetchCsrfToken();
                if (!csrfToken) throw new Error('CSRFトークンの再取得に失敗');
                const retryResponse = await fetch(`${API_URL}/api/threads`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': csrfToken
                    },
                    body: JSON.stringify(postData),
                    credentials: 'include'
                });
                if (!retryResponse.ok) {
                    const retryErrorData = await retryResponse.json();
                    throw new Error(retryErrorData.error || 'スレッド作成に失敗');
                }
            } else {
                throw new Error(errorData.error || 'スレッド作成に失敗');
            }
        }

        titleInput.value = '';
        contentInput.value = '';
        fetchThreads();
        alert('スレッドが作成されました！');
    } catch (error) {
        alert(`エラー: ${error.message}`);
    }
}
// HTMLをエスケープする関数
function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// HTMLをアンエスケープする関数
function unescapeHtml(safe) {
    if (!safe) return '';
    return safe
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"")
        .replace(/&#039;/g, "'");
}

async function postComment(threadId) {
    try {
        if (!csrfToken) {
            csrfToken = await fetchCsrfToken();
            if (!csrfToken) throw new Error('CSRFトークンが取得できません');
        }
        const content = document.getElementById('post-content').value.trim();
        if (!content) throw new Error('コメントを入力してください');

        const userId = getUserId();
        const response = await fetch(`${API_URL}/api/replies`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            },
            body: JSON.stringify({ thread_id: threadId, content, user_id: userId }),
            credentials: 'include'
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'コメント投稿に失敗');
        }
        document.getElementById('post-content').value = '';
        fetchPosts(threadId);
    } catch (error) {
        console.error('コメント投稿エラー:', error);
        alert(`エラー: ${error.message}`);
    }
}

// スレッドの内容を表示する関数
function displayThread(thread) {
    const threadHtml = `
        <div class="thread">
            <h2>${thread.title}</h2>
            <p class="thread-content">${thread.content}</p>
            <p class="thread-info">
                投稿日時: ${new Date(thread.created_at).toLocaleString()}
            </p>
        </div>
    `;
    document.getElementById("thread-container").innerHTML = threadHtml;
}

// レスを表示する関数
function displayReplies(replies) {
    const repliesHtml = replies.map((reply, index) => `
        <div class="reply" id="res${index + 1}">
            <div class="reply-header">
                <span class="reply-number">${index + 1}</span>
                <span class="user-id">${reply.user_id || '名無しさん'}</span>
                <span class="reply-date">${new Date(reply.created_at).toLocaleString()}</span>
            </div>
            <p class="reply-content">${reply.content}</p>
        </div>
    `).join('');
    document.getElementById("replies-container").innerHTML = repliesHtml;
}

// テーマ切り替え機能
function initThemeToggle() {
    // テーマ切り替えボタンを作成
    const button = document.createElement('button');
    button.className = 'theme-toggle';
    button.innerHTML = '🌓';
    button.title = 'テーマを切り替え';
    document.body.appendChild(button);

    // 保存されたテーマを読み込む
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);

    // テーマ切り替えボタンのクリックイベント
    button.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        
        // ボタンの絵文字を更新
        button.innerHTML = newTheme === 'dark' ? '🌓' : '🌙';
    });
}

// ページ読み込み時にイベントリスナーを設定

document.addEventListener('DOMContentLoaded', () => {
    initSupabase();
    setupEventListeners();
});

// スレッドを開く処理（イベントリスナー用）
function bindOpenThreadLinks() {
    const threadLinks = document.querySelectorAll('.open-thread-btn');
    threadLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const threadId = link.getAttribute('data-thread-id');
            openThread(threadId);
        });
    });
}

// レスアンカーのプレビューを表示
function showPostPreview(element) {
    // 既存のプレビューを削除
    hidePostPreview();
    
    // プレビュー要素を作成
    const preview = document.createElement('div');
    preview.className = 'post-preview';
    
    // プレビュー内容を設定
    const postNumber = element.dataset.postNumber;
    const postDate = element.dataset.postDate;
    const postContent = element.dataset.postContent;
    
    preview.innerHTML = `
        <div class="post-preview-header">
            <span class="post-preview-number">No.${postNumber}</span>
            <span class="post-preview-date">${postDate}</span>
        </div>
        <div class="post-preview-content">${postContent.replace(/\n/g, '<br>')}</div>
    `;
    
    // プレビューの位置を設定
    const rect = element.getBoundingClientRect();
    preview.style.top = `${rect.bottom + window.scrollY}px`;
    preview.style.left = `${rect.left + window.scrollX}px`;
    
    // プレビューをDOMに追加
    document.body.appendChild(preview);
}

// レスアンカーのプレビューを非表示
function hidePostPreview() {
    const previews = document.querySelectorAll('.post-preview');
    previews.forEach(preview => preview.remove());
}

// プライベートブラウジングの検出
async function detectPrivateBrowsing() {
    try {
        // プライベートブラウジングの検出
        if (!window.localStorage) {
            throw new Error('プライベートブラウジングは使用できません');
        }
        return true;
    } catch (error) {
        alert(error.message);
        return false;
    }
}

// 投稿のHTML生成部分
function generatePostHtml(post, postNumber, contentWithLinks) {
    const postId = post.user_id || '名無しさん';
    const isNg = isNgContent('id', postId) || 
                 getNgList('word').some(word => post.content.includes(word));
    
    return `
        <div class="post ${isNg ? 'ng-post' : ''}" id="post-${postNumber}">
            <div class="post-header">
                <span class="post-number">${postNumber}</span>
                <span class="post-date">${new Date(post.created_at).toLocaleString()}</span>
            </div>
            <div class="post-content">${contentWithLinks}</div>
            <div class="post-footer">
                <span class="post-id">${postId}</span>
            </div>
        </div>
    `;
}

// 専ブラ対応のためのAPI関数
async function generateSettingsTxt() {
    const settings = `BBS_TITLE=リアルタイムちゃんねる
BBS_COMMENT=新世代の掲示板
BBS_NONAME_NAME=名無しさん
SUBREJECT_COUNT=1000
`;
    return settings;
}

async function generateSubjectTxt() {
    try {
        const { data: threads, error } = await supabaseClient
            .from('threads')
            .select(`
                id,
                title,
                created_at,
                replies(count)
            `)
            .order('created_at', { ascending: false });

        if (error) throw error;

        return threads.map(thread => {
            const count = thread.replies[0]?.count || 0;
            return `${thread.id}.dat<>${escapeHtml(thread.title)} (${count})\n`;
        }).join('');
    } catch (error) {
        console.error("subject.txt生成エラー:", error);
        return '';
    }
}

async function generateDatFile(threadId) {
    try {
        // スレッド情報を取得
        const { data: thread, error: threadError } = await supabaseClient
            .from('threads')
            .select('*')
            .eq('id', threadId)
            .single();

        if (threadError) throw threadError;

        // レスを取得
        const { data: replies, error: repliesError } = await supabaseClient
            .from('replies')
            .select('*')
            .eq('thread_id', threadId)
            .order('created_at', { ascending: true });

        if (repliesError) throw repliesError;

        // スレッド本文を1番目のレスとして追加
        let dat = `${thread.user_id || '名無しさん'}<><>${thread.created_at}<>${escapeHtml(thread.content)}<>${escapeHtml(thread.title)}\n`;

        // レスを追加
        replies.forEach(reply => {
            dat += `${reply.user_id || '名無しさん'}<><>${reply.created_at}<>${escapeHtml(reply.content)}<>\n`;
        });

        return dat;
    } catch (error) {
        console.error("dat生成エラー:", error);
        return '';
    }
}

// 専ブラ用APIエンドポイントの追加
async function handleApiRequest(path) {
    if (path === '/SETTING.TXT') {
        return await generateSettingsTxt();
    } else if (path === '/subject.txt') {
        return await generateSubjectTxt();
    } else if (path.endsWith('.dat')) {
        const threadId = path.split('/').pop().replace('.dat', '');
        return await generateDatFile(threadId);
    }
    return null;
}

// イベントリスナーの設定
function setupEventListeners() {
    // スレッド投稿ボタンのイベントリスナー
    const postThreadBtn = document.getElementById('post-thread-btn');
    if (postThreadBtn) {
        postThreadBtn.addEventListener('click', postThread);
    }

    // テーマ切り替えの初期化
    initThemeToggle();
}
