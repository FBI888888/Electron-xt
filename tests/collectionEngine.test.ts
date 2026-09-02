import { describe, expect, it } from 'vitest';
import type { DouyinLinkResolver } from '../src/infrastructure/douyin/linkResolver';
import type { XingtuGateway } from '../src/infrastructure/xingtu/gateway';
import type { ApplicationRepository } from '../src/infrastructure/storage/repositories';
import { CollectionEngine } from '../src/modules/collection/engine';
import type {
  AccountSummary,
  AppEvent,
  CollectionItem,
  CollectionJob,
  CollectionSettings,
  CollectionSnapshot,
  ItemStatus,
  JobStatus,
} from '../src/shared/domain';

const waitFor = async (predicate: () => boolean, timeout = 1_000): Promise<void> => {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeout) throw new Error('等待状态变更超时');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

const settings: CollectionSettings = {
  filename: 'data.xlsx',
  directory: '',
  fields: [],
  accountMode: 'round-robin',
  singleAccountId: null,
  concurrency: 1,
};

const account: AccountSummary = {
  id: 'account-1',
  remark: '测试账号',
  nickname: 'tester',
  grade: 1,
  status: 'healthy',
  quota: { used: 0, limit: 5, reserved: 0, date: '2026-07-19' },
  lastCheckedAt: null,
  cookiePreview: '已安全保存',
};

class MemoryRepository {
  readonly snapshots: Array<Omit<CollectionSnapshot, 'createdAt'>> = [];
  consumed = 0;
  job: CollectionJob;
  items: CollectionItem[];

  constructor(itemCount: number) {
    this.job = {
      id: 'job-1',
      name: '测试任务',
      status: 'idle',
      total: itemCount,
      processed: 0,
      succeeded: 0,
      partial: 0,
      failed: 0,
      startedAt: null,
      finishedAt: null,
      speedPerMinute: 0,
    };
    this.items = Array.from({ length: itemCount }, (_, index) => ({
      id: `item-${index + 1}`,
      jobId: this.job.id,
      sourceUrl: `https://www.xingtu.cn/author/${index + 1}`,
      sourceType: 'xingtu' as const,
      authorId: `author-${index + 1}`,
      nickname: '',
      fans: '',
      status: 'pending' as const,
      accountRemark: '',
      collectedAt: null,
      errors: [],
    }));
  }

  getSettings(): CollectionSettings {
    return settings;
  }

  listAccounts(): AccountSummary[] {
    return [{ ...account, quota: { ...account.quota } }];
  }

  incrementAccountUsage(): void {
    this.consumed += 1;
  }

  updateJobStatus(_id: string, status: JobStatus): CollectionJob {
    this.job.status = status;
    if (status === 'running') this.job.startedAt ??= new Date().toISOString();
    if (['completed', 'failed', 'cancelled'].includes(status)) this.job.finishedAt = new Date().toISOString();
    this.refreshCounters();
    return this.job;
  }

  getJob(): CollectionJob {
    return { ...this.job };
  }

  listCollectionItems(): CollectionItem[] {
    return this.items.map((item) => ({ ...item, errors: [...item.errors] }));
  }

  updateCollectionItem(id: string, patch: Partial<CollectionItem>): CollectionItem {
    const item = this.items.find((entry) => entry.id === id);
    if (!item) throw new Error('采集项不存在');
    Object.assign(item, patch);
    this.refreshCounters();
    return { ...item, errors: [...item.errors] };
  }

  getAccountCookies(): string {
    return 'session=test-cookie';
  }

  saveSnapshot(snapshot: Omit<CollectionSnapshot, 'createdAt'>): void {
    this.snapshots.push(snapshot);
  }

  private refreshCounters(): void {
    const terminal: ItemStatus[] = ['ok', 'partial', 'failed', 'cancelled'];
    this.job.total = this.items.length;
    this.job.processed = this.items.filter((item) => terminal.includes(item.status)).length;
    this.job.succeeded = this.items.filter((item) => item.status === 'ok').length;
    this.job.partial = this.items.filter((item) => item.status === 'partial').length;
    this.job.failed = this.items.filter((item) => item.status === 'failed').length;
  }
}

const directLinkResolver: DouyinLinkResolver = {
  resolve: async (url) => url,
};

const createEngine = (
  repository: MemoryRepository,
  gateway: XingtuGateway,
  events: AppEvent[] = [],
  linkResolver: DouyinLinkResolver = directLinkResolver,
): CollectionEngine =>
  new CollectionEngine(repository as unknown as ApplicationRepository, gateway, linkResolver, (event) => events.push(event));

describe('CollectionEngine', () => {
  it('完成任务后持久化结果、快照和账号配额', async () => {
    const repository = new MemoryRepository(1);
    const gateway: XingtuGateway = {
      checkAccount: async () => ({ nickname: 'tester', grade: 1 }),
      searchAuthor: async () => ({ authorId: 'author-1', nickname: '达人', notRegistered: false }),
      collectAuthor: async () => ({
        status: 'ok',
        data: { 达人昵称: '达人', 粉丝数: 123 },
        errors: [],
      }),
    };
    const engine = createEngine(repository, gateway);

    await engine.start(repository.job.id);
    await waitFor(() => !engine.isRunning());

    expect(repository.job.status).toBe('completed');
    expect(repository.items[0]).toMatchObject({ status: 'ok', nickname: '达人', fans: '123' });
    expect(repository.snapshots).toHaveLength(1);
    expect(repository.consumed).toBe(1);
  });

  it('暂停后不领取下一项，恢复后继续运行', async () => {
    const repository = new MemoryRepository(2);
    let calls = 0;
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const gateway: XingtuGateway = {
      checkAccount: async () => ({ nickname: 'tester', grade: 1 }),
      searchAuthor: async () => ({ authorId: 'author', nickname: '达人', notRegistered: false }),
      collectAuthor: async () => {
        calls += 1;
        if (calls === 1) await firstGate;
        return { status: 'ok', data: { 达人昵称: `达人${calls}` }, errors: [] };
      },
    };
    const engine = createEngine(repository, gateway);

    await engine.start(repository.job.id);
    await waitFor(() => calls === 1);
    engine.pause(repository.job.id);
    releaseFirst();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls).toBe(1);
    expect(repository.job.status).toBe('paused');

    engine.resume(repository.job.id);
    await waitFor(() => !engine.isRunning());
    expect(calls).toBe(2);
    expect(repository.job.status).toBe('completed');
  });

  it('采集抖音短链时先展开为用户主页，再调用星图搜索接口并持久化结果', async () => {
    const repository = new MemoryRepository(1);
    repository.items[0] = {
      ...repository.items[0]!,
      sourceUrl: 'https://v.douyin.com/short-link/',
      sourceType: 'douyin',
      authorId: null,
    };
    const resolvedUrl = 'https://www.douyin.com/user/resolved-user';
    const searchedUrls: string[] = [];
    const gateway: XingtuGateway = {
      checkAccount: async () => ({ nickname: 'tester', grade: 1 }),
      searchAuthor: async (url) => {
        searchedUrls.push(url);
        return { authorId: 'author-resolved', nickname: '短链达人', notRegistered: false };
      },
      collectAuthor: async () => ({ status: 'ok', data: { 达人昵称: '短链达人' }, errors: [] }),
    };
    const linkResolver: DouyinLinkResolver = {
      resolve: async (url) => {
        expect(url).toBe('https://v.douyin.com/short-link/');
        return resolvedUrl;
      },
    };
    const engine = createEngine(repository, gateway, [], linkResolver);

    await engine.start(repository.job.id);
    await waitFor(() => !engine.isRunning());

    expect(searchedUrls).toEqual([resolvedUrl]);
    expect(repository.items[0]).toMatchObject({
      sourceUrl: resolvedUrl,
      authorId: 'author-resolved',
      nickname: '短链达人',
      status: 'ok',
    });
  });

  it('停止任务会中止进行中的请求并保留取消状态', async () => {
    const repository = new MemoryRepository(1);
    let aborted = false;
    const gateway: XingtuGateway = {
      checkAccount: async () => ({ nickname: 'tester', grade: 1 }),
      searchAuthor: async () => ({ authorId: 'author-1', nickname: '达人', notRegistered: false }),
      collectAuthor: async (_authorId, _cookies, _fields, signal) =>
        new Promise((resolve, reject) => {
          signal?.addEventListener('abort', () => {
            aborted = true;
            reject(new DOMException('操作已取消', 'AbortError'));
          }, { once: true });
          void resolve;
        }),
    };
    const engine = createEngine(repository, gateway);

    await engine.start(repository.job.id);
    await waitFor(() => repository.items[0]?.status === 'running');
    engine.stop(repository.job.id);
    await waitFor(() => !engine.isRunning());

    expect(aborted).toBe(true);
    expect(repository.job.status).toBe('cancelled');
    expect(repository.items[0]?.status).toBe('cancelled');
    expect(repository.consumed).toBe(0);
  });
});