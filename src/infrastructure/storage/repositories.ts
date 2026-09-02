import { randomUUID } from 'node:crypto';
import type {
  AccountDraft,
  AccountStatus,
  AccountSummary,
  BloggerRow,
  CollectionItem,
  CollectionJob,
  CollectionSettings,
  CollectionSnapshot,
  ItemStatus,
  JobStatus,
  LinkConversionItem,
} from '../../shared/domain';
import type { AppDatabase } from './database';
import type { CredentialVault } from './credentialVault';

const nowIso = (): string => new Date().toISOString();
const today = (): string => nowIso().slice(0, 10);

const gradeLimit = (grade: number): number => ({ 1: 5, 2: 500, 3: 500, 4: 800, 5: 800, 6: 800, 7: 800 })[grade] ?? 0;

const defaultSettings = (): CollectionSettings => ({
  filename: 'collected_data.xlsx',
  directory: '',
  fields: [
    'spread-info',
    'effect-estimate',
    'seed-value',
    'convert-ability',
    'ecom-stat',
    'latest-videos',
    'content-type',
    'hot-words',
    'playlet-theme',
    'contract-info',
    'link-user',
    'audience-profile',
  ],
  accountMode: 'round-robin',
  singleAccountId: null,
  concurrency: 2,
});

interface AccountRow {
  id: string;
  remark: string;
  nickname: string;
  grade: number;
  status: AccountStatus;
  cookie_cipher: Buffer;
  collected_count: number;
  quota_date: string;
  last_checked_at: string | null;
}

interface JobRow {
  id: string;
  name: string;
  status: JobStatus;
  total: number;
  processed: number;
  succeeded: number;
  partial: number;
  failed: number;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

interface ItemRow {
  id: string;
  job_id: string;
  source_url: string;
  source_type: 'xingtu' | 'douyin';
  author_id: string | null;
  nickname: string;
  fans: string;
  status: ItemStatus;
  account_remark: string;
  collected_at: string | null;
  errors_json: string;
}

const normalizeQuota = (row: AccountRow, database: AppDatabase): AccountRow => {
  if (row.quota_date === today()) return row;
  database
    .prepare('UPDATE accounts SET collected_count = 0, quota_date = ?, updated_at = ? WHERE id = ?')
    .run(today(), nowIso(), row.id);
  return { ...row, collected_count: 0, quota_date: today() };
};

const toAccountSummary = (row: AccountRow): AccountSummary => {
  const limit = gradeLimit(row.grade);
  return {
    id: row.id,
    remark: row.remark,
    nickname: row.nickname,
    grade: row.grade,
    status: row.status,
    quota: { used: row.collected_count, limit, reserved: 0, date: row.quota_date },
    lastCheckedAt: row.last_checked_at,
    cookiePreview: '已安全保存',
  };
};

const toJob = (row: JobRow): CollectionJob => {
  const elapsedMinutes = row.started_at
    ? Math.max((Date.now() - new Date(row.started_at).getTime()) / 60_000, 1 / 60)
    : 0;
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    total: row.total,
    processed: row.processed,
    succeeded: row.succeeded,
    partial: row.partial,
    failed: row.failed,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    speedPerMinute: elapsedMinutes ? Math.round(row.processed / elapsedMinutes) : 0,
  };
};

const toItem = (row: ItemRow): CollectionItem => ({
  id: row.id,
  jobId: row.job_id,
  sourceUrl: row.source_url,
  sourceType: row.source_type,
  authorId: row.author_id,
  nickname: row.nickname,
  fans: row.fans,
  status: row.status,
  accountRemark: row.account_remark,
  collectedAt: row.collected_at,
  errors: JSON.parse(row.errors_json) as CollectionItem['errors'],
});

export class ApplicationRepository {
  constructor(
    private readonly database: AppDatabase,
    private readonly vault: CredentialVault,
  ) {}

