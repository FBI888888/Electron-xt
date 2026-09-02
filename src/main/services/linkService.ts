import { randomUUID } from 'node:crypto';
import type { AppEvent, LinkConversionItem } from '../../shared/domain';
import { extractLinks } from '../../shared/parsers';
import type { DouyinLinkResolver } from '../../infrastructure/douyin/linkResolver';
import type { ApplicationRepository } from '../../infrastructure/storage/repositories';
import type { XingtuGateway } from '../../infrastructure/xingtu/gateway';

export class LinkService {
  private controller: AbortController | null = null;

  constructor(
    private readonly repository: ApplicationRepository,
    private readonly gateway: XingtuGateway,
    private readonly linkResolver: DouyinLinkResolver,
    private readonly emit: (event: AppEvent) => void,
  ) {}

  importText(text: string): LinkConversionItem[] {
    const items = extractLinks(text).map((url) => ({
      id: randomUUID(),
      sourceText: url,
      extractedUrl: url,
      douyinUrl: '',
      xingtuUrl: '',
      nickname: '',
      status: 'pending' as const,
      error: '',
    }));
    this.repository.replaceLinks(items);
    this.emitState(items, `已导入 ${items.length} 条链接`);
    return items;
  }

  async start(accountId: string, selectedIds?: string[]): Promise<LinkConversionItem[]> {
    if (this.controller) throw new Error('链接转换任务正在运行');
    this.controller = new AbortController();
    const cookies = this.repository.getAccountCookies(accountId);
    const items = this.repository.listLinks();
    const queue = items.filter((item) => (!selectedIds || selectedIds.includes(item.id)) && item.status !== 'ok');
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < queue.length && !this.controller?.signal.aborted) {
        const item = queue[cursor++];
        if (!item) break;
        item.status = 'processing';
        item.error = '';
        this.persist(items, '正在转换链接');
        try {
          item.douyinUrl = await this.linkResolver.resolve(item.extractedUrl, this.controller!.signal);
          const search = await this.gateway.searchAuthor(item.douyinUrl, cookies, this.controller!.signal);
          if (search.notRegistered || !search.authorId) {
            item.status = 'no-xingtu';
            item.nickname = '未入驻星图';
          } else {
            item.status = 'ok';
            item.nickname = search.nickname;
            item.xingtuUrl = `https://www.xingtu.cn/ad/creator/author-homepage/douyin-video/${search.authorId}`;
          }
        } catch (error) {
          const cancelled = error instanceof DOMException && error.name === 'AbortError';
          item.status = cancelled ? 'cancelled' : 'failed';
          item.error = error instanceof Error ? error.message : String(error);
        }
        this.persist(items, `已处理 ${items.filter((entry) => ['ok', 'no-xingtu', 'failed'].includes(entry.status)).length}/${items.length}`);
      }
    };
    try {
      await Promise.all([worker(), worker()]);
      return items;
    } finally {
      this.controller = null;
    }
  }

  stop(): void {
    this.controller?.abort();
  }

  private persist(items: LinkConversionItem[], status: string): void {
    this.repository.replaceLinks(items);
    this.emitState(items, status);
  }

  private emitState(items: LinkConversionItem[], status: string): void {
    this.emit({ type: 'links.changed', items, status });
  }
}