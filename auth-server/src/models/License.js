const { pool } = require('../config/database');
const { hashMachineCode } = require('../utils/crypto');

/**
 * 系统类型枚举
 */
const SystemType = {
    XHS: 'xiaohongshu',      // 小红书系统
    XINGTU: 'xingtu'         // 星图系统
};

/**
 * 会员等级枚举
 */
const MemberLevel = {
    VIP: 'VIP',      // 会员
    VVIP: 'VVIP',    // 高级会员
    SVIP: 'SVIP'     // 超级会员
};

/**
 * 激活码状态枚举
 */
const LicenseStatus = {
    UNUSED: 'unused',       // 未使用
    ACTIVATED: 'activated', // 已激活
    EXPIRED: 'expired',     // 已过期
    BANNED: 'banned'        // 已禁用
};

class License {
    /**
     * 根据激活码查找
     */
    static async findByKey(licenseKey) {
        const [rows] = await pool.execute(
            'SELECT * FROM licenses WHERE license_key = ?',
            [licenseKey]
        );
        return rows[0] || null;
    }

    /**
     * 根据机器码查找
     */
    static async findByMachineCode(machineCode, systemType) {
        const machineHash = hashMachineCode(machineCode);
        const [rows] = await pool.execute(
            'SELECT * FROM licenses WHERE machine_hash = ? AND system_type = ?',
            [machineHash, systemType]
        );
        return rows[0] || null;
    }

    /**
     * 创建激活码
     */
    static async create(data) {
        const {
            license_key,
            system_type,
            member_level,
            valid_days,
            remark = ''
        } = data;

        const [result] = await pool.execute(
            `INSERT INTO licenses (license_key, system_type, member_level, valid_days, remark, status, created_at)
             VALUES (?, ?, ?, ?, ?, 'unused', NOW())`,
            [license_key, system_type, member_level, valid_days, remark]
        );
        
        return result.insertId;
    }

    /**
     * 批量创建激活码
     */
    static async createBatch(licenses) {
        const values = licenses.map(l => [
            l.license_key,
            l.system_type,
            l.member_level,
            l.valid_days,
            l.remark || '',
            'unused'
        ]);

        const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
        const flatValues = values.flat();

        const [result] = await pool.execute(
            `INSERT INTO licenses (license_key, system_type, member_level, valid_days, remark, status)
             VALUES ${placeholders}`,
            flatValues
        );

        return result.affectedRows;
    }

    /**
     * 激活码激活绑定机器
     * @param {string} licenseKey - 激活码
     * @param {string} machineCode - 机器码
     * @param {boolean} force - 是否强制解绑原设备
     */
    static async activate(licenseKey, machineCode, force = false) {
        const license = await this.findByKey(licenseKey);
        
        if (!license) {
            return { success: false, code: 'INVALID_LICENSE', message: '激活码不存在' };
        }

        if (license.status === LicenseStatus.BANNED) {
            return { success: false, code: 'BANNED', message: '激活码已被禁用，历史绑定设备过多' };
        }

        if (license.status === LicenseStatus.EXPIRED) {
            return { success: false, code: 'EXPIRED', message: '激活码已过期' };
        }

        const machineHash = hashMachineCode(machineCode);

        // 如果已激活，检查机器码是否匹配
        if (license.status === LicenseStatus.ACTIVATED) {
            if (license.machine_hash === machineHash) {
                // 同一设备，检查是否过期
                if (license.expire_at && new Date(license.expire_at) < new Date()) {
                    await pool.execute(
                        'UPDATE licenses SET status = ? WHERE id = ?',
                        [LicenseStatus.EXPIRED, license.id]
                    );
                    return { success: false, code: 'EXPIRED', message: '激活码已过期' };
                }
                return { 
                    success: true, 
                    message: '验证成功',
                    data: {
                        system_type: license.system_type,
                        member_level: license.member_level,
                        expire_at: license.expire_at
                    }
                };
            } else {
                // 不同设备
                if (!force) {
                    // 不是强制激活，返回错误提示
                    return { success: false, code: 'ALREADY_ACTIVATED', message: '该激活码已绑定其他设备' };
                }
                
                // 强制激活：检查激活次数限制
                const limitCheck = await this.checkActivationLimit(license.id);
                if (!limitCheck.allowed) {
                    // 超过3次激活，自动封禁
                    await pool.execute(
                        'UPDATE licenses SET status = ? WHERE id = ?',
                        [LicenseStatus.BANNED, license.id]
                    );
                    return { success: false, code: 'BANNED', message: '激活次数已达上限(3次)，授权码已被封禁' };
                }
            }
        } else {
            // 首次激活：检查是否已达限制（理论上不会，但做个保护）
            const limitCheck = await this.checkActivationLimit(license.id);
            if (!limitCheck.allowed) {
                // 封禁激活码
                await pool.execute(
                    'UPDATE licenses SET status = ? WHERE id = ?',
                    [LicenseStatus.BANNED, license.id]
                );
                return { success: false, code: 'BANNED', message: '激活次数已达上限(3次)，授权码已被封禁' };
            }
        }

        // 激活/切换设备
        const expireAt = license.expire_at || (() => {
            const date = new Date();
            date.setDate(date.getDate() + license.valid_days);
            return date;
        })();

        await pool.execute(
            `UPDATE licenses 
             SET status = ?, machine_hash = ?, activated_at = COALESCE(activated_at, NOW()), expire_at = ?, last_check_at = NOW()
             WHERE id = ?`,
            [LicenseStatus.ACTIVATED, machineHash, expireAt, license.id]
        );

        // 记录激活日志
        await pool.execute(
            `INSERT INTO activation_logs (license_id, machine_hash, action, ip_address, created_at)
             VALUES (?, ?, ?, ?, NOW())`,
            [license.id, machineHash, force ? 'force_activate' : 'activate', '']
        );

        return {
            success: true,
            message: force ? '激活成功，原设备已解绑' : '激活成功',
            data: {
                system_type: license.system_type,
                member_level: license.member_level,
                expire_at: expireAt
            }
        };
    }