  listAccounts(): AccountSummary[] {
    return (this.database.prepare('SELECT * FROM accounts ORDER BY created_at').all() as AccountRow[])
      .map((row) => normalizeQuota(row, this.database))
      .map(toAccountSummary);
  }

  getAccountCookies(id: string): string {
    const row = this.database.prepare('SELECT cookie_cipher FROM accounts WHERE id = ?').get(id) as
      | { cookie_cipher: Buffer }
      | undefined;
    if (!row) throw new Error('账号不存在');
    return this.vault.decrypt(row.cookie_cipher);
  }

  addAccount(draft: AccountDraft, details: { nickname?: string; grade?: number; status?: AccountStatus } = {}): AccountSummary {
    const id = randomUUID();
    const timestamp = nowIso();
    this.database
      .prepare(`
        INSERT INTO accounts(
          id, remark, nickname, grade, status, cookie_cipher, collected_count,
          quota_date, last_checked_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
      `)
      .run(
        id,
        draft.remark,
        details.nickname ?? '',
        details.grade ?? 0,
        details.status ?? 'unchecked',
        this.vault.encrypt(draft.cookies),
        today(),
        details.status ? timestamp : null,
        timestamp,
        timestamp,
      );
    return this.getAccount(id);
  }

  updateAccount(id: string, draft: AccountDraft): AccountSummary {
    const result = this.database
      .prepare('UPDATE accounts SET remark = ?, cookie_cipher = ?, status = ?, updated_at = ? WHERE id = ?')
      .run(draft.remark, this.vault.encrypt(draft.cookies), 'unchecked', nowIso(), id);
    if (result.changes === 0) throw new Error('账号不存在');
    return this.getAccount(id);
  }

