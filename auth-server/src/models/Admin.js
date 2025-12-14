const { pool } = require('../config/database');
const bcrypt = require('bcryptjs');

class Admin {
    /**
     * 根据用户名查找管理员
     */
    static async findByUsername(username) {
        const [rows] = await pool.execute(
            'SELECT * FROM admins WHERE username = ?',
            [username]
        );
        return rows[0] || null;
    }

    /**
     * 根据ID查找管理员
     */
    static async findById(id) {
        const [rows] = await pool.execute(
            'SELECT id, username, role, created_at, last_login FROM admins WHERE id = ?',
            [id]
        );
        return rows[0] || null;
    }

    /**
     * 创建管理员
     */
    static async create(data) {
        const { username, password, role = 'admin' } = data;
        const hashedPassword = await bcrypt.hash(password, 12);

        const [result] = await pool.execute(
            'INSERT INTO admins (username, password, role, created_at) VALUES (?, ?, ?, NOW())',
            [username, hashedPassword, role]
        );

        return result.insertId;
    }

    /**
     * 验证密码
     */
    static async verifyPassword(inputPassword, hashedPassword) {
        return bcrypt.compare(inputPassword, hashedPassword);
    }

    /**
     * 更新最后登录时间
     */
    static async updateLastLogin(id) {
        await pool.execute(
            'UPDATE admins SET last_login = NOW() WHERE id = ?',
            [id]
        );
    }

    /**
     * 修改密码
     */
    static async changePassword(id, newPassword) {
        const hashedPassword = await bcrypt.hash(newPassword, 12);
        const [result] = await pool.execute(
            'UPDATE admins SET password = ? WHERE id = ?',
            [hashedPassword, id]
        );
        return result.affectedRows > 0;
    }

    /**
     * 获取管理员列表
     */
    static async list() {
        const [rows] = await pool.execute(
            'SELECT id, username, role, created_at, last_login FROM admins ORDER BY created_at DESC'
        );
        return rows;
    }

    /**
     * 删除管理员
     */
    static async delete(id) {
        const [result] = await pool.execute(
            'DELETE FROM admins WHERE id = ? AND role != "superadmin"',
            [id]
        );
        return result.affectedRows > 0;
    }
}

module.exports = Admin;
