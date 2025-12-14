/**
 * 客户端激活码验证模块
 * 机器码生成 + 激活码验证 + 心跳检测
 */

const crypto = require('crypto');
const os = require('os');
const { execSync } = require('child_process');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ==================== 配置 ====================

// 鉴权服务器地址 (部署后需修改为你的服务器IP)
const AUTH_SERVER = {
    host: '101.126.132.228',      // 修改为你的服务器IP
    port: 3000,              // 服务端口
    protocol: 'http'         // 使用 http (无需 https)
};

// 系统类型 - 星图系统
const SYSTEM_TYPE = 'xingtu';

// 心跳检测间隔 (5分钟)
const HEARTBEAT_INTERVAL = 5 * 60 * 1000;

// 加密密钥 (与服务端保持一致)
const CLIENT_KEY = 'xingtu-client-secret-key-2024';

// ==================== 机器码生成 ====================

/**
 * 获取CPU信息
 */
function getCpuId() {
    try {
        if (process.platform === 'win32') {
            const output = execSync('wmic cpu get processorid', { encoding: 'utf-8' });
            const lines = output.trim().split('\n');
            return lines[1]?.trim() || '';
        } else if (process.platform === 'darwin') {
            const output = execSync('system_profiler SPHardwareDataType | grep "Serial Number"', { encoding: 'utf-8' });
            return output.split(':')[1]?.trim() || '';
        } else {
            const output = execSync('cat /proc/cpuinfo | grep "Serial" | head -1', { encoding: 'utf-8' });
            return output.split(':')[1]?.trim() || '';
        }
    } catch (e) {
        return '';
    }
}

/**
 * 获取主板序列号
 */
function getMotherboardSerial() {
    try {
        if (process.platform === 'win32') {
            const output = execSync('wmic baseboard get serialnumber', { encoding: 'utf-8' });
            const lines = output.trim().split('\n');
            return lines[1]?.trim() || '';
        }
    } catch (e) {
        return '';
    }
    return '';
}

/**
 * 获取硬盘序列号
 */
function getDiskSerial() {
    try {
        if (process.platform === 'win32') {
            const output = execSync('wmic diskdrive get serialnumber', { encoding: 'utf-8' });
            const lines = output.trim().split('\n');
            return lines[1]?.trim() || '';
        } else if (process.platform === 'darwin') {
            const output = execSync('system_profiler SPStorageDataType | grep "Volume UUID"', { encoding: 'utf-8' });
            return output.split(':')[1]?.trim() || '';
        }
    } catch (e) {
        return '';
    }
    return '';
}

/**
 * 获取MAC地址 (获取第一个非内部网卡)
 */
function getMacAddress() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
                return iface.mac;
            }
        }
    }
    return '';
}

/**
 * 生成唯一机器码
 * 结合多种硬件信息生成，防止单一硬件更换导致机器码变化
 */
function generateMachineCode() {
    const cpuId = getCpuId();
    const motherboard = getMotherboardSerial();
    const disk = getDiskSerial();
    const mac = getMacAddress();
    const hostname = os.hostname();
    const platform = os.platform();
    
    // 组合多种硬件信息
    const rawData = [
        cpuId,
        motherboard,
        disk,
        mac,
        hostname,
        platform
    ].filter(Boolean).join('|');
    
    // 生成哈希作为机器码
    const hash = crypto.createHash('sha256')
        .update(rawData + CLIENT_KEY)
        .digest('hex');
    
    // 格式化为易读格式: XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX
    return hash.toUpperCase().match(/.{1,4}/g).join('-');
}

// ==================== 本地存储 ====================

let licenseDataPath = '';

/**
 * 设置数据存储路径
 */
function setDataPath(userDataPath) {
    licenseDataPath = path.join(userDataPath, 'license.dat');
}

/**
 * 加密数据
 */
function encryptData(data) {
    const cipher = crypto.createCipheriv(
        'aes-256-cbc',
        crypto.createHash('sha256').update(CLIENT_KEY).digest(),
        Buffer.alloc(16, 0)
    );
    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
}

/**
 * 解密数据
 */
function decryptData(encrypted) {
    try {
        const decipher = crypto.createDecipheriv(
            'aes-256-cbc',
            crypto.createHash('sha256').update(CLIENT_KEY).digest(),
            Buffer.alloc(16, 0)
        );
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return JSON.parse(decrypted);
    } catch (e) {
        return null;
    }
}

/**
 * 保存激活信息
 */
function saveLicenseData(data) {
    try {
        const encrypted = encryptData(data);
        fs.writeFileSync(licenseDataPath, encrypted, 'utf-8');
        return true;
    } catch (e) {
        console.error('保存激活信息失败:', e.message);
        return false;
    }
}

/**
 * 读取激活信息
 */
function loadLicenseData() {
    try {
        if (!fs.existsSync(licenseDataPath)) {
            return null;
        }
        const encrypted = fs.readFileSync(licenseDataPath, 'utf-8');
        return decryptData(encrypted);
    } catch (e) {
        return null;
    }
}

/**
 * 清除激活信息
 */
function clearLicenseData() {
    try {
        if (fs.existsSync(licenseDataPath)) {
            fs.unlinkSync(licenseDataPath);
        }
        return true;
    } catch (e) {
        return false;
    }
}

// ==================== 服务器通信 ====================

/**
 * 发送请求到鉴权服务器
 */