  updateAccountHealth(id: string, details: { nickname: string; grade: number; status: AccountStatus }): AccountSummary {
    const result = this.database
      .prepare(`
        UPDATE accounts
        SET nickname = ?, grade = ?, status = ?, last_checked_at = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(details.nickname, details.grade, details.status, nowIso(), nowIso(), id);
    if (result.changes === 0) throw new Error('账号不存在');
    return this.getAccount(id);
  }

  incrementAccountUsage(id: string): void {
    this.database
      .prepare('UPDATE accounts SET collected_count = collected_count + 1, updated_at = ? WHERE id = ?')
      .run(nowIso(), id);
  }

  removeAccount(id: string): void {
    this.database.prepare('DELETE FROM accounts WHERE id = ?').run(id);
  }

  getAccount(id: string): AccountSummary {
    const row = this.database.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow | undefined;
    if (!row) throw new Error('账号不存在');
    return toAccountSummary(normalizeQuota(row, this.database));
  }

  getSettings(): CollectionSettings {
    const row = this.database.prepare('SELECT payload FROM settings WHERE key = ?').get('collection') as
      | { payload: string }
      | undefined;
    return row ? (JSON.parse(row.payload) as CollectionSettings) : defaultSettings();
  }

  saveSettings(settings: CollectionSettings): CollectionSettings {
    this.database
      .prepare('INSERT OR REPLACE INTO settings(key, payload, updated_at) VALUES (?, ?, ?)')
      .run('collection', JSON.stringify(settings), nowIso());
    return settings;
  }

  createJob(urls: Array<{ url: string; sourceType: 'xingtu' | 'douyin'; authorId: string | null }>): CollectionJob {
    const timestamp = nowIso();
    const jobId = randomUUID();
    const insertJob = this.database.prepare(`
      INSERT INTO collection_jobs(
        id, name, status, total, processed, succeeded, partial, failed,
        started_at, finished_at, created_at, updated_at
      ) VALUES (?, ?, 'idle', ?, 0, 0, 0, 0, NULL, NULL, ?, ?)
    `);
    const insertItem = this.database.prepare(`
      INSERT INTO collection_items(
        id, job_id, source_url, source_type, author_id, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
    `);
    this.database.transaction(() => {
      insertJob.run(jobId, `采集任务 ${new Date().toLocaleString('zh-CN')}`, urls.length, timestamp, timestamp);
      for (const entry of urls) {
        insertItem.run(randomUUID(), jobId, entry.url, entry.sourceType, entry.authorId, timestamp, timestamp);
      }
    })();
    return this.getJob(jobId);
  }

  getActiveJob(): CollectionJob | null {
    const row = this.database
      .prepare("SELECT * FROM collection_jobs ORDER BY created_at DESC LIMIT 1")
      .get() as JobRow | undefined;
    return row ? toJob(row) : null;
  }

  getJob(id: string): CollectionJob {
    const row = this.database.prepare('SELECT * FROM collection_jobs WHERE id = ?').get(id) as JobRow | undefined;
    if (!row) throw new Error('采集任务不存在');
    return toJob(row);
  }

  recoverInterruptedCollection(): void {
    const timestamp = nowIso();
    this.database.transaction(() => {
      this.database.prepare(`
        UPDATE collection_items
        SET status = 'pending', account_remark = '', errors_json = '[]', updated_at = ?
        WHERE status IN ('resolving', 'running')
          AND job_id IN (
            SELECT id FROM collection_jobs WHERE status IN ('running', 'paused', 'stopping')
          )
      `).run(timestamp);
      this.database.prepare(`
        UPDATE collection_jobs
        SET status = 'idle', finished_at = NULL, updated_at = ?
        WHERE status IN ('running', 'paused', 'stopping')
      `).run(timestamp);
    })();
  }

  listCollectionItems(jobId?: string): CollectionItem[] {
    const activeJob = jobId ? { id: jobId } : this.getActiveJob();
    if (!activeJob) return [];
    return (this.database
      .prepare('SELECT * FROM collection_items WHERE job_id = ? ORDER BY created_at')
      .all(activeJob.id) as ItemRow[]).map(toItem);
  }

  updateJobStatus(id: string, status: JobStatus): CollectionJob {
    const timestamp = nowIso();
    const start = status === 'running' ? timestamp : null;
    const finish = ['completed', 'failed', 'cancelled'].includes(status) ? timestamp : null;
    this.database
      .prepare(`
        UPDATE collection_jobs SET
          status = ?,
          started_at = COALESCE(started_at, ?),
          finished_at = COALESCE(?, finished_at),
          updated_at = ?
        WHERE id = ?
      `)
      .run(status, start, finish, timestamp, id);
    return this.refreshJobCounters(id);
  }

  updateCollectionItem(
    id: string,
    patch: Partial<Pick<CollectionItem, 'sourceUrl' | 'status' | 'authorId' | 'nickname' | 'fans' | 'accountRemark' | 'collectedAt' | 'errors'>>,
  ): CollectionItem {
    const current = this.database.prepare('SELECT * FROM collection_items WHERE id = ?').get(id) as ItemRow | undefined;
    if (!current) throw new Error('采集项不存在');
    this.database
      .prepare(`
        UPDATE collection_items SET
          source_url = ?, status = ?, author_id = ?, nickname = ?, fans = ?, account_remark = ?,
          collected_at = ?, errors_json = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(
        patch.sourceUrl ?? current.source_url,
        patch.status ?? current.status,
        patch.authorId === undefined ? current.author_id : patch.authorId,
        patch.nickname ?? current.nickname,
        patch.fans ?? current.fans,
        patch.accountRemark ?? current.account_remark,
        patch.collectedAt === undefined ? current.collected_at : patch.collectedAt,
        JSON.stringify(patch.errors ?? JSON.parse(current.errors_json)),
        nowIso(),
        id,
      );
    this.refreshJobCounters(current.job_id);
    return this.listCollectionItems(current.job_id).find((item) => item.id === id)!;
  }

  saveSnapshot(snapshot: Omit<CollectionSnapshot, 'createdAt'>): void {
    this.database
      .prepare('INSERT INTO snapshots(id, item_id, author_id, data_json, errors_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), snapshot.itemId, snapshot.authorId, JSON.stringify(snapshot.data), JSON.stringify(snapshot.errors), nowIso());
  }

  getSnapshots(jobId: string): CollectionSnapshot[] {
    return (this.database
      .prepare(`
        SELECT s.item_id, s.author_id, s.data_json, s.errors_json, s.created_at
        FROM snapshots s
        JOIN collection_items i ON i.id = s.item_id
        WHERE i.job_id = ?
        ORDER BY i.created_at
      `)
      .all(jobId) as Array<{
      item_id: string;
      author_id: string;
      data_json: string;
      errors_json: string;
      created_at: string;
    }>).map((row) => ({
      itemId: row.item_id,
      authorId: row.author_id,
      data: JSON.parse(row.data_json) as Record<string, unknown>,
      errors: JSON.parse(row.errors_json) as CollectionSnapshot['errors'],
      createdAt: row.created_at,
    }));
  }

  clearCollection(): void {
    this.database.prepare('DELETE FROM collection_jobs').run();
  }

  listBloggers(): BloggerRow[] {
    return (this.database.prepare('SELECT payload FROM blogger_rows ORDER BY created_at').all() as Array<{ payload: string }>).map(
      (row) => JSON.parse(row.payload) as BloggerRow,
    );
  }

  replaceBloggers(rows: BloggerRow[]): void {
    const timestamp = nowIso();
    const insert = this.database.prepare('INSERT OR REPLACE INTO blogger_rows(id, payload, created_at, updated_at) VALUES (?, ?, ?, ?)');
    this.database.transaction(() => {
      this.database.prepare('DELETE FROM blogger_rows').run();
      rows.forEach((row) => insert.run(row.id, JSON.stringify(row), timestamp, timestamp));
    })();
  }

  clearBloggers(): void {
    this.database.prepare('DELETE FROM blogger_rows').run();
  }

  listLinks(): LinkConversionItem[] {
    return (this.database.prepare('SELECT payload FROM link_items ORDER BY created_at').all() as Array<{ payload: string }>).map(
      (row) => JSON.parse(row.payload) as LinkConversionItem,
    );
  }

  replaceLinks(items: LinkConversionItem[]): void {
    const timestamp = nowIso();
    const insert = this.database.prepare('INSERT OR REPLACE INTO link_items(id, payload, created_at, updated_at) VALUES (?, ?, ?, ?)');
    this.database.transaction(() => {
      this.database.prepare('DELETE FROM link_items').run();
      items.forEach((item) => insert.run(item.id, JSON.stringify(item), timestamp, timestamp));
    })();
  }

  clearLinks(): void {
    this.database.prepare('DELETE FROM link_items').run();
  }

  resetCollectionItems(ids: string[]): CollectionJob | null {
    if (ids.length === 0) return this.getActiveJob();
    const placeholders = ids.map(() => '?').join(',');
    this.database
      .prepare(`UPDATE collection_items SET status = 'pending', errors_json = '[]', updated_at = ? WHERE id IN (${placeholders})`)
      .run(nowIso(), ...ids);
    const item = this.database.prepare(`SELECT job_id FROM collection_items WHERE id IN (${placeholders}) LIMIT 1`).get(...ids) as
      | { job_id: string }
      | undefined;
    return item ? this.refreshJobCounters(item.job_id) : null;
  }

  private refreshJobCounters(id: string): CollectionJob {
    const counters = this.database
      .prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status IN ('ok', 'partial', 'failed', 'cancelled') THEN 1 ELSE 0 END) AS processed,
          SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS succeeded,
          SUM(CASE WHEN status = 'partial' THEN 1 ELSE 0 END) AS partial,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
        FROM collection_items WHERE job_id = ?
      `)
      .get(id) as { total: number; processed: number; succeeded: number; partial: number; failed: number };
    this.database
      .prepare(`
        UPDATE collection_jobs
        SET total = ?, processed = ?, succeeded = ?, partial = ?, failed = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(counters.total, counters.processed, counters.succeeded, counters.partial, counters.failed, nowIso(), id);
    return this.getJob(id);
  }
}