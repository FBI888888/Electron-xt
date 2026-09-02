import { describe, expect, it } from 'vitest';
import type { AppDatabase } from '../src/infrastructure/storage/database';
import { ApplicationRepository } from '../src/infrastructure/storage/repositories';
import type { CredentialVault } from '../src/infrastructure/storage/credentialVault';

const vault: CredentialVault = {
  encrypt: (value) => Buffer.from(value, 'utf8'),
  decrypt: (value) => value.toString('utf8'),
};

interface JobRow {
  id: string;
  name: string;
  status: string;
  total: number;
  processed: number;
  succeeded: number;
  partial: number;
  failed: number;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ItemRow {
  id: string;
  job_id: string;
  source_url: string;
  source_type: string;
  author_id: string | null;
  nickname: string;
  fans: string;
  status: string;
  account_remark: string;
  collected_at: string | null;
  errors_json: string;
  created_at: string;
  updated_at: string;
}

const createDatabase = (job: JobRow, items: ItemRow[]): AppDatabase => ({
  prepare(sql: string) {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    if (normalized.startsWith('UPDATE collection_items SET status')) {
      return {
        run: (timestamp: string) => {
          if (!['running', 'paused', 'stopping'].includes(job.status)) return { changes: 0 };
          let changes = 0;
          for (const item of items) {
            if (!['resolving', 'running'].includes(item.status)) continue;
            item.status = 'pending';
            item.account_remark = '';
            item.errors_json = '[]';
            item.updated_at = timestamp;
            changes += 1;
          }
          return { changes };
        },
      };
    }
    if (normalized.startsWith('UPDATE collection_jobs SET status')) {
      return {
        run: (timestamp: string) => {
          if (!['running', 'paused', 'stopping'].includes(job.status)) return { changes: 0 };
          job.status = 'idle';
          job.finished_at = null;
          job.updated_at = timestamp;
          return { changes: 1 };
        },
      };
    }
    if (normalized === 'SELECT * FROM collection_jobs WHERE id = ?') {
      return { get: (id: string) => id === job.id ? job : undefined };
    }
    if (normalized.startsWith('SELECT * FROM collection_items WHERE job_id = ?')) {
      return { all: (jobId: string) => items.filter((item) => item.job_id === jobId) };
    }
    throw new Error(`未处理的 SQL: ${normalized}`);
  },
  transaction<T extends (...args: never[]) => unknown>(fn: T) {
    return fn;
  },
}) as unknown as AppDatabase;

describe('采集任务重启恢复', () => {
  it('将崩溃遗留任务恢复为可重新开始状态，并保留已完成条目', () => {
    const job: JobRow = {
      id: 'job-1',
      name: '中断任务',
      status: 'running',
      total: 2,
      processed: 1,
      succeeded: 1,
      partial: 0,
      failed: 0,
      started_at: '2026-07-19T11:00:00.000Z',
      finished_at: null,
      created_at: '2026-07-19T10:00:00.000Z',
      updated_at: '2026-07-19T11:30:00.000Z',
    };
    const baseItem = {
      job_id: job.id,
      fans: '',
      created_at: '2026-07-19T10:00:00.000Z',
      updated_at: '2026-07-19T11:30:00.000Z',
    };
    const items: ItemRow[] = [
      {
        ...baseItem,
        id: 'completed',
        source_url: 'https://www.xingtu.cn/ad/creator/author-homepage/douyin-video/completed',
        source_type: 'xingtu',
        author_id: 'completed',
        nickname: '已完成达人',
        status: 'ok',
        account_remark: '账号A',
        collected_at: '2026-07-19T12:00:00.000Z',
        errors_json: '[]',
      },
      {
        ...baseItem,
        id: 'interrupted',
        source_url: 'https://v.douyin.com/interrupted/',
        source_type: 'douyin',
        author_id: null,
        nickname: '',
        status: 'resolving',
        account_remark: '中断账号',
        collected_at: null,
        errors_json: JSON.stringify([{ step: 'collection', message: '旧错误', retryable: true }]),
      },
    ];
    const repository = new ApplicationRepository(createDatabase(job, items), vault);

    repository.recoverInterruptedCollection();

    expect(repository.getJob(job.id)).toMatchObject({
      status: 'idle',
      total: 2,
      processed: 1,
      succeeded: 1,
      failed: 0,
    });
    expect(repository.listCollectionItems(job.id)).toEqual([
      expect.objectContaining({ id: 'completed', status: 'ok', nickname: '已完成达人' }),
      expect.objectContaining({
        id: 'interrupted',
        status: 'pending',
        accountRemark: '',
        errors: [],
      }),
    ]);
  });
});