function sendRequest(path, data) {
    return new Promise((resolve, reject) => {
        const timestamp = Date.now();
        const postData = JSON.stringify(data);
        
        // ========== DEBUG: 打印请求内容 ==========
        console.log('\n========== 鉴权请求 ==========');
        console.log('请求路径:', path);
        console.log('请求数据:', JSON.stringify(data, null, 2));
        console.log('===============================\n');
        
        const options = {
            hostname: AUTH_SERVER.host,
            port: AUTH_SERVER.port,
            path: path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
                'X-Timestamp': timestamp.toString(),
                'User-Agent': 'Xingtu-Client/1.0'
            },
            timeout: 10000
        };

        const client = AUTH_SERVER.protocol === 'https' ? https : http;
        
        const req = client.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(body);
                    // ========== DEBUG: 打印响应内容 ==========
                    console.log('\n========== 鉴权响应 ==========');
                    console.log('响应数据:', JSON.stringify(result, null, 2));
                    console.log('===============================\n');
                    resolve(result);
                } catch (e) {
                    console.error('解析响应失败, 原始响应:', body);
                    reject(new Error('解析响应失败'));
                }
            });
        });

        req.on('error', (e) => {
            reject(new Error(`网络错误: ${e.message}`));
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('请求超时'));
        });

        req.write(postData);
        req.end();
    });
}

// ==================== 激活码验证 ====================

/**
 * 激活激活码
 */
async function activate(licenseKey, force = false) {
    const machineCode = generateMachineCode();
    
    try {
        const result = await sendRequest('/api/auth/activate', {
            license_key: licenseKey.toUpperCase().trim(),
            machine_code: machineCode,
            system_type: SYSTEM_TYPE,
            force: force
        });

        if (result.success) {
            saveLicenseData({
                license_key: licenseKey.toUpperCase().trim(),
                machine_code: machineCode,
                system_type: result.data.system_type,
                member_level: result.data.member_level,
                expire_at: result.data.expire_at,
                activated_at: new Date().toISOString()
            });
        }

        return result;
    } catch (e) {
        return {
            success: false,
            code: 'NETWORK_ERROR',
            message: e.message
        };
    }
}

/**
 * 解绑授权 (先通知服务器，再清除本地数据)
 */
async function unbindLocal() {
    try {
        const licenseData = loadLicenseData();
        
        if (licenseData && licenseData.license_key) {
            const machineCode = generateMachineCode();

            try {
                await sendRequest('/api/auth/unbind', {
                    license_key: licenseData.license_key,
                    machine_code: machineCode
                });
            } catch (e) {
                console.error('服务器解绑失败:', e.message);
            }
        }

        clearLicenseData();
        return { success: true, message: '授权已解绑' };
    } catch (e) {
        return { success: false, message: e.message };
    }
}

/**
 * 验证激活状态 (心跳检测)
 */
async function verify() {
    const licenseData = loadLicenseData();
    
    if (!licenseData) {
        return {
            success: false,
            code: 'NOT_ACTIVATED',
            message: '软件未激活'
        };
    }

    const machineCode = generateMachineCode();
    
    if (machineCode !== licenseData.machine_code) {
        return {
            success: false,
            code: 'MACHINE_CHANGED',
            message: '硬件信息已变更，请重新激活'
        };
    }

    try {
        const result = await sendRequest('/api/auth/verify', {
            license_key: licenseData.license_key,
            machine_code: machineCode,
            system_type: SYSTEM_TYPE
        });

        if (result.success) {
            licenseData.expire_at = result.data.expire_at;
            licenseData.member_level = result.data.member_level;
            licenseData.last_verify = new Date().toISOString();
            saveLicenseData(licenseData);
        }

        return result;
    } catch (e) {
        return {
            success: false,
            code: 'NETWORK_ERROR',
            message: '无法连接鉴权服务器，请检查网络连接'
        };
    }
}

/**
 * 获取当前激活信息
 */
function getLicenseInfo() {
    const licenseData = loadLicenseData();
    if (!licenseData) {
        return null;
    }

    const machineCode = generateMachineCode();
    if (machineCode !== licenseData.machine_code) {
        return null;
    }

    return {
        license_key: licenseData.license_key,
        system_type: licenseData.system_type,
        member_level: licenseData.member_level,
        expire_at: licenseData.expire_at,
        days_remaining: licenseData.expire_at 
            ? Math.max(0, Math.ceil((new Date(licenseData.expire_at) - new Date()) / (1000 * 60 * 60 * 24)))
            : 0
    };
}

/**
 * 检查是否为SVIP
 */
function isSVIP() {
    const info = getLicenseInfo();
    return info && info.member_level === 'SVIP';
}

/**
 * 检查是否为VVIP
 */
function isVVIP() {
    const info = getLicenseInfo();
    return info && (info.member_level === 'VVIP' || info.member_level === 'SVIP');
}

/**
 * 获取会员等级
 */
function getMemberLevel() {
    const info = getLicenseInfo();
    return info ? info.member_level : null;
}

/**
 * 检查是否已激活
 */
function isActivated() {
    const info = getLicenseInfo();
    return info !== null && info.days_remaining > 0;
}

// ==================== 心跳检测 ====================

let heartbeatTimer = null;

/**
 * 启动心跳检测
 */
function startHeartbeat(onExpired) {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
    }

    heartbeatTimer = setInterval(async () => {
        const result = await verify();
        if (!result.success && result.code !== 'NETWORK_ERROR') {
            if (onExpired) {
                onExpired(result);
            }
        }
    }, HEARTBEAT_INTERVAL);
}

/**
 * 停止心跳检测
 */
function stopHeartbeat() {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
}

// ==================== 导出 ====================

module.exports = {
    // 配置
    setDataPath,
    SYSTEM_TYPE,
    
    // 机器码
    generateMachineCode,
    
    // 激活验证
    activate,
    verify,
    getLicenseInfo,
    isActivated,
    isSVIP,
    isVVIP,
    getMemberLevel,
    unbindLocal,
    
    // 心跳
    startHeartbeat,
    stopHeartbeat,
    
    // 存储
    clearLicenseData
};
