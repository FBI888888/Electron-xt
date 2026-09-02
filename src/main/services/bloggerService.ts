import { BrowserWindow, session } from 'electron';
import https from 'node:https';
import type { AppEvent, BloggerFilterCapture, BloggerRow } from '../../shared/domain';
import type { ApplicationRepository } from '../../infrastructure/storage/repositories';

const isXingtuUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'xingtu.cn' || url.hostname.endsWith('.xingtu.cn'));
  } catch {
    return false;
  }
};

interface CapturedRequest {
  body: Record<string, unknown> & { page_param?: Record<string, unknown> };
  headers: Record<string, string>;
}

const requestPage = (
  captured: CapturedRequest,
  page: number,
  signal: AbortSignal,
): Promise<Array<Record<string, unknown>>> =>
  new Promise((resolve, reject) => {
    const body = {
      ...captured.body,
      page_param: { ...captured.body.page_param, page: String(page) },
    };
    const bodyText = JSON.stringify(body);
    const headers = { ...captured.headers };
    delete headers['content-length'];
    delete headers['Content-Length'];
    delete headers['accept-encoding'];
    delete headers['Accept-Encoding'];
    const request = https.request(
      {
        hostname: 'www.xingtu.cn',
        path: '/gw/api/gsearch/search_for_author_square',
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(bodyText) },
        timeout: 15_000,
      },
      (response) => {
        let data = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          data += chunk;
        });
        response.on('end', () => {
          try {
            const parsed = JSON.parse(data) as {
              authors?: Array<Record<string, unknown>>;
              base_resp?: { status_code?: number; status_message?: string };
            };
            if (parsed.base_resp?.status_code && parsed.base_resp.status_code !== 0) {
              reject(new Error(parsed.base_resp.status_message || '获取达人列表失败'));
              return;
            }
            resolve(parsed.authors ?? []);
          } catch {
            reject(new Error('达人列表响应解析失败'));
          }
        });
      },
    );
    request.on('error', reject);
    const onAbort = (): void => {
      request.destroy(new DOMException('操作已取消', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    request.on('close', () => signal.removeEventListener('abort', onAbort));
    request.write(bodyText);
    request.end();
  });

const jsonValue = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const mapAuthor = (author: Record<string, unknown>): BloggerRow | null => {
  const attrs = (author.attribute_datas ?? {}) as Record<string, unknown>;
  const id = String(attrs.id ?? author.star_id ?? '');
  if (!id) return null;
  const tags = jsonValue<Record<string, unknown>>(attrs.tags_relation, {});
  const contentTags = jsonValue<string[]>(attrs.content_theme_labels_180d, []);
  const priceInfos = (((author.task_infos as Array<Record<string, unknown>> | undefined)?.[0]?.price_infos ?? []) as Array<
    Record<string, unknown>
  >);
  const price = (type: number): string => String(priceInfos.find((item) => Number(item.video_type) === type)?.price ?? '-');
  return {
    id,
    avatarUrl: String(attrs.avatar_uri ?? ''),
    xingtuUrl: `https://www.xingtu.cn/ad/creator/author-homepage/douyin-video/${id}`,
    nickname: String(attrs.nick_name ?? ''),
    location: `${String(attrs.province ?? '')}${String(attrs.city ?? '')}`,
    gender: String(attrs.gender) === '1' ? '男' : String(attrs.gender) === '2' ? '女' : '-',
    personalTags: Object.keys(tags).join('、'),
    contentTags: contentTags.slice(0, 5).join('、'),
    fans: Number(attrs.follower ?? 0),
    fansGrowth30d: String(attrs.fans_increment_within_30d ?? '-'),
    playMedian: Number(attrs.vv_median_30d ?? 0),
    interactionMedian: Number(attrs.interaction_median_30d ?? 0),
    completionRate: attrs.play_over_rate_within_30d
      ? `${(Number(attrs.play_over_rate_within_30d) * 100).toFixed(2)}%`
      : '-',
    interactionRate: attrs.interact_rate_within_30d
      ? `${(Number(attrs.interact_rate_within_30d) * 100).toFixed(2)}%`
      : '-',
    expectedPlay: Number(attrs.expected_play_num ?? 0),
    ecomLevel: String(attrs.author_ecom_level ?? '-'),
    starIndex: String(attrs.link_star_index ?? '-'),
    spreadIndex: String(attrs.link_spread_index ?? '-'),
    shoppingIndex: String(attrs.link_shopping_index ?? '-'),
    prices: [String(attrs.price_1_20 ?? price(1)), String(attrs.price_20_60 ?? price(2)), String(attrs.price_60 ?? price(3))],
  };
};

export class BloggerService {
  private browser: BrowserWindow | null = null;
  private captured: CapturedRequest | null = null;
  private controller: AbortController | null = null;
  private paused = false;
  private pauseWaiters: Array<() => void> = [];
  private progress = { page: 0, count: 0 };

  constructor(
    private readonly parent: () => BrowserWindow | null,
    private readonly repository: ApplicationRepository,
    private readonly emit: (event: AppEvent) => void,
  ) {}

  private releasePause(): void {
    this.paused = false;
    for (const resolve of this.pauseWaiters) resolve();
    this.pauseWaiters = [];
  }

  private async waitIfPaused(): Promise<void> {
    if (!this.paused) return;
    await new Promise<void>((resolve) => {
      this.pauseWaiters.push(resolve);
    });
  }

  async open(accountId: string): Promise<void> {
    if (this.browser && !this.browser.isDestroyed()) {
      this.browser.focus();
      return;
    }
    const partition = `memory:bloggers-${Date.now()}`;
    const browserSession = session.fromPartition(partition, { cache: false });
    for (const pair of this.repository.getAccountCookies(accountId).split(';')) {
      const [name, ...parts] = pair.trim().split('=');
      if (!name || parts.length === 0) continue;
      await browserSession.cookies
        .set({ url: 'https://www.xingtu.cn', domain: '.xingtu.cn', name, value: parts.join('=') })
        .catch(() => undefined);
    }
    this.captured = null;
    this.emit({ type: 'bloggers.changed', rows: this.repository.listBloggers(), status: '请执行一次筛选以捕获查询条件' });
    let requestBody: CapturedRequest['body'] | null = null;
    browserSession.webRequest.onBeforeRequest(
      { urls: ['https://www.xingtu.cn/gw/api/gsearch/search_for_author_square*'] },
      (details, callback) => {
        const bytes = details.uploadData?.[0]?.bytes;
        if (details.method === 'POST' && bytes) {
          try {
            requestBody = JSON.parse(bytes.toString('utf8')) as CapturedRequest['body'];
          } catch {
            requestBody = null;
          }
        }
        callback({});
      },
    );
    browserSession.webRequest.onBeforeSendHeaders(
      { urls: ['https://www.xingtu.cn/gw/api/gsearch/search_for_author_square*'] },
      (details, callback) => {
        if (requestBody) {
          this.captured = { body: requestBody, headers: details.requestHeaders as Record<string, string> };
          this.emit({ type: 'bloggers.changed', rows: this.repository.listBloggers(), status: '已捕获筛选请求' });
        }
        callback({ requestHeaders: details.requestHeaders });
      },
    );
    const parentWindow = this.parent();
    this.browser = new BrowserWindow({
      width: 1400,
      height: 900,
      ...(parentWindow ? { parent: parentWindow } : {}),
      title: '达人广场 - 设置筛选条件',
      autoHideMenuBar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, partition },
    });
    this.browser.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.browser.webContents.on('will-navigate', (event, target) => {
      if (!isXingtuUrl(target)) event.preventDefault();
    });
    this.browser.on('closed', () => {
      this.browser = null;
      void browserSession.clearStorageData();
      void browserSession.clearCache();
    });
    await this.browser.loadURL('https://www.xingtu.cn/ad/creator/market');
  }

  captureStatus(): BloggerFilterCapture {
    return {
      ready: this.captured !== null,
      capturedAt: this.captured ? new Date().toISOString() : null,
      description: this.captured ? '已捕获筛选请求' : '请先打开达人广场并执行一次筛选',
    };
  }

  async fetch(maxPages: number): Promise<BloggerRow[]> {
    const captured = this.captured;
    if (!captured) throw new Error('尚未捕获达人广场筛选条件');
    if (this.controller) throw new Error('达人列表任务正在运行');
    const controller = new AbortController();
    this.controller = controller;
    this.releasePause();
    const byId = new Map(this.repository.listBloggers().map((row) => [row.id, row]));
    this.progress = { page: 0, count: byId.size };
    this.emit({ type: 'bloggers.changed', rows: [...byId.values()], status: '正在获取第 1 页…' });
    try {
      for (let page = 1; page <= maxPages; page += 1) {
        await this.waitIfPaused();
        if (controller.signal.aborted) break;
        const authors = await requestPage(captured, page, controller.signal);
        if (authors.length === 0) break;
        authors.map(mapAuthor).filter((row): row is BloggerRow => row !== null).forEach((row) => byId.set(row.id, row));
        const rows = [...byId.values()];
        this.progress = { page, count: rows.length };
        this.repository.replaceBloggers(rows);
        this.emit({ type: 'bloggers.changed', rows, status: `已获取 ${page} 页，共 ${rows.length} 位达人` });
        await this.waitIfPaused();
        if (controller.signal.aborted) break;
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      const rows = [...byId.values()];
      this.emit({
        type: 'bloggers.changed',
        rows,
        status: controller.signal.aborted
          ? `已停止，已获取 ${this.progress.page} 页，共 ${rows.length} 位达人`
          : `获取完成，共 ${rows.length} 位达人`,
      });
      return rows;
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        const rows = [...byId.values()];
        this.emit({ type: 'bloggers.changed', rows, status: `已停止，已获取 ${this.progress.page} 页，共 ${rows.length} 位达人` });
        return rows;
      }
      throw error;
    } finally {
      this.releasePause();
      this.controller = null;
    }
  }

  pause(): void {
    if (!this.controller || this.paused) return;
    this.paused = true;
    this.emit({
      type: 'bloggers.changed',
      rows: this.repository.listBloggers(),
      status: `已暂停，已获取 ${this.progress.page} 页，共 ${this.progress.count} 位达人`,
    });
  }

  resume(): void {
    if (!this.controller || !this.paused) return;
    this.releasePause();
    this.emit({
      type: 'bloggers.changed',
      rows: this.repository.listBloggers(),
      status: `已获取 ${this.progress.page} 页，共 ${this.progress.count} 位达人`,
    });
  }

  stop(): void {
    this.releasePause();
    this.controller?.abort();
  }

  close(): void {
    this.stop();
    if (this.browser && !this.browser.isDestroyed()) this.browser.close();
    this.browser = null;
  }
}