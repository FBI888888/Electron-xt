const express = require('express');
const router = express.Router();
const { License, SystemType, MemberLevel } = require('../models/License');
const Admin = require('../models/Admin');
const { verifyAdminToken, generateAdminToken, loginRateLimiter } = require('../middleware/auth');
const { generateLicenseKey, generateBatchLicenseKeys } = require('../utils/crypto');

/**
 * POST /api/admin/login
 * 管理员登录
 */
router.post('/login', loginRateLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: '用户名和密码不能为空'
            });
        }

        const admin = await Admin.findByUsername(username);
        if (!admin) {
            return res.status(401).json({
                success: false,
                message: '用户名或密码错误'
            });
        }

        const isValid = await Admin.verifyPassword(password, admin.password);
        if (!isValid) {
            return res.status(401).json({
                success: false,
                message: '用户名或密码错误'
            });
        }

        await Admin.updateLastLogin(admin.id);
        const token = generateAdminToken(admin);

        return res.json({
            success: true,
            data: {
                token,
                admin: {
                    id: admin.id,
                    username: admin.username,
                    role: admin.role
                }
            }
        });
    } catch (error) {
        console.error('登录错误:', error);
        return res.status(500).json({
            success: false,
            message: '服务器错误'
        });
    }
});

/**
 * GET /api/admin/profile
 * 获取当前管理员信息
 */
router.get('/profile', verifyAdminToken, async (req, res) => {
    try {
        const admin = await Admin.findById(req.admin.id);
        return res.json({
            success: true,
            data: admin
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: '服务器错误'
        });
    }
});

/**
 * POST /api/admin/change-password
 * 修改密码
 */
router.post('/change-password', verifyAdminToken, async (req, res) => {
    try {
        const { new_password } = req.body;

        if (!new_password || new_password.length < 6) {
            return res.status(400).json({
                success: false,
                message: '密码长度不能少于6位'
            });
        }

        await Admin.changePassword(req.admin.id, new_password);
        return res.json({
            success: true,
            message: '密码修改成功'
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: '服务器错误'
        });
    }
});

// ==================== 激活码管理 ====================

/**
 * GET /api/admin/licenses
 * 获取激活码列表
 */
router.get('/licenses', verifyAdminToken, async (req, res) => {
    try {
        const { page, pageSize, system_type, member_level, status, search } = req.query;
        
        const result = await License.list({
            page: parseInt(page) || 1,
            pageSize: parseInt(pageSize) || 20,
            system_type,
            member_level,
            status,
            search
        });

        return res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('获取列表错误:', error);
        return res.status(500).json({
            success: false,
            message: '服务器错误'
        });
    }
});

/**
 * GET /api/admin/licenses/stats
 * 获取统计数据
 */
router.get('/licenses/stats', verifyAdminToken, async (req, res) => {
    try {
        const stats = await License.getStats();
        return res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: '服务器错误'
        });
    }
});

/**
 * POST /api/admin/licenses/generate
 * 生成激活码
 */
router.post('/licenses/generate', verifyAdminToken, async (req, res) => {
    try {
        const { system_type, member_level, valid_days, count = 1, remark = '' } = req.body;

        // 验证参数
        if (!system_type || !Object.values(SystemType).includes(system_type)) {
            return res.status(400).json({
                success: false,
                message: '无效的系统类型'
            });
        }

        if (!member_level || !Object.values(MemberLevel).includes(member_level)) {
            return res.status(400).json({
                success: false,
                message: '无效的会员等级'
            });
        }

        if (!valid_days || valid_days < 1 || valid_days > 3650) {
            return res.status(400).json({
                success: false,
                message: '有效期必须在1-3650天之间'
            });
        }

        if (count < 1 || count > 100) {
            return res.status(400).json({
                success: false,
                message: '单次生成数量必须在1-100之间'
            });
        }

        // 生成激活码
        const keys = generateBatchLicenseKeys(count);
        const licenses = keys.map(key => ({
            license_key: key,
            system_type,
            member_level,
            valid_days,
            remark
        }));

        await License.createBatch(licenses);

        return res.json({
            success: true,
            message: `成功生成 ${count} 个激活码`,
            data: {
                keys,
                system_type,
                member_level,
                valid_days
            }
        });
    } catch (error) {
        console.error('生成激活码错误:', error);
        return res.status(500).json({
            success: false,
            message: '服务器错误'
        });
    }
});

/**
 * POST /api/admin/licenses/:id/unbind
 * 解绑机器码
 */
router.post('/licenses/:id/unbind', verifyAdminToken, async (req, res) => {
    try {
        const { id } = req.params;
        const success = await License.unbind(id);

        if (success) {
            return res.json({
                success: true,
                message: '解绑成功'
            });
        }

        return res.status(404).json({
            success: false,
            message: '激活码不存在'
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: '服务器错误'
        });
    }
});

/**
 * GET /api/admin/licenses/:id/history
 * 获取激活码绑定历史
 */
router.get('/licenses/:id/history', verifyAdminToken, async (req, res) => {
    try {
        const { id } = req.params;
        const history = await License.getBindingHistory(id);

        return res.json({
            success: true,
            data: history
        });
    } catch (error) {
        console.error('获取绑定历史错误:', error);
        return res.status(500).json({
            success: false,
            message: '服务器错误'
        });
    }
});

/**
 * POST /api/admin/licenses/:id/ban
 * 禁用激活码
 */
router.post('/licenses/:id/ban', verifyAdminToken, async (req, res) => {
    try {
        const { id } = req.params;
        const success = await License.ban(id);

        if (success) {
            return res.json({
                success: true,
                message: '已禁用'
            });
        }

        return res.status(404).json({
            success: false,
            message: '激活码不存在'
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: '服务器错误'
        });
    }
});

/**
 * POST /api/admin/licenses/:id/unban
 * 启用激活码
 */
router.post('/licenses/:id/unban', verifyAdminToken, async (req, res) => {
    try {
        const { id } = req.params;
        const success = await License.unban(id);

        if (success) {
            return res.json({
                success: true,
                message: '已启用'
            });
        }

        return res.status(404).json({
            success: false,
            message: '激活码不存在'
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: '服务器错误'
        });
    }
});

/**
 * POST /api/admin/licenses/:id/extend
 * 延长有效期
 */
router.post('/licenses/:id/extend', verifyAdminToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { days } = req.body;

        if (!days || days < 1) {
            return res.status(400).json({
                success: false,
                message: '延期天数无效'
            });
        }

        const success = await License.extend(id, days);

        if (success) {
            return res.json({
                success: true,
                message: `已延期 ${days} 天`
            });
        }

        return res.status(404).json({
            success: false,
            message: '激活码不存在'
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: '服务器错误'
        });
    }
});

/**
 * GET /api/admin/system-types
 * 获取系统类型列表
 */
router.get('/system-types', verifyAdminToken, (req, res) => {
    return res.json({
        success: true,
        data: [
            { value: SystemType.XHS, label: '小红书系统' },
            { value: SystemType.XINGTU, label: '星图系统' }
        ]
    });
});

/**
 * GET /api/admin/member-levels
 * 获取会员等级列表
 */
router.get('/member-levels', verifyAdminToken, (req, res) => {
    return res.json({
        success: true,
        data: [
            { value: MemberLevel.VIP, label: 'VIP (会员)' },
            { value: MemberLevel.VVIP, label: 'VVIP (高级会员)' },
            { value: MemberLevel.SVIP, label: 'SVIP (超级会员)' }
        ]
    });
});

/**
 * DELETE /api/admin/licenses/:id
 * 删除激活码
 */
router.delete('/licenses/:id', verifyAdminToken, async (req, res) => {
    try {
        const { id } = req.params;
        const success = await License.delete(id);

        if (success) {
            return res.json({
                success: true,
                message: '激活码已删除'
            });
        }

        return res.status(404).json({
            success: false,
            message: '激活码不存在'
        });
    } catch (error) {
        console.error('删除激活码错误:', error);
        return res.status(500).json({
            success: false,
            message: '服务器错误'
        });
    }
});

/**
 * POST /api/admin/licenses/:id/reset
 * 重置激活次数 (清除激活日志，但保留过期时间)
 */
router.post('/licenses/:id/reset', verifyAdminToken, async (req, res) => {
    try {
        const { id } = req.params;
        const success = await License.resetActivationHistory(id);

        if (success) {
            return res.json({
                success: true,
                message: '激活次数已重置'
            });
        }

        return res.status(404).json({
            success: false,
            message: '激活码不存在'
        });
    } catch (error) {
        console.error('重置激活次数错误:', error);
        return res.status(500).json({
            success: false,
            message: '服务器错误'
        });
    }
});

/**
 * PUT /api/admin/licenses/:id
 * 修改激活码的等级和过期时间
 */
router.put('/licenses/:id', verifyAdminToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { member_level, expire_at } = req.body;

        if (!member_level && expire_at === undefined) {
            return res.status(400).json({
                success: false,
                message: '请提供要修改的字段'
            });
        }

        if (member_level && !Object.values(MemberLevel).includes(member_level)) {
            return res.status(400).json({
                success: false,
                message: '无效的会员等级'
            });
        }

        if (expire_at !== null && expire_at !== undefined) {
            const expireDate = new Date(expire_at);
            if (isNaN(expireDate.getTime())) {
                return res.status(400).json({
                    success: false,
                    message: '无效的过期时间格式'
                });
            }
        }

        const success = await License.updateLicense(id, { member_level, expire_at });

        if (success) {
            return res.json({
                success: true,
                message: '修改成功'
            });
        }

        return res.status(404).json({
            success: false,
            message: '激活码不存在或无修改内容'
        });
    } catch (error) {
        console.error('修改激活码错误:', error);
        return res.status(500).json({
            success: false,
            message: '服务器错误'
        });
    }
});

module.exports = router;
