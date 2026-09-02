import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IPC } from '../src/shared/ipc';

const projectFile = (...parts: string[]): string => join(process.cwd(), ...parts);
const readSource = (...parts: string[]): string => readFileSync(projectFile(...parts), 'utf8');
const readSourcesRecursively = (directory: string): string => readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return [readSourcesRecursively(path)];
    return /\.(?:ts|tsx)$/u.test(entry.name) ? [readFileSync(path, 'utf8')] : [];
  })
  .join('\n');

describe('Electron 安全边界', () => {
  it('所有应用窗口都关闭 Node 注入并启用隔离与沙箱', () => {
    const windowSources = [
      readSource('src', 'main', 'windows', 'mainWindow.ts'),
      readSource('src', 'main', 'services', 'bloggerService.ts'),
      readSource('src', 'main', 'services', 'linkService.ts'),
      readSource('src', 'main', 'services', 'loginService.ts'),
      readSource('src', 'infrastructure', 'douyin', 'linkResolver.ts'),
    ].join('\n');

    expect(windowSources).not.toMatch(/nodeIntegration:\s*true/);
    expect(windowSources).not.toMatch(/contextIsolation:\s*false/);
    expect(windowSources.match(/sandbox:\s*true/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('preload 只暴露 typed api，IPC 不包含任意文件系统通道', () => {
    const preloadSource = readSource('src', 'preload', 'index.ts');
    const channels = Object.values(IPC);

    expect(preloadSource).toContain("contextBridge.exposeInMainWorld('api', api)");
    expect(preloadSource).not.toMatch(/exposeInMainWorld\([^,]+,\s*(?:require|process|fs)\b/);
    expect(channels).not.toEqual(expect.arrayContaining(['read-file', 'write-file', 'file-exists']));
    expect(channels.every((channel) => /^[a-z]+:[a-z-]+$/.test(channel))).toBe(true);
  });

  it('主窗口限制导航来源并配置 CSP，远程窗口只接受业务域名', () => {
    const mainWindow = readSource('src', 'main', 'windows', 'mainWindow.ts');
    const loginWindow = readSource('src', 'main', 'services', 'loginService.ts');
    const bloggerWindow = readSource('src', 'main', 'services', 'bloggerService.ts');
    const shortLinkWindow = readSource('src', 'infrastructure', 'douyin', 'linkResolver.ts');
    const rendererHtml = readSource('src', 'renderer', 'index.html');

    expect(mainWindow).not.toContain("url.startsWith('file://')");
    expect(mainWindow).toContain('hasSameOrigin(url, devUrl)');
    expect(mainWindow).toContain("['xingtu.cn', 'douyin.com']");
    expect(loginWindow).toContain('isTrustedLoginUrl');
    expect(bloggerWindow).toContain('isXingtuUrl');
    expect(shortLinkWindow).toContain('isTrustedDouyinUrl');
    expect(rendererHtml).toContain('Content-Security-Policy');
    expect(rendererHtml).toContain("object-src 'none'");
    expect(rendererHtml).toContain("frame-ancestors 'none'");
  });

  it('授权日志不输出凭据或原始响应，IPC 对关键输入执行大小和类型校验', () => {
    const licenseSource = readSource('main', 'license.js');
    const ipcSource = readSource('src', 'main', 'ipc', 'register.ts');

    expect(licenseSource).not.toContain('请求数据:');
    expect(licenseSource).not.toContain('响应数据:');
    expect(licenseSource).not.toContain('原始响应:');
    expect(ipcSource).toContain("cookies: z.string().trim().min(10, 'Cookie 内容无效').max(100_000");
    expect(ipcSource).toContain("const sourceTextSchema = z.string().max(2_000_000");
    expect(ipcSource).toContain('z.boolean().optional().default(false).parse(rawForce)');
    expect(ipcSource).not.toContain('Boolean(rawForce)');
  });

  it('渲染进程不使用浏览器原生业务弹窗', () => {
    const rendererSources = readSourcesRecursively(projectFile('src', 'renderer', 'src'));

    expect(rendererSources).not.toMatch(/window\.(?:confirm|alert|prompt)\s*\(/u);
    expect(rendererSources).not.toMatch(/\bconfirm\s*\(\s*['"`]/u);
    expect(rendererSources).not.toMatch(/\b(?:alert|prompt)\s*\(/u);
  });

  it('打包清单不包含运行数据和旧页面入口', () => {
    const packageJson = JSON.parse(readSource('package.json')) as {
      build: { files: string[] };
    };

    expect(packageJson.build.files).not.toEqual(expect.arrayContaining([
      'data/**/*',
      'index.html',
      'activation.html',
      'renderer/app.js',
    ]));
    expect(packageJson.build.files).toEqual(expect.arrayContaining(['out/**/*', 'main/license.js', 'main/xingtuApi.js']));
  });
});