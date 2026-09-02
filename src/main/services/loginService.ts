import { BrowserWindow, session } from 'electron';
import type { AppEvent } from '../../shared/domain';
import type { XingtuGateway } from '../../infrastructure/xingtu/gateway';
import type { ApplicationRepository } from '../../infrastructure/storage/repositories';

const LOGIN_DOMAIN_ROOTS = ['xingtu.cn', 'oceanengine.com', 'douyin.com', 'bytedance.com'];

const isTrustedLoginUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && LOGIN_DOMAIN_ROOTS.some(
      (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`),
    );
  } catch {
    return false;
  }
};

export class LoginService {
  private windows = new Set<BrowserWindow>();
  private counter = 0;

  constructor(
    private readonly parent: () => BrowserWindow | null,
    private readonly repository: ApplicationRepository,
    private readonly gateway: XingtuGateway,
    private readonly emit: (event: AppEvent) => void,
  ) {}

  async open(provider: 'xingtu' | 'fangzhou'): Promise<void> {
    const partition = `memory:login-${Date.now()}-${this.counter++}`;
    const loginSession = session.fromPartition(partition, { cache: false });
    await Promise.all([loginSession.clearStorageData(), loginSession.clearCache()]);
    const captured = new Set<string>();

    loginSession.webRequest.onBeforeSendHeaders(
      { urls: ['https://www.xingtu.cn/gw/api/demander/grade_info*'] },
      (details, callback) => {
        const cookies = details.requestHeaders.Cookie ?? details.requestHeaders.cookie;
        callback({ requestHeaders: details.requestHeaders });
        if (!cookies || captured.has(cookies)) return;
        captured.add(cookies);
        void this.captureAccount(cookies, provider === 'xingtu');
      },
    );

    const createWindow = (url: string, title: string): BrowserWindow => {
      if (!isTrustedLoginUrl(url)) throw new Error('登录窗口拒绝打开不受信任的地址');
      const parentWindow = this.parent();
      const window = new BrowserWindow({
        width: 1200,
        height: 820,
        ...(parentWindow ? { parent: parentWindow } : {}),
        title,
        autoHideMenuBar: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          partition,
        },
      });
      this.windows.add(window);
      window.webContents.setWindowOpenHandler(({ url: childUrl }) => {
        if (isTrustedLoginUrl(childUrl)) createWindow(childUrl, '方舟平台 - 子账号');
        return { action: 'deny' };
      });
      window.webContents.on('will-navigate', (event, target) => {
        if (!isTrustedLoginUrl(target)) event.preventDefault();
      });
      window.on('closed', () => {
        this.windows.delete(window);
        if (this.windows.size === 0) {
          void loginSession.clearStorageData();
          void loginSession.clearCache();
        }
      });
      void window.loadURL(url);
      return window;
    };

    createWindow(
      provider === 'xingtu' ? 'https://www.xingtu.cn/' : 'https://agent.oceanengine.com/login',
      provider === 'xingtu' ? '星图平台 - 登录账号' : '方舟平台 - 选择子账号',
    );
  }

  closeAll(): void {
    [...this.windows].forEach((window) => {
      if (!window.isDestroyed()) window.close();
    });
    this.windows.clear();
  }

  private async captureAccount(cookies: string, closeAfterCapture: boolean): Promise<void> {
    try {
      const details = await this.gateway.checkAccount(cookies);
      const existing = this.repository.listAccounts().find((account) => account.nickname === details.nickname);
      if (!existing) {
        this.repository.addAccount(
          { remark: details.nickname || '星图账号', cookies },
          { nickname: details.nickname, grade: details.grade, status: 'healthy' },
        );
      }
      this.emit({ type: 'accounts.changed', accounts: this.repository.listAccounts() });
      if (closeAfterCapture) this.closeAll();
    } catch (error) {
      console.error('[LoginService] capture account failed:', error);
    }
  }
}