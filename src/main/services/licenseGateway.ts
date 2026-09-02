import { app } from 'electron';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { LicenseInfo, MembershipLevel } from '../../shared/domain';

export interface LegacyLicenseInfo {
  license_key?: string;
  member_level?: MembershipLevel;
  expire_at?: string;
  days_remaining?: number;
  last_verify?: string;
}

interface LegacyResult {
  success: boolean;
  message?: string;
  code?: string;
}

export interface LegacyLicenseModule {
  setDataPath(path: string): void;
  generateMachineCode(): string;
  activate(key: string, force?: boolean): Promise<LegacyResult>;
  verify(): Promise<LegacyResult>;
  getLicenseInfo(): LegacyLicenseInfo | null;
  unbindLocal(): Promise<LegacyResult>;
  startHeartbeat(callback: (result: LegacyResult) => void): void;
  stopHeartbeat(): void;
}

export interface LicenseGatewayOptions {
  legacy?: LegacyLicenseModule;
  now?: () => number;
  appPath?: string;
}

const loadLegacyLicense = (appPath: string): LegacyLicenseModule =>
  require(join(appPath, 'main', 'license.js')) as LegacyLicenseModule;

const OFFLINE_GRACE_MS = 24 * 60 * 60 * 1_000;
const AUTH_CACHE_MS = 2 * 60 * 1_000;

export class LicenseOperationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'LicenseOperationError';
  }
}

export const migrateLegacyLicense = (targetDirectory: string, legacyDirectories: string[]): void => {
  const target = join(targetDirectory, 'license.dat');
  if (existsSync(target)) return;
  const source = legacyDirectories.map((directory) => join(directory, 'license.dat')).find(existsSync);
  if (!source) return;
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
};

export class LicenseGateway {
  private readonly legacy: LegacyLicenseModule;
  private readonly now: () => number;
  private offline = false;
  private authorized = false;
  private lastAuthorizedAt = 0;

  constructor(userDataPath: string, legacyDirectories: string[] = [], options: LicenseGatewayOptions = {}) {
    migrateLegacyLicense(userDataPath, legacyDirectories);
    this.legacy = options.legacy ?? loadLegacyLicense(options.appPath ?? app.getAppPath());
    this.now = options.now ?? Date.now;
    this.legacy.setDataPath(userDataPath);
  }

  async verify(): Promise<LicenseInfo> {
    const result = await this.legacy.verify();
    if (result.success) {
      this.authorized = true;
      this.offline = false;
      this.lastAuthorizedAt = this.now();
      return this.get();
    }

    if (result.code === 'NETWORK_ERROR' && this.canUseOfflineGrace()) {
      this.authorized = true;
      this.offline = true;
      this.lastAuthorizedAt = this.now();
      return this.get();
    }

    this.authorized = false;
    this.offline = false;
    this.lastAuthorizedAt = 0;
    return this.get();
  }

  async authorize(allowedLevels?: MembershipLevel[]): Promise<void> {
    if (!this.authorized || this.now() - this.lastAuthorizedAt >= AUTH_CACHE_MS) {
      const license = await this.verify();
      if (!license.isActivated) throw new LicenseOperationError('NOT_AUTHORIZED', '软件尚未激活或授权已失效');
    }
    const level = this.get().level;
    if (allowedLevels && !allowedLevels.includes(level)) {
      throw new LicenseOperationError('MEMBERSHIP_REQUIRED', '当前会员等级无权使用此功能');
    }
  }

  async activate(key: string, force = false): Promise<LicenseInfo> {
    const result = await this.legacy.activate(key, force);
    if (!result.success) throw new LicenseOperationError(result.code || 'ACTIVATION_FAILED', result.message || '激活失败');
    this.authorized = true;
    this.offline = false;
    this.lastAuthorizedAt = this.now();
    return this.get();
  }

  async unbind(): Promise<void> {
    const result = await this.legacy.unbindLocal();
    if (!result.success) throw new LicenseOperationError(result.code || 'UNBIND_FAILED', result.message || '解绑失败');
    this.authorized = false;
    this.offline = false;
    this.lastAuthorizedAt = 0;
  }

  get(): LicenseInfo {
    const info = this.legacy.getLicenseInfo();
    return {
      machineCode: this.legacy.generateMachineCode(),
      licenseKey: info?.license_key ?? '',
      level: info?.member_level ?? 'UNKNOWN',
      expiresAt: info?.expire_at ?? null,
      daysRemaining: info?.days_remaining ?? 0,
      isActivated: Boolean(this.authorized && info && (info.days_remaining ?? 0) > 0),
      isOffline: this.offline,
    };
  }

  startHeartbeat(onExpired: (message: string) => void): void {
    this.legacy.startHeartbeat((result) => {
      this.authorized = false;
      this.offline = false;
      this.lastAuthorizedAt = 0;
      onExpired(result.message || '授权已失效');
    });
  }

  stopHeartbeat(): void {
    this.legacy.stopHeartbeat();
  }

  private canUseOfflineGrace(): boolean {
    const info = this.legacy.getLicenseInfo();
    const verifiedAt = info?.last_verify ? new Date(info.last_verify).getTime() : 0;
    return Boolean(
      info
      && (info.days_remaining ?? 0) > 0
      && Number.isFinite(verifiedAt)
      && verifiedAt > 0
      && this.now() >= verifiedAt
      && this.now() - verifiedAt <= OFFLINE_GRACE_MS,
    );
  }
}