import { safeStorage } from 'electron';

export interface CredentialVault {
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
}

export const createCredentialVault = (): CredentialVault => ({
  encrypt(value) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('当前系统无法使用安全凭据存储');
    }
    return safeStorage.encryptString(value);
  },
  decrypt(value) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('当前系统无法解密账号凭据');
    }
    return safeStorage.decryptString(value);
  },
});