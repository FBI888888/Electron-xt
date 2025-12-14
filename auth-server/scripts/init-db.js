/**
 * 数据库初始化/升级脚本
 * 运行: npm run init-db
 * 
 * 支持：
 * - 新系统：创建所有表和索引
 * - 已部署系统：自动添加缺失的索引和字段
 */

const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const DB_CONFIG = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '123589'
};

const DB_NAME = process.env.DB_NAME || 'auth_system';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123456';

/**
 * 安全添加索引 (如果不存在)
 */
async function addIndexIfNotExists(connection, tableName, indexName, columns) {
    try {
        const [rows] = await connection.query(
            `SELECT COUNT(*) as cnt FROM information_schema.statistics 
             WHERE table_schema = ? AND table_name = ? AND index_name = ?`,
            [DB_NAME, tableName, indexName]
        );
        
        if (rows[0].cnt === 0) {
            const columnList = Array.isArray(columns) ? columns.join(', ') : columns;
            await connection.query(`ALTER TABLE \`${tableName}\` ADD INDEX \`${indexName}\` (${columnList})`);
            console.log(`  ✅ 添加索引: ${tableName}.${indexName}`);
            return true;
        }
        return false;
    } catch (e) {
        console.log(`  ⚠️ 索引 ${indexName} 添加失败: ${e.message}`);
        return false;
    }
}

/**
 * 安全添加字段 (如果不存在)
 */
async function addColumnIfNotExists(connection, tableName, columnName, columnDef) {
    try {
        const [rows] = await connection.query(
            `SELECT COUNT(*) as cnt FROM information_schema.columns 
             WHERE table_schema = ? AND table_name = ? AND column_name = ?`,
            [DB_NAME, tableName, columnName]
        );
        
        if (rows[0].cnt === 0) {
            await connection.query(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${columnDef}`);
            console.log(`  ✅ 添加字段: ${tableName}.${columnName}`);
            return true;
        }
        return false;
    } catch (e) {
        console.log(`  ⚠️ 字段 ${columnName} 添加失败: ${e.message}`);
        return false;
    }
}

/**
 * 检查表是否存在
 */
async function tableExists(connection, tableName) {
    const [rows] = await connection.query(
        `SELECT COUNT(*) as cnt FROM information_schema.tables 
         WHERE table_schema = ? AND table_name = ?`,
        [DB_NAME, tableName]
    );
    return rows[0].cnt > 0;
}

async function initDatabase() {
    let connection;

    try {
        // 连接MySQL (不指定数据库)
        connection = await mysql.createConnection(DB_CONFIG);
        console.log('✅ MySQL连接成功');

        // 创建数据库
        await connection.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        console.log(`✅ 数据库 ${DB_NAME} 已就绪`);

        // 切换到目标数据库
        await connection.query(`USE \`${DB_NAME}\``);

        // ========== licenses 表 ==========
        if (!await tableExists(connection, 'licenses')) {
            await connection.query(`
                CREATE TABLE licenses (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    license_key VARCHAR(32) UNIQUE NOT NULL COMMENT '激活码',
                    system_type VARCHAR(32) NOT NULL COMMENT '系统类型: xiaohongshu, xingtu',
                    member_level VARCHAR(16) NOT NULL COMMENT '会员等级: VIP, VVIP, SVIP',
                    status VARCHAR(16) DEFAULT 'unused' COMMENT '状态: unused, activated, expired, banned',
                    machine_hash VARCHAR(128) NULL COMMENT '机器码哈希',
                    valid_days INT NOT NULL DEFAULT 30 COMMENT '有效天数',
                    activated_at DATETIME NULL COMMENT '激活时间',
                    expire_at DATETIME NULL COMMENT '过期时间',
                    last_check_at DATETIME NULL COMMENT '最后验证时间',
                    remark VARCHAR(255) DEFAULT '' COMMENT '备注',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间'
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='激活码表'
            `);
            console.log('✅ licenses 表已创建');
        } else {
            console.log('ℹ️  licenses 表已存在，检查更新...');
        }
        
        // licenses 表索引
        await addIndexIfNotExists(connection, 'licenses', 'idx_license_key', 'license_key');
        await addIndexIfNotExists(connection, 'licenses', 'idx_system_type', 'system_type');
        await addIndexIfNotExists(connection, 'licenses', 'idx_status', 'status');
        await addIndexIfNotExists(connection, 'licenses', 'idx_machine_hash', 'machine_hash');
        await addIndexIfNotExists(connection, 'licenses', 'idx_expire_at', 'expire_at');

        // ========== activation_logs 表 ==========
        if (!await tableExists(connection, 'activation_logs')) {
            await connection.query(`
                CREATE TABLE activation_logs (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    license_id INT NOT NULL COMMENT '激活码ID',
                    machine_hash VARCHAR(128) NOT NULL COMMENT '机器码哈希',
                    action VARCHAR(32) NOT NULL COMMENT '操作: activate, force_activate, unbind, verify',
                    ip_address VARCHAR(64) DEFAULT '' COMMENT 'IP地址',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '记录时间',
                    FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='激活日志表'
            `);
            console.log('✅ activation_logs 表已创建');
        } else {
            console.log('ℹ️  activation_logs 表已存在，检查更新...');
        }
        
        // activation_logs 表索引
        await addIndexIfNotExists(connection, 'activation_logs', 'idx_license_id', 'license_id');
        await addIndexIfNotExists(connection, 'activation_logs', 'idx_action', 'action');
        await addIndexIfNotExists(connection, 'activation_logs', 'idx_created_at', 'created_at');
        await addIndexIfNotExists(connection, 'activation_logs', 'idx_license_action', ['license_id', 'action']);

        // ========== admins 表 ==========
        if (!await tableExists(connection, 'admins')) {
            await connection.query(`
                CREATE TABLE admins (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    username VARCHAR(64) UNIQUE NOT NULL COMMENT '用户名',
                    password VARCHAR(128) NOT NULL COMMENT '密码哈希',
                    role VARCHAR(32) DEFAULT 'admin' COMMENT '角色: superadmin, admin',
                    last_login DATETIME NULL COMMENT '最后登录时间',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间'
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='管理员表'
            `);
            console.log('✅ admins 表已创建');
        } else {
            console.log('ℹ️  admins 表已存在，检查更新...');
        }
        
        // admins 表索引
        await addIndexIfNotExists(connection, 'admins', 'idx_username', 'username');

        // ========== 检查/创建默认管理员 ==========
        const [admins] = await connection.query('SELECT COUNT(*) as count FROM admins');
        
        if (admins[0].count === 0) {
            const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 12);
            await connection.query(
                'INSERT INTO admins (username, password, role) VALUES (?, ?, ?)',
                ['admin', hashedPassword, 'superadmin']
            );
            console.log('✅ 默认管理员已创建');
            console.log('   用户名: admin');
            console.log(`   密码: ${ADMIN_PASSWORD}`);
        } else {
            console.log('ℹ️  管理员已存在，跳过创建');
        }

        console.log('\n========================================');
        console.log('🎉 数据库初始化/升级完成！');
        console.log('========================================');

    } catch (error) {
        console.error('❌ 初始化失败:', error.message);
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

initDatabase();
