const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const { verifyClientSignature } = require('../utils/crypto');

const JWT_SECRET = process.env.JWT_SECRET || 'default-jwt-secret';
const JWT_ADMIN_SECRET = process.env.JWT_ADMIN_SECRET || 'default-admin-jwt-secret';

/**
 * 客户端请求验证中间件
 */
function verifyClientRequest(req, res, next) {
    const timestamp = req.headers['x-timestamp'];
    const signature = req.headers['x-signature'];

    if (!timestamp) {
        return res.status(400).json({
            success: false,
            code: 'MISSING_TIMESTAMP',
            message: '缺少时间戳'
        });
    }

    // 检查时间戳是否在合理范围内 (5分钟内)
    const now = Date.now();
    const reqTime = parseInt(timestamp);
    if (Math.abs(now - reqTime) > 5 * 60 * 1000) {
        return res.status(400).json({
            success: false,
            code: 'INVALID_TIMESTAMP',
            message: '请求已过期'
        });
    }

    if (!signature) {
        return res.status(400).json({
            success: false,
            code: 'MISSING_SIGNATURE',
            message: '缺少签名'
        });
    }

    const payload = `${JSON.stringify(req.body || {})}.${timestamp}`;
    const ok = verifyClientSignature(payload, signature);
    if (!ok) {
        return res.status(401).json({
            success: false,
            code: 'INVALID_SIGNATURE',
            message: '签名校验失败'
        });
    }

    next();
}

/**
 * 管理员JWT验证中间件
 */
function verifyAdminToken(req, res, next) {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            success: false,
            code: 'NO_TOKEN',
            message: '未提供认证令牌'
        });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, JWT_ADMIN_SECRET);
        req.admin = decoded;
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                code: 'TOKEN_EXPIRED',
                message: '令牌已过期'
            });
        }
        return res.status(401).json({
            success: false,
            code: 'INVALID_TOKEN',
            message: '无效的令牌'
        });
    }
}

/**
 * 生成管理员JWT
 */
function generateAdminToken(admin) {
    return jwt.sign(
        { id: admin.id, username: admin.username, role: admin.role },
        JWT_ADMIN_SECRET,
        { expiresIn: '24h' }
    );
}

/**
 * 客户端请求频率限制
 */
const clientRateLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1分钟
    max: 60, // 最多60次请求
    message: {
        success: false,
        code: 'RATE_LIMIT',
        message: '请求过于频繁，请稍后再试'
    },
    standardHeaders: true,
    legacyHeaders: false
});

/**
 * 激活接口频率限制 (更严格)
 */
const activationRateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1小时
    max: 10, // 最多10次激活尝试
    message: {
        success: false,
        code: 'RATE_LIMIT',
        message: '激活尝试过于频繁，请1小时后再试'
    },
    standardHeaders: true,
    legacyHeaders: false
});

/**
 * 管理后台登录频率限制
 */
const loginRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15分钟
    max: 5, // 最多5次登录尝试
    message: {
        success: false,
        code: 'RATE_LIMIT',
        message: '登录尝试过于频繁，请15分钟后再试'
    },
    standardHeaders: true,
    legacyHeaders: false
});

module.exports = {
    verifyClientRequest,
    verifyAdminToken,
    generateAdminToken,
    clientRateLimiter,
    activationRateLimiter,
    loginRateLimiter
};
