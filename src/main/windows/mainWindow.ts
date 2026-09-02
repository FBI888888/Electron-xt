import { BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const isTrustedExternalUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['xingtu.cn', 'douyin.com'].some(
      (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`),
    );
  } catch {
    return false;
  }
};

const hasSameOrigin = (value: string, expected: string): boolean => {
  try {
    return new URL(value).origin === new URL(expected).origin;
  } catch {
    return false;
  }
};

export const createMainWindow = (): BrowserWindow => {
  const rendererFile = join(__dirname, '../renderer/index.html');
  const rendererUrl = pathToFileURL(rendererFile).toString();
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f4f6f8',
    icon: join(__dirname, '../../logo.ico'),
    title: '星图数据快照',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (devUrl && hasSameOrigin(url, devUrl)) return;
    if (url === rendererUrl || url.startsWith(`${rendererUrl}#`)) return;
    event.preventDefault();
  });
  window.once('ready-to-show', () => window.show());

  if (devUrl) {
    void window.loadURL(devUrl);
  } else {
    void window.loadURL(rendererUrl);
  }

  return window;
};