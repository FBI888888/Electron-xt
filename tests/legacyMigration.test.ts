import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { migrateLegacyData } from '../src/infrastructure/storage/legacyMigration';
import type { AppDatabase } from '../src/infrastructure/storage/database';
import type { ApplicationRepository } from '../src/infrastructure/storage/repositories';
import type { AccountDraft, AccountSummary, CollectionSettings } from '../src/shared/domain';

const defaultSettings: CollectionSettings = {
  filename: 'collected_data.xlsx',
  directory: '',
  fields: ['spread-info'],
  accountMode: 'round-robin',
  singleAccountId: null,
  concurrency: 2,
};

describe('旧数据迁移', () => {
  it('迁移账号与设置、保留备份，并通过标记保证幂等', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xingtu-migration-'));
    const legacyDirectory = join(root, 'legacy');
    const backupDirectory = join(root, 'backup');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(legacyDirectory, { recursive: true });
    const cookie = 'sessionid=legacy-cookie';
    const accountsJson = JSON.stringify([
      {
        remark: '旧主账号',
        nickName: 'legacy-user',
        grade: 2,
        status: '正常',
        cookies: cookie,
        collectedCount: 12,
        lastCollectDate: '2026-07-19',
      },
    ]);
    const settingsJson = JSON.stringify({
      local: { filename: 'legacy.xlsx', path: 'D:/exports' },
      collect_fields: ['spread-info', 'audience-profile'],
      account_mode: 'single',
      single_account_cookies: cookie,
    });
    await writeFile(join(legacyDirectory, 'xingtu_accounts.json'), accountsJson, 'utf8');
    await writeFile(join(legacyDirectory, 'collect_settings.json'), settingsJson, 'utf8');

    const meta = new Map<string, string>();
    const usageUpdates: unknown[][] = [];
    const database = {
      prepare(sql: string) {
        if (sql.includes('SELECT value FROM meta')) {
          return { get: (key: string) => meta.has(key) ? { value: meta.get(key) } : undefined };
        }
        if (sql.startsWith('UPDATE accounts SET collected_count')) {
          return { run: (...args: unknown[]) => usageUpdates.push(args) };
        }
        if (sql.includes('INSERT OR REPLACE INTO meta')) {
          return { run: (key: string, value: string) => meta.set(key, value) };
        }
        throw new Error(`未处理的 SQL: ${sql}`);
      },
    } as unknown as AppDatabase;

    const added: Array<{ draft: AccountDraft; details: Record<string, unknown> }> = [];
    let savedSettings: CollectionSettings | null = null;
    const repository = {
      addAccount(draft: AccountDraft, details: Record<string, unknown>): AccountSummary {
        added.push({ draft, details });
        return {
          id: 'account-legacy',
          remark: draft.remark,
          nickname: String(details.nickname ?? ''),
          grade: Number(details.grade ?? 0),
          status: 'healthy',
          quota: { used: 0, limit: 500, reserved: 0, date: '2026-07-19' },
          lastCheckedAt: null,
          cookiePreview: '已安全保存',
        };
      },
      getSettings: () => defaultSettings,
      saveSettings(next: CollectionSettings) {
        savedSettings = next;
        return next;
      },
    } as unknown as ApplicationRepository;

    try {
      const options = { database, repository, legacyDataDirectories: [legacyDirectory], backupDirectory };
      await migrateLegacyData(options);
      await migrateLegacyData(options);

      expect(added).toHaveLength(1);
      expect(added[0]).toMatchObject({
        draft: { remark: '旧主账号', cookies: cookie },
        details: { nickname: 'legacy-user', grade: 2, status: 'healthy' },
      });
      expect(usageUpdates).toEqual([[12, '2026-07-19', 'account-legacy']]);
      expect(savedSettings).toMatchObject({
        filename: 'legacy.xlsx',
        directory: 'D:/exports',
        fields: ['spread-info', 'audience-profile'],
        accountMode: 'single',
        singleAccountId: 'account-legacy',
      });
      expect(meta.get('legacy_json_migrated')).toBe('1');
      expect(await readFile(join(backupDirectory, 'xingtu_accounts.json'), 'utf8')).toBe(accountsJson);
      expect(await readFile(join(backupDirectory, 'collect_settings.json'), 'utf8')).toBe(settingsJson);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});