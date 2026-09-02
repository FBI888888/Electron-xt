import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd() } }));

import {
  LicenseGateway,
  migrateLegacyLicense,
  type LegacyLicenseInfo,
  type LegacyLicenseModule,
  type LicenseOperationError,
} from '../src/main/services/licenseGateway';

interface LegacyState {
  info: LegacyLicenseInfo | null;
  verifyResult: { success: boolean; code?: string; message?: string };
  activateCalls: Array<{ key: string; force: boolean }>;
}

const createLegacy = (state: LegacyState): LegacyLicenseModule => ({
  setDataPath: vi.fn(),
  generateMachineCode: () => 'MACHINE-CODE',
  activate: async (key, force = false) => {
    state.activateCalls.push({ key, force });
    if (!force) return { success: false, code: 'ALREADY_ACTIVATED', message: '已绑定其他设备' };
    return { success: true };
  },
  verify: async () => state.verifyResult,
  getLicenseInfo: () => state.info,
  unbindLocal: async () => ({ success: true }),
  startHeartbeat: vi.fn(),
  stopHeartbeat: vi.fn(),
});

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('LicenseGateway', () => {
  it('迁移旧 license.dat，且不覆盖新目录中的授权文件', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xingtu-license-'));
    roots.push(root);
    const legacyDirectory = join(root, 'legacy');
    const targetDirectory = join(root, 'target');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(legacyDirectory, { recursive: true });
    await mkdir(targetDirectory, { recursive: true });
    await writeFile(join(legacyDirectory, 'license.dat'), 'legacy-license', 'utf8');

    migrateLegacyLicense(targetDirectory, [legacyDirectory]);
    expect(await readFile(join(targetDirectory, 'license.dat'), 'utf8')).toBe('legacy-license');

    await writeFile(join(targetDirectory, 'license.dat'), 'current-license', 'utf8');
    migrateLegacyLicense(targetDirectory, [legacyDirectory]);
    expect(await readFile(join(targetDirectory, 'license.dat'), 'utf8')).toBe('current-license');
  });

  it('在线验证失败时立即撤销本地授权', async () => {
    const now = Date.parse('2026-07-19T12:00:00.000Z');
    const state: LegacyState = {
      info: {
        license_key: 'KEY',
        member_level: 'SVIP',
        expire_at: '2026-08-19T00:00:00.000Z',
        days_remaining: 31,
        last_verify: '2026-07-19T11:59:00.000Z',
      },
      verifyResult: { success: true },
      activateCalls: [],
    };
    const gateway = new LicenseGateway('unused', [], { legacy: createLegacy(state), now: () => now });
    expect((await gateway.verify()).isActivated).toBe(true);

    state.verifyResult = { success: false, code: 'LICENSE_BANNED', message: '授权已禁用' };
    expect((await gateway.verify()).isActivated).toBe(false);
    await expect(gateway.authorize()).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
  });

  it('网络故障只在最近在线验证后的 24 小时内允许离线使用', async () => {
    let now = Date.parse('2026-07-19T12:00:00.000Z');
    const state: LegacyState = {
      info: {
        license_key: 'KEY',
        member_level: 'VVIP',
        expire_at: '2026-08-19T00:00:00.000Z',
        days_remaining: 31,
        last_verify: '2026-07-19T11:00:00.000Z',
      },
      verifyResult: { success: false, code: 'NETWORK_ERROR', message: '网络异常' },
      activateCalls: [],
    };
    const gateway = new LicenseGateway('unused', [], { legacy: createLegacy(state), now: () => now });

    expect(await gateway.verify()).toMatchObject({ isActivated: true, isOffline: true });
    now = Date.parse('2026-07-20T12:00:01.000Z');
    expect(await gateway.verify()).toMatchObject({ isActivated: false, isOffline: false });

    state.info = { ...state.info, last_verify: '2026-07-21T12:00:00.000Z' };
    expect(await gateway.verify()).toMatchObject({ isActivated: false, isOffline: false });
  });

  it('保留强制激活确认语义，并校验 VVIP/SVIP 功能权限', async () => {
    const now = Date.parse('2026-07-19T12:00:00.000Z');
    const state: LegacyState = {
      info: {
        license_key: 'KEY',
        member_level: 'VIP',
        expire_at: '2026-08-19T00:00:00.000Z',
        days_remaining: 31,
        last_verify: '2026-07-19T12:00:00.000Z',
      },
      verifyResult: { success: true },
      activateCalls: [],
    };
    const gateway = new LicenseGateway('unused', [], { legacy: createLegacy(state), now: () => now });

    await expect(gateway.activate('KEY')).rejects.toEqual(expect.objectContaining<Partial<LicenseOperationError>>({ code: 'ALREADY_ACTIVATED' }));
    await gateway.activate('KEY', true);
    expect(state.activateCalls).toEqual([{ key: 'KEY', force: false }, { key: 'KEY', force: true }]);
    await expect(gateway.authorize(['VVIP', 'SVIP'])).rejects.toMatchObject({ code: 'MEMBERSHIP_REQUIRED' });

    state.info = { ...state.info, member_level: 'VVIP' };
    await expect(gateway.authorize(['VVIP', 'SVIP'])).resolves.toBeUndefined();
  });
});