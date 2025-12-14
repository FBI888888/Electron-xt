const crypto = require('crypto');
const CryptoJS = require('crypto-js');
require('dotenv').config();

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-32-char-encryption-key!';

/**
 * 生成激活码
 * 格式: XXXX-XXXX-XXXX-XXXX (16位大写字母数字)
 */
function generateLicenseKey() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 排除容易混淆的字符 I,O,0,1
    let key = '';
    
    for (let i = 0; i < 16; i++) {
        if (i > 0 && i % 4 === 0) key += '-';
        key += chars.charAt(crypto.randomInt(chars.length));
    }
    
    return key;
}

/**
 * 生成批量激活码
 */
function generateBatchLicenseKeys(count) {
    const keys = new Set();
    while (keys.size < count) {
        keys.add(generateLicenseKey());
    }
    return Array.from(keys);
}

/**
 * 计算机器码哈希 (用于存储和比对)
 */
function hashMachineCode(machineCode) {
    return crypto.createHash('sha256')
        .update(machineCode + ENCRYPTION_KEY)
        .digest('hex');
}

/**
 * 验证机器码
 */
function verifyMachineCode(machineCode, storedHash) {
    const hash = hashMachineCode(machineCode);
    return hash === storedHash;
}

/**
 * 生成签名 (用于防篡改)
 */
function generateSignature(data) {
    const str = typeof data === 'string' ? data : JSON.stringify(data);
    return crypto.createHmac('sha256', ENCRYPTION_KEY)
        .update(str)
        .digest('hex');
}

/**
 * 验证签名
 */
function verifySignature(data, signature) {
    const expectedSig = generateSignature(data);
    return crypto.timingSafeEqual(
        Buffer.from(expectedSig),
        Buffer.from(signature)
    );
}

/**
 * AES加密
 */
function encrypt(text) {
    return CryptoJS.AES.encrypt(text, ENCRYPTION_KEY).toString();
}

/**
 * AES解密
 */
function decrypt(ciphertext) {
    const bytes = CryptoJS.AES.decrypt(ciphertext, ENCRYPTION_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
}

/**
 * 生成随机Token
 */
function generateToken(length = 64) {
    return crypto.randomBytes(length).toString('hex');
}

module.exports = {
    generateLicenseKey,
    generateBatchLicenseKeys,
    hashMachineCode,
    verifyMachineCode,
    generateSignature,
    verifySignature,
    encrypt,
    decrypt,
    generateToken
};
