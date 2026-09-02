import { BrowserWindow, session } from 'electron';
import { randomUUID } from 'node:crypto';

export interface DouyinLinkResolver {
  resolve(url: string, signal: AbortSignal): Promise<string>;
}

const extractUserUrl = (candidate: string): string | null => {
  const match = candidate.match(/https:\/\/(?:www\.)?(?:douyin\.com\/user|iesdouyin\.com\/share\/user)\/([A-Za-z0-9_-]+)/i);
  return match?.[1] ? `https://www.douyin.com/user/${match[1]}` : null;
};

const isTrustedDouyinUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['douyin.com', 'iesdouyin.com'].some(
      (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`),
    );
  } catch {
    return false;
  }
};

export const createDouyinLinkResolver = (): DouyinLinkResolver => ({
  resolve(url, signal) {
    const direct = extractUserUrl(url);
    if (direct) return Promise.resolve(direct);
    if (!/https:\/\/v\.douyin\.com\//i.test(url)) {
      return Promise.reject(new Error('不是受支持的抖音主页或短链接'));
    }
    if (signal.aborted) return Promise.reject(new DOMException('操作已取消', 'AbortError'));

    return new Promise((resolve, reject) => {
      const partition = `memory:resolve-${Date.now()}-${randomUUID()}`;
      const resolveSession = session.fromPartition(partition, { cache: false });
      const window = new BrowserWindow({
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, partition },
      });
      let settled = false;

      const finish = (error?: Error, value?: string): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        if (!window.isDestroyed()) window.destroy();
        void resolveSession.clearStorageData();
        if (error) reject(error);
        else resolve(value!);
      };
      const inspect = (candidate: string): void => {
        const resolved = extractUserUrl(candidate);
        if (resolved) finish(undefined, resolved);
      };
      const onAbort = (): void => finish(new DOMException('操作已取消', 'AbortError'));
      const timer = setTimeout(() => finish(new Error('短链解析超时')), 15_000);

      signal.addEventListener('abort', onAbort, { once: true });
      resolveSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
        inspect(details.url);
        callback({});
      });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-redirect', (event, target) => {
        inspect(target);
        if (!isTrustedDouyinUrl(target)) event.preventDefault();
      });
      window.webContents.on('will-navigate', (event, target) => {
        inspect(target);
        if (!isTrustedDouyinUrl(target)) event.preventDefault();
      });
      window.webContents.on('did-fail-load', (_event, _code, description) => {
        if (!settled) finish(new Error(description || '短链页面加载失败'));
      });
      void window.loadURL(url).catch((error: Error) => finish(error));
    });
  },
});