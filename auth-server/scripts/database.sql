-- ========================================
-- 鉴权系统数据库脚本
-- 支持系统: 小红书(xiaohongshu), 星图(xingtu)
-- ========================================

-- 创建数据库
CREATE DATABASE IF NOT EXISTS `auth_system` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `auth_system`;

-- ----------------------------------------
-- 1. 激活码表
-- ----------------------------------------
CREATE TABLE IF NOT EXISTS `licenses` (
    `id` INT PRIMARY KEY AUTO_INCREMENT,
    `license_key` VARCHAR(32) UNIQUE NOT NULL COMMENT '激活码 格式: XXXX-XXXX-XXXX-XXXX',
    `system_type` VARCHAR(32) NOT NULL COMMENT '系统类型: xiaohongshu(小红书), xingtu(星图)',
    `member_level` VARCHAR(16) NOT NULL COMMENT '会员等级: VIP, SVIP',
    `status` VARCHAR(16) DEFAULT 'unused' COMMENT '状态: unused(未使用), activated(已激活), expired(已过期), banned(已禁用)',
    `machine_hash` VARCHAR(128) NULL COMMENT '绑定的机器码哈希(SHA256)',
    `valid_days` INT NOT NULL DEFAULT 30 COMMENT '有效天数',
    `activated_at` DATETIME NULL COMMENT '激活时间',
    `expire_at` DATETIME NULL COMMENT '过期时间',
    `last_check_at` DATETIME NULL COMMENT '最后心跳验证时间',
    `remark` VARCHAR(255) DEFAULT '' COMMENT '备注信息',
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    
    INDEX `idx_license_key` (`license_key`),
    INDEX `idx_system_type` (`system_type`),
    INDEX `idx_member_level` (`member_level`),
    INDEX `idx_status` (`status`),
    INDEX `idx_machine_hash` (`machine_hash`),
    INDEX `idx_expire_at` (`expire_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='激活码表';

-- ----------------------------------------
-- 2. 激活/验证日志表
-- ----------------------------------------
CREATE TABLE IF NOT EXISTS `activation_logs` (
    `id` INT PRIMARY KEY AUTO_INCREMENT,
    `license_id` INT NOT NULL COMMENT '激活码ID',
    `machine_hash` VARCHAR(128) NOT NULL COMMENT '机器码哈希',
    `action` VARCHAR(32) NOT NULL COMMENT '操作类型: activate(激活), force_activate(强制激活), unbind(解绑), verify(验证)',
    `ip_address` VARCHAR(64) DEFAULT '' COMMENT '客户端IP地址',
    `user_agent` VARCHAR(255) DEFAULT '' COMMENT '客户端信息',
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '记录时间',
    
    INDEX `idx_license_id` (`license_id`),
    INDEX `idx_action` (`action`),
    INDEX `idx_created_at` (`created_at`),
    INDEX `idx_license_action` (`license_id`, `action`),
    FOREIGN KEY (`license_id`) REFERENCES `licenses`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='激活日志表';

-- ----------------------------------------
-- 3. 管理员表
-- ----------------------------------------
CREATE TABLE IF NOT EXISTS `admins` (
    `id` INT PRIMARY KEY AUTO_INCREMENT,
    `username` VARCHAR(64) UNIQUE NOT NULL COMMENT '用户名',
    `password` VARCHAR(128) NOT NULL COMMENT '密码(bcrypt哈希)',
    `role` VARCHAR(32) DEFAULT 'admin' COMMENT '角色: superadmin(超级管理员), admin(管理员)',
    `last_login` DATETIME NULL COMMENT '最后登录时间',
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    
    INDEX `idx_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='管理员表';

-- ----------------------------------------
-- 4. 系统配置表 (可选扩展)
-- ----------------------------------------
CREATE TABLE IF NOT EXISTS `system_config` (
    `id` INT PRIMARY KEY AUTO_INCREMENT,
    `config_key` VARCHAR(64) UNIQUE NOT NULL COMMENT '配置键',
    `config_value` TEXT COMMENT '配置值',
    `description` VARCHAR(255) DEFAULT '' COMMENT '描述',
    `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统配置表';

-- ----------------------------------------
-- 插入默认管理员 (密码: admin123456)
-- bcrypt hash 需要通过代码生成，这里用占位符
-- 实际使用时请运行 npm run init-db
-- ----------------------------------------
-- INSERT INTO `admins` (`username`, `password`, `role`) 
-- VALUES ('admin', '$2a$12$...', 'superadmin');

-- ----------------------------------------
-- 插入默认系统配置
-- ----------------------------------------
INSERT INTO `system_config` (`config_key`, `config_value`, `description`) VALUES
('heartbeat_interval', '300', '心跳检测间隔(秒)'),
('max_offline_time', '86400', '最大离线时间(秒)'),
('version', '1.0.0', '系统版本')
ON DUPLICATE KEY UPDATE `config_value` = VALUES(`config_value`);

-- ----------------------------------------
-- 创建视图: 激活码统计
-- ----------------------------------------
CREATE OR REPLACE VIEW `v_license_stats` AS
SELECT 
    system_type,
    member_level,
    status,
    COUNT(*) as count,
    SUM(CASE WHEN status = 'activated' AND expire_at > NOW() THEN 1 ELSE 0 END) as active_count
FROM licenses
GROUP BY system_type, member_level, status;

-- ----------------------------------------
-- 创建视图: 今日激活统计
-- ----------------------------------------
CREATE OR REPLACE VIEW `v_today_activations` AS
SELECT 
    l.system_type,
    l.member_level,
    COUNT(*) as activation_count
FROM activation_logs al
JOIN licenses l ON al.license_id = l.id
WHERE al.action = 'activate' 
  AND DATE(al.created_at) = CURDATE()
GROUP BY l.system_type, l.member_level;

-- ========================================
-- 数据库初始化完成
-- ========================================