    /**
     * 检查激活次数限制
     * 限制：总激活次数不能超过3次（防止设备间轮换使用）
     */
    static async checkActivationLimit(licenseId) {
        // 查询总激活次数（activate 和 force_activate 都算）
        const [countResult] = await pool.execute(
            `SELECT COUNT(*) as total_count FROM activation_logs 
             WHERE license_id = ? AND action IN ('activate', 'force_activate')`,
            [licenseId]
        );
        
        const totalCount = countResult[0].total_count;
        
        // 总激活次数超过3次不允许
        if (totalCount >= 3) {
            return { 
                allowed: false, 
                total_count: totalCount,
                reason: '激活次数已达上限(3次)'
            };
        }
        
        return { 
            allowed: true, 
            total_count: totalCount,
            remaining: 3 - totalCount
        };
    }

    /**
     * 获取激活码绑定历史
     */
    static async getBindingHistory(licenseId) {
        // 获取总激活次数
        const [countResult] = await pool.execute(
            `SELECT COUNT(*) as total_count FROM activation_logs 
             WHERE license_id = ? AND action IN ('activate', 'force_activate')`,
            [licenseId]
        );
        const totalActivations = countResult[0].total_count;

        // 获取所有激活记录（按时间排序）
        const [rows] = await pool.execute(
            `SELECT 
                machine_hash,
                action,
                created_at
             FROM activation_logs 
             WHERE license_id = ? AND action IN ('activate', 'force_activate')
             ORDER BY created_at ASC`,
            [licenseId]
        );
        
        // 获取当前绑定的机器码
        const [license] = await pool.execute(
            'SELECT machine_hash FROM licenses WHERE id = ?',
            [licenseId]
        );
        
        const currentMachineHash = license[0]?.machine_hash || null;
        
        // 统计每个设备的激活次数
        const deviceStats = {};
        rows.forEach(row => {
            if (!deviceStats[row.machine_hash]) {
                deviceStats[row.machine_hash] = {
                    machine_hash: row.machine_hash,
                    first_bind_at: row.created_at,
                    last_bind_at: row.created_at,
                    bind_count: 0
                };
            }
            deviceStats[row.machine_hash].last_bind_at = row.created_at;
            deviceStats[row.machine_hash].bind_count++;
        });
        
        const history = Object.values(deviceStats).map((item, index) => ({
            index: index + 1,
            machine_hash: item.machine_hash,
            is_current: item.machine_hash === currentMachineHash,
            first_bind_at: item.first_bind_at,
            last_bind_at: item.last_bind_at,
            bind_count: item.bind_count
        }));
        
        return {
            total_activations: totalActivations,  // 总激活次数
            max_allowed: 3,                        // 最大允许次数
            remaining: Math.max(0, 3 - totalActivations),  // 剩余次数
            device_count: history.length,          // 设备数量
            current_machine_hash: currentMachineHash,
            history: history
        };
    }

