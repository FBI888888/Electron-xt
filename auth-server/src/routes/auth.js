const express = require('express');
const router = express.Router();
const { License } = require('../models/License');
const { verifyClientRequest, clientRateLimiter, activationRateLimiter } = require('../middleware/auth');
const { generateSignature } = require('../utils/crypto');

/**
 * POST /api/auth/activate
 * 激活码激活 (首次绑定机器)
 * force=true 时强制解绑原设备
 */
router.post('/activate', activationRateLimiter, verifyClientRequest, async (req, res) => {
    try {
        const { license_key, machine_code, system_type, force } = req.body;

        if (!license_key || !machine_code || !system_type) {
            return res.status(400).json({
                success: false,
                code: 'MISSING_PARAMS',
                message: '缺少必要参数'
            });
        }

        // 检查激活码是否属于对应系统
        const license = await License.findByKey(license_key);
        if (license && license.system_type !== system_type) {
            return res.status(400).json({
                success: false,
                code: 'SYSTEM_MISMATCH',
                message: '激活码不适用于此系统'
            });
        }

        const result = await License.activate(license_key, machine_code, force === true);

        if (result.success) {
            // 生成响应签名
            const responseData = {
                ...result.data,
                timestamp: Date.now()
            };
            const signature = generateSignature(responseData);

            return res.json({
                success: true,
                message: result.message,
                data: responseData,
                signature
            });
        }

        // 返回具体的错误码
        return res.status(400).json({
            success: false,
            code: result.code || 'ACTIVATION_FAILED',
            message: result.message
        });
    } catch (error) {
        console.error('激活错误:', error);
        return res.status(500).json({
            success: false,
            code: 'SERVER_ERROR',
            message: '服务器错误'
        });
    }
});

/**
 * POST /api/auth/verify
 * 验证激活状态 (心跳检测)
 */
router.post('/verify', clientRateLimiter, verifyClientRequest, async (req, res) => {
    try {
        const { license_key, machine_code, system_type } = req.body;
        const clientIP = req.ip || req.connection.remoteAddress;

        if (!license_key || !machine_code || !system_type) {
            return res.status(400).json({
                success: false,
                code: 'MISSING_PARAMS',
                message: '缺少必要参数'
            });
        }

        const result = await License.verify(license_key, machine_code, clientIP);

        if (result.success) {
            const responseData = {
                ...result.data,
                timestamp: Date.now()
            };
            const signature = generateSignature(responseData);

            return res.json({
                success: true,
                message: result.message,
                data: responseData,
                signature
            });
        }

        return res.status(400).json({
            success: false,
            code: result.code,
            message: result.message
        });
    } catch (error) {
        console.error('验证错误:', error);
        return res.status(500).json({
            success: false,
            code: 'SERVER_ERROR',
            message: '服务器错误'
        });
    }
});

/**
 * POST /api/auth/unbind
 * 客户端主动解绑 (需验证机器码)
 */
router.post('/unbind', clientRateLimiter, verifyClientRequest, async (req, res) => {
    try {
        const { license_key, machine_code } = req.body;

        if (!license_key || !machine_code) {
            return res.status(400).json({
                success: false,
                code: 'MISSING_PARAMS',
                message: '缺少必要参数'
            });
        }

        const result = await License.unbindByClient(license_key, machine_code);

        if (result.success) {
            return res.json({
                success: true,
                message: result.message
            });
        }

        return res.status(400).json({
            success: false,
            code: result.code || 'UNBIND_FAILED',
            message: result.message
        });
    } catch (error) {
        console.error('解绑错误:', error);
        return res.status(500).json({
            success: false,
            code: 'SERVER_ERROR',
            message: '服务器错误'
        });
    }
});

/**
 * POST /api/auth/check
 * 快速检查激活码状态 (不记录日志)
 */
router.post('/check', clientRateLimiter, verifyClientRequest, async (req, res) => {
    try {
        const { license_key, system_type } = req.body;

        if (!license_key) {
            return res.status(400).json({
                success: false,
                code: 'MISSING_PARAMS',
                message: '缺少激活码'
            });
        }

        const license = await License.findByKey(license_key);

        if (!license) {
            return res.json({
                success: false,
                code: 'NOT_FOUND',
                message: '激活码不存在'
            });
        }

        if (system_type && license.system_type !== system_type) {
            return res.json({
                success: false,
                code: 'SYSTEM_MISMATCH',
                message: '激活码不适用于此系统'
            });
        }

        return res.json({
            success: true,
            data: {
                status: license.status,
                system_type: license.system_type,
                member_level: license.member_level,
                is_bound: !!license.machine_hash
            }
        });
    } catch (error) {
        console.error('检查错误:', error);
        return res.status(500).json({
            success: false,
            code: 'SERVER_ERROR',
            message: '服务器错误'
        });
    }
});

module.exports = router;
