const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { doubleCsrf } = require('csrf-csrf');
const express = require('express');

// CORS設定
const corsMiddleware = cors({
    origin: process.env.NODE_ENV === 'production' 
        ? 'https://grok-fixed-it-version.vercel.app' 
        : 'http://localhost:3000',
    credentials: true
});

// Cookie Parser
const cookieParserMiddleware = cookieParser();

// レート制限
const rateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15分
    max: 100 // IPごとのリクエスト数制限
});

// Helmet（セキュリティヘッダー）
const helmetMiddleware = helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://unpkg.com"],
            scriptSrcElem: ["'self'", "https://unpkg.com"],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "https://*.supabase.co", "wss://*.supabase.co"],
            fontSrc: ["'self'", "data:", "https:"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"]
        }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
});

// CSRF設定
const { generateToken, doubleCsrfProtection } = doubleCsrf({
    getSecret: () => process.env.CSRF_SECRET || 'your-secret-key',
    cookieName: 'csrf',
    cookieOptions: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
    }
});

// ミドルウェアを適用する関数
function applyMiddleware(req, res, next) {
    return new Promise((resolve, reject) => {
        express.json()(req, res, () => {
            express.urlencoded({ extended: true })(req, res, () => {
                corsMiddleware(req, res, () => {
                    cookieParserMiddleware(req, res, () => {
                        rateLimiter(req, res, () => {
                            helmetMiddleware(req, res, () => {
                                next();
                                resolve();
                            });
                        });
                    });
                });
            });
        });
    });
}

// CSRFトークンを生成する関数
function applyCsrfToken(req, res) {
    return new Promise((resolve) => {
        const token = generateToken(req);
        res.cookie('csrf', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax'
        });
        res.json({ csrfToken: token });
        resolve();
    });
}

// CSRF保護を適用する関数
function applyCsrfProtection(req, res, next) {
    return new Promise((resolve, reject) => {
        if (process.env.NODE_ENV === 'production') {
            doubleCsrfProtection(req, res, (err) => {
                if (err) {
                    return reject(err);
                }
                next();
                resolve();
            });
        } else {
            next();
            resolve();
        }
    });
}

module.exports = {
    applyMiddleware,
    applyCsrfToken,
    applyCsrfProtection
};
