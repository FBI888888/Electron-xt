import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { CollectField, CollectionSettings } from '../../shared/domain';
import type { AppDatabase } from './database';
import type { ApplicationRepository } from './repositories';

interface LegacyAccount {
  remark?: string;
  nickName?: string;
  grade?: number;
  status?: string;
  cookies?: string;
  collectedCount?: number;
  lastCollectDate?: string;
}

interface LegacySettings {
  local?: { filename?: string; path?: string };
  collect_fields?: string[];
  account_mode?: 'multi' | 'single';
  single_account_cookies?: string;
}

const readJson = async <T>(filePath: string): Promise<T | null> => {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
};

export const migrateLegacyData = async (options: {
  database: AppDatabase;
  repository: ApplicationRepository;
  legacyDataDirectories: string[];
  backupDirectory: string;
}): Promise<void> => {
  const migrated = options.database.prepare('SELECT value FROM meta WHERE key = ?').get('legacy_json_migrated') as
    | { value: string }
    | undefined;
  if (migrated?.value === '1') return;

  let accounts: LegacyAccount[] | null = null;
  let settings: LegacySettings | null = null;
  let accountFile = '';
  let settingsFile = '';

  for (const directory of options.legacyDataDirectories) {
    const nextAccountFile = join(directory, 'xingtu_accounts.json');
    const nextSettingsFile = join(directory, 'collect_settings.json');
    accounts ??= await readJson<LegacyAccount[]>(nextAccountFile);
    settings ??= await readJson<LegacySettings>(nextSettingsFile);
    if (accounts && !accountFile) accountFile = nextAccountFile;
    if (settings && !settingsFile) settingsFile = nextSettingsFile;
  }

  const accountIdByCookies = new Map<string, string>();
  for (const account of accounts ?? []) {
    if (!account.cookies?.trim()) continue;
    const created = options.repository.addAccount(
      { remark: account.remark?.trim() || account.nickName?.trim() || '旧账号', cookies: account.cookies },
      {
        nickname: account.nickName ?? '',
        grade: account.grade ?? 0,
        status: account.status === '正常' ? 'healthy' : account.status === '失效' ? 'invalid' : 'unchecked',
      },
    );
    accountIdByCookies.set(account.cookies, created.id);
    if ((account.collectedCount ?? 0) > 0) {
      options.database
        .prepare('UPDATE accounts SET collected_count = ?, quota_date = ? WHERE id = ?')
        .run(account.collectedCount, account.lastCollectDate ?? new Date().toISOString().slice(0, 10), created.id);
    }
  }

  if (settings) {
    const defaults = options.repository.getSettings();
    const migratedSettings: CollectionSettings = {
      ...defaults,
      filename: settings.local?.filename || defaults.filename,
      directory: settings.local?.path || defaults.directory,
      fields: (settings.collect_fields ?? defaults.fields) as CollectField[],
      accountMode: settings.account_mode === 'single' ? 'single' : 'round-robin',
      singleAccountId: settings.single_account_cookies
        ? accountIdByCookies.get(settings.single_account_cookies) ?? null
        : null,
    };
    options.repository.saveSettings(migratedSettings);
  }

  await mkdir(options.backupDirectory, { recursive: true });
  for (const filePath of [accountFile, settingsFile].filter(Boolean)) {
    await copyFile(filePath, join(options.backupDirectory, basename(filePath))).catch(() => undefined);
  }

  options.database
    .prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)')
    .run('legacy_json_migrated', '1');
};