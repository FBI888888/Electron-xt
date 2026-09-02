import type {
  AppEvent,
  CollectionItem,
  CollectionJob,
  CollectionSettings,
  EntityId,
} from '../../shared/domain';
import type { DouyinLinkResolver } from '../../infrastructure/douyin/linkResolver';
import type { XingtuGateway } from '../../infrastructure/xingtu/gateway';
import type { ApplicationRepository } from '../../infrastructure/storage/repositories';
import { AccountPool } from '../accounts/accountPool';

interface Runtime {
  jobId: string;
  controller: AbortController;
  status: 'running' | 'paused' | 'stopping';
  resumeWaiters: Array<() => void>;
}

export class CollectionEngine {
  private runtime: Runtime | null = null;

  constructor(
    private readonly repository: ApplicationRepository,
    private readonly gateway: XingtuGateway,
    private readonly linkResolver: DouyinLinkResolver,
    private readonly emit: (event: AppEvent) => void,
  ) {}

  async start(jobId: EntityId): Promise<CollectionJob> {
    if (this.runtime) throw new Error('已有采集任务正在运行');
    const settings = this.repository.getSettings();
    const accounts = this.repository.listAccounts();
    const pool = new AccountPool(accounts, settings, (accountId) => this.repository.incrementAccountUsage(accountId));
    this.runtime = {
      jobId,
      controller: new AbortController(),
      status: 'running',
      resumeWaiters: [],
    };
    this.repository.updateJobStatus(jobId, 'running');
    this.emitState(jobId);

    void this.run(jobId, settings, pool).catch((error: unknown) => {
      if (this.runtime?.controller.signal.aborted) return;
      console.error('[CollectionEngine] task failed:', error);
      this.repository.updateJobStatus(jobId, 'failed');
      this.runtime = null;
      this.emitState(jobId);
    });

    return this.repository.getJob(jobId);
  }

  pause(jobId: EntityId): CollectionJob {
    this.assertRuntime(jobId);
    this.runtime!.status = 'paused';
    const job = this.repository.updateJobStatus(jobId, 'paused');
    this.emitState(jobId);
    return job;
  }

  resume(jobId: EntityId): CollectionJob {
    this.assertRuntime(jobId);
    this.runtime!.status = 'running';
    this.runtime!.resumeWaiters.splice(0).forEach((resume) => resume());
    const job = this.repository.updateJobStatus(jobId, 'running');
    this.emitState(jobId);
    return job;
  }

  stop(jobId: EntityId): CollectionJob {
    this.assertRuntime(jobId);
    this.runtime!.status = 'stopping';
    this.runtime!.controller.abort();
    this.runtime!.resumeWaiters.splice(0).forEach((resume) => resume());
    const job = this.repository.updateJobStatus(jobId, 'cancelled');
    this.emitState(jobId);
    return job;
  }

  isRunning(): boolean {
    return this.runtime !== null;
  }

  shutdown(): void {
    if (!this.runtime) return;
    const { jobId } = this.runtime;
    this.runtime.controller.abort();
    this.runtime.resumeWaiters.splice(0).forEach((resume) => resume());
    this.repository.updateJobStatus(jobId, 'cancelled');
    this.runtime = null;
  }

  private async run(jobId: string, settings: CollectionSettings, pool: AccountPool): Promise<void> {
    const items = this.repository
      .listCollectionItems(jobId)
      .filter((item) => !['ok', 'partial'].includes(item.status));
    let cursor = 0;

    const worker = async (): Promise<void> => {
      while (cursor < items.length && this.runtime?.jobId === jobId) {
        await this.waitIfPaused();
        if (this.runtime?.controller.signal.aborted) break;
        const item = items[cursor++];
        if (!item) break;
        const reservation = pool.reserve();
        if (!reservation) {
          this.repository.updateCollectionItem(item.id, {
            status: 'failed',
            errors: [{ step: 'account-pool', message: '没有可用账号或账号今日配额已耗尽', retryable: true }],
          });
          continue;
        }

        let consumed = false;
        try {
          await this.processItem(item, reservation.account.id, reservation.account.remark, settings);
          consumed = true;
        } catch (error) {
          const cancelled = error instanceof DOMException && error.name === 'AbortError';
          this.repository.updateCollectionItem(item.id, {
            status: cancelled ? 'cancelled' : 'failed',
            errors: [
              {
                step: 'collection',
                message: error instanceof Error ? error.message : String(error),
                retryable: !cancelled,
              },
            ],
          });
        } finally {
          reservation.release(consumed);
          this.emitState(jobId);
        }
      }
    };

    await Promise.all(Array.from({ length: settings.concurrency }, () => worker()));
    const stopped = this.runtime?.controller.signal.aborted ?? true;
    if (!stopped) {
      const finalItems = this.repository.listCollectionItems(jobId);
      const status = finalItems.every((item) => item.status === 'failed') ? 'failed' : 'completed';
      this.repository.updateJobStatus(jobId, status);
    }
    this.runtime = null;
    this.emitState(jobId);
  }

  private async processItem(
    item: CollectionItem,
    accountId: string,
    accountRemark: string,
    settings: CollectionSettings,
  ): Promise<void> {
    const signal = this.runtime!.controller.signal;
    let authorId = item.authorId;
    let nickname = item.nickname;

    if (!authorId) {
      this.repository.updateCollectionItem(item.id, { status: 'resolving', accountRemark });
      this.emitState(item.jobId);
      const searchUrl = item.sourceType === 'douyin'
        ? await this.linkResolver.resolve(item.sourceUrl, signal)
        : item.sourceUrl;
      const search = await this.gateway.searchAuthor(searchUrl, this.repository.getAccountCookies(accountId), signal);
      if (search.notRegistered || !search.authorId) throw new Error('该达人未入驻星图');
      authorId = search.authorId;
      nickname = search.nickname;
      if (searchUrl !== item.sourceUrl) {
        this.repository.updateCollectionItem(item.id, { sourceUrl: searchUrl });
      }
    }

    this.repository.updateCollectionItem(item.id, { status: 'running', authorId, nickname, accountRemark });
    this.emitState(item.jobId);
    const result = await this.gateway.collectAuthor(
      authorId,
      this.repository.getAccountCookies(accountId),
      settings.fields,
      signal,
    );
    const collectedAt = new Date().toISOString();
    const fans = String(result.data['粉丝数'] ?? '');
    this.repository.updateCollectionItem(item.id, {
      status: result.status,
      authorId,
      nickname: String(result.data['达人昵称'] ?? nickname),
      fans,
      collectedAt,
      errors: result.errors,
    });
    this.repository.saveSnapshot({ itemId: item.id, authorId, data: result.data, errors: result.errors });
  }

  private async waitIfPaused(): Promise<void> {
    if (this.runtime?.status !== 'paused') return;
    await new Promise<void>((resolve) => this.runtime?.resumeWaiters.push(resolve));
  }

  private assertRuntime(jobId: string): void {
    if (!this.runtime || this.runtime.jobId !== jobId) throw new Error('采集任务未运行');
  }

  private emitState(jobId: string): void {
    this.emit({
      type: 'collection.changed',
      job: this.repository.getJob(jobId),
      items: this.repository.listCollectionItems(jobId),
    });
  }
}