    /**
     * 验证激活状态 (心跳检测)
     */
    static async verify(licenseKey, machineCode, ipAddress = '') {
        const license = await this.findByKey(licenseKey);
        
        if (!license) {
            return { success: false, code: 'INVALID_LICENSE', message: '激活码不存在' };
        }

        if (license.status === LicenseStatus.BANNED) {
            return { success: false, code: 'BANNED', message: '激活码已被禁用' };
        }

        if (license.status === LicenseStatus.UNUSED) {
            return { success: false, code: 'NOT_ACTIVATED', message: '激活码未激活' };
        }

        const machineHash = hashMachineCode(machineCode);

        if (license.machine_hash !== machineHash) {
            return { success: false, code: 'MACHINE_MISMATCH', message: '设备不匹配' };
        }

        // 检查过期
        if (license.expire_at && new Date(license.expire_at) < new Date()) {
            await pool.execute(
                'UPDATE licenses SET status = ? WHERE id = ?',
                [LicenseStatus.EXPIRED, license.id]
            );
            return { success: false, code: 'EXPIRED', message: '激活码已过期' };
        }

        // 更新最后检测时间
        await pool.execute(
            'UPDATE licenses SET last_check_at = NOW() WHERE id = ?',
            [license.id]
        );

        // 记录验证日志
        await pool.execute(
            `INSERT INTO activation_logs (license_id, machine_hash, action, ip_address, created_at)
             VALUES (?, ?, 'verify', ?, NOW())`,
            [license.id, machineHash, ipAddress]
        );

        return {
            success: true,
            message: '验证通过',
            data: {
                system_type: license.system_type,
                member_level: license.member_level,
                expire_at: license.expire_at,
                days_remaining: Math.ceil((new Date(license.expire_at) - new Date()) / (1000 * 60 * 60 * 24))
            }
        };
    }

    /**
     * 解绑机器码 (管理员操作)
     */
    static async unbind(licenseId) {
        const [result] = await pool.execute(
            `UPDATE licenses SET machine_hash = NULL, status = 'unused', activated_at = NULL, expire_at = NULL 
             WHERE id = ?`,
            [licenseId]
        );
        return result.affectedRows > 0;
    }

    /**
     * 客户端主动解绑 (需验证机器码)
     */
    static async unbindByClient(licenseKey, machineCode) {
        const license = await this.findByKey(licenseKey);
        
        if (!license) {
            return { success: false, code: 'INVALID_LICENSE', message: '激活码不存在' };
        }

        const machineHash = hashMachineCode(machineCode);

        // 验证机器码是否匹配
        if (license.machine_hash !== machineHash) {
            return { success: false, code: 'MACHINE_MISMATCH', message: '设备不匹配，无法解绑' };
        }

        // 解绑
        await pool.execute(
            `UPDATE licenses SET machine_hash = NULL, status = 'unused' WHERE id = ?`,
            [license.id]
        );

        // 记录解绑日志
        await pool.execute(
            `INSERT INTO activation_logs (license_id, machine_hash, action, created_at)
             VALUES (?, ?, 'unbind', NOW())`,
            [license.id, machineHash]
        );

        return { success: true, message: '解绑成功' };
    }

    /**
     * 禁用激活码
     */
    static async ban(licenseId) {
        const [result] = await pool.execute(
            'UPDATE licenses SET status = ? WHERE id = ?',
            [LicenseStatus.BANNED, licenseId]
        );
        return result.affectedRows > 0;
    }

    /**
     * 启用激活码
     */
    static async unban(licenseId) {
        // 恢复到激活或未使用状态
        const [rows] = await pool.execute('SELECT * FROM licenses WHERE id = ?', [licenseId]);
        if (!rows[0]) return false;

        const newStatus = rows[0].machine_hash ? LicenseStatus.ACTIVATED : LicenseStatus.UNUSED;
        const [result] = await pool.execute(
            'UPDATE licenses SET status = ? WHERE id = ?',
            [newStatus, licenseId]
        );
        return result.affectedRows > 0;
    }

    /**
     * 延期
     */
    static async extend(licenseId, days) {
        const [rows] = await pool.execute('SELECT * FROM licenses WHERE id = ?', [licenseId]);
        if (!rows[0]) return false;

        let newExpireAt;
        if (rows[0].expire_at && new Date(rows[0].expire_at) > new Date()) {
            newExpireAt = new Date(rows[0].expire_at);
        } else {
            newExpireAt = new Date();
        }
        newExpireAt.setDate(newExpireAt.getDate() + days);

        const [result] = await pool.execute(
            'UPDATE licenses SET expire_at = ?, status = ? WHERE id = ?',
            [newExpireAt, LicenseStatus.ACTIVATED, licenseId]
        );
        return result.affectedRows > 0;
    }

    /**
     * 删除激活码
     */
    static async delete(licenseId) {
        // 先删除关联的激活日志 (由于设置了 ON DELETE CASCADE，这一步可选)
        await pool.execute('DELETE FROM activation_logs WHERE license_id = ?', [licenseId]);
        
        const [result] = await pool.execute('DELETE FROM licenses WHERE id = ?', [licenseId]);
        return result.affectedRows > 0;
    }

    /**
     * 重置激活次数 (清除激活日志，解绑设备，恢复未使用状态)
     */
    static async resetActivationHistory(licenseId) {
        const [rows] = await pool.execute('SELECT * FROM licenses WHERE id = ?', [licenseId]);
        if (!rows[0]) return false;

        // 删除所有激活日志
        await pool.execute(
            'DELETE FROM activation_logs WHERE license_id = ?',
            [licenseId]
        );

        // 重置激活码状态
        await pool.execute(
            `UPDATE licenses SET 
                machine_hash = NULL, 
                status = 'unused', 
                activated_at = NULL, 
                expire_at = NULL,
                last_check_at = NULL
             WHERE id = ?`,
            [licenseId]
        );

        return true;
    }

    /**
     * 获取激活码列表 (带分页和筛选)
     */
    static async list(options = {}) {
        const {
            page = 1,
            pageSize = 20,
            system_type,
            member_level,
            status,
            search
        } = options;

        let whereClause = '1=1';
        const params = [];

        if (system_type) {
            whereClause += ' AND system_type = ?';
            params.push(system_type);
        }

        if (member_level) {
            whereClause += ' AND member_level = ?';
            params.push(member_level);
        }

        if (status) {
            whereClause += ' AND status = ?';
            params.push(status);
        }

        if (search) {
            whereClause += ' AND (license_key LIKE ? OR remark LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }

        // 获取总数
        const [countResult] = await pool.execute(
            `SELECT COUNT(*) as total FROM licenses WHERE ${whereClause}`,
            params
        );
        const total = countResult[0].total;

        // 获取列表
        const offset = (page - 1) * pageSize;
        const [rows] = await pool.execute(
            `SELECT id, license_key, system_type, member_level, status, valid_days, 
                    machine_hash, activated_at, expire_at, last_check_at, remark, created_at
             FROM licenses 
             WHERE ${whereClause} 
             ORDER BY created_at DESC 
             LIMIT ? OFFSET ?`,
            [...params, pageSize, offset]
        );

        return {
            list: rows,
            total,
            page,
            pageSize,
            totalPages: Math.ceil(total / pageSize)
        };
    }

    /**
     * 获取统计数据
     */
    static async getStats() {
        const [stats] = await pool.execute(`
            SELECT 
                system_type,
                member_level,
                status,
                COUNT(*) as count
            FROM licenses
            GROUP BY system_type, member_level, status
        `);

        const [totalBySystem] = await pool.execute(`
            SELECT 
                system_type,
                COUNT(*) as total,
                SUM(CASE WHEN status = 'activated' THEN 1 ELSE 0 END) as activated,
                SUM(CASE WHEN status = 'unused' THEN 1 ELSE 0 END) as unused,
                SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) as expired,
                SUM(CASE WHEN status = 'banned' THEN 1 ELSE 0 END) as banned
            FROM licenses
            GROUP BY system_type
        `);

        return {
            details: stats,
            bySystem: totalBySystem
        };
    }
}

module.exports = { License, SystemType, MemberLevel, LicenseStatus };
