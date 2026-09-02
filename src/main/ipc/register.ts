import { app, dialog, ipcMain } from 'electron';
import { z } from 'zod';
import type { AppEvent, BootstrapData, CollectionSettings } from '../../shared/domain';
import { IPC } from '../../shared/ipc';
import { err, ok } from '../../shared/result';
import { parseSourceText } from '../../shared/parsers';
import type { ApplicationRepository } from '../../infrastructure/storage/repositories';
import type { XingtuGateway } from '../../infrastructure/xingtu/gateway';
import type { CollectionEngine } from '../../modules/collection/engine';
import type { BloggerService } from '../services/bloggerService';
import type { LinkService } from '../services/linkService';
import type { LoginService } from '../services/loginService';
import type { LicenseGateway } from '../services/licenseGateway';
import {
  chooseAndExtractLinks,
  chooseAndParseSources,
  exportBloggers,
  exportLinks,
  exportSnapshots,
} from '../services/excelService';

export interface IpcServices {
  repository: ApplicationRepository;
  xingtu: XingtuGateway;
  collection: CollectionEngine;
  bloggers: BloggerService;
  links: LinkService;
  login: LoginService;
  license: LicenseGateway;
  emit(event: AppEvent): void;
}

const accountDraftSchema = z.object({
  remark: z.string().trim().min(1, '请输入账号备注').max(100, '账号备注过长'),
  cookies: z.string().trim().min(10, 'Cookie 内容无效').max(100_000, 'Cookie 内容过长'),
});

const entityIdSchema = z.string().min(1).max(128);
const entityIdsSchema = z.array(entityIdSchema).max(10_000);
const sourceTextSchema = z.string().max(2_000_000, '导入文本过大');
const collectFieldSchema = z.enum([
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
]);

const settingsSchema = z.object({
  filename: z.string().trim().min(1).max(200).refine((value) => !/[\\/:*?"<>|]/u.test(value), '文件名包含非法字符'),
  directory: z.string().max(2_000),
  fields: z.array(collectFieldSchema).max(12),
  accountMode: z.enum(['round-robin', 'single']),
  singleAccountId: z.string().nullable(),
  concurrency: z.number().int().min(1).max(6),
});

const handle = (channel: string, handler: (...args: unknown[]) => unknown | Promise<unknown>): void => {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return ok(await handler(...args));
    } catch (error) {
      console.error(`[IPC:${channel}]`, error);
      const code = error && typeof error === 'object' && 'code' in error
        ? String((error as { code: unknown }).code)
        : 'OPERATION_FAILED';
      return err(code, error instanceof Error ? error.message : String(error));
    }
  });
};

export const registerIpcHandlers = (services: IpcServices): void => {
  const ensureAuthorized = async (): Promise<void> => services.license.authorize();
  const ensurePremium = async (): Promise<void> => services.license.authorize(['VVIP', 'SVIP']);
  const emitAccounts = (): void => services.emit({ type: 'accounts.changed', accounts: services.repository.listAccounts() });

  handle(IPC.appQuit, () => {
    app.quit();
  });

  handle(IPC.bootstrap, async (): Promise<BootstrapData> => ({
    accounts: services.repository.listAccounts(),
    settings: services.repository.getSettings(),
    activeJob: services.repository.getActiveJob(),
    collectionItems: services.repository.listCollectionItems(),
    bloggers: services.repository.listBloggers(),
    links: services.repository.listLinks(),
    license: services.license.get(),
  }));

  handle(IPC.accountsList, () => services.repository.listAccounts());
  handle(IPC.accountsAdd, async (input) => {
    await ensureAuthorized();
    const draft = accountDraftSchema.parse(input);
    const details = await services.xingtu.checkAccount(draft.cookies);
    const account = services.repository.addAccount(draft, {
      nickname: details.nickname,
      grade: details.grade,
      status: 'healthy',
    });
    emitAccounts();
    return account;
  });
  handle(IPC.accountsUpdate, async (rawId, input) => {
    await ensureAuthorized();
    const id = entityIdSchema.parse(rawId);
    const patch = z.object({
      remark: z.string().trim().min(1, '请输入账号备注').max(100, '账号备注过长'),
      cookies: z.string().max(100_000, 'Cookie 内容过长').optional(),
    }).parse(input);
    const cookies = patch.cookies?.trim() || services.repository.getAccountCookies(id);
    if (cookies.length < 10) throw new Error('Cookie 内容无效');
    const details = await services.xingtu.checkAccount(cookies);
    services.repository.updateAccount(id, { remark: patch.remark, cookies });
    const account = services.repository.updateAccountHealth(id, {
      nickname: details.nickname,
      grade: details.grade,
      status: 'healthy',
    });
    emitAccounts();
    return account;
  });
  handle(IPC.accountsRemove, async (rawId) => {
    await ensureAuthorized();
    services.repository.removeAccount(entityIdSchema.parse(rawId));
    emitAccounts();
  });
  handle(IPC.accountsCheck, async (rawId) => {
    await ensureAuthorized();
    const id = entityIdSchema.parse(rawId);
    try {
      const details = await services.xingtu.checkAccount(services.repository.getAccountCookies(id));
      const account = services.repository.updateAccountHealth(id, { ...details, status: 'healthy' });
      emitAccounts();
      return account;
    } catch (error) {
      services.repository.updateAccountHealth(id, { nickname: '', grade: 0, status: 'invalid' });
      emitAccounts();
      throw error;
    }
  });
  handle(IPC.accountsCheckAll, async () => {
    await ensureAuthorized();
    for (const account of services.repository.listAccounts()) {
      try {
        const details = await services.xingtu.checkAccount(services.repository.getAccountCookies(account.id));
        services.repository.updateAccountHealth(account.id, { ...details, status: 'healthy' });
      } catch {
        services.repository.updateAccountHealth(account.id, {
          nickname: account.nickname,
          grade: account.grade,
          status: 'invalid',
        });
      }
    }
    emitAccounts();
    return services.repository.listAccounts();
  });
  handle(IPC.accountsOpenLogin, async (rawProvider, rawRemark) => {
    await ensureAuthorized();
    await services.login.open(
      z.enum(['xingtu', 'fangzhou']).parse(rawProvider),
      z.string().trim().min(1, '请输入账号备注').max(80, '账号备注过长').parse(rawRemark),
    );
  });

  handle(IPC.settingsGet, () => services.repository.getSettings());
  handle(IPC.settingsUpdate, async (input) => {
    await ensureAuthorized();
    return services.repository.saveSettings(settingsSchema.parse(input) as CollectionSettings);
  });
  handle(IPC.settingsChooseDirectory, async () => {
    const selection = await dialog.showOpenDialog({
      title: '选择默认保存目录',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (selection.canceled || !selection.filePaths[0]) return null;
    return selection.filePaths[0];
  });

  handle(IPC.collectionGet, () => ({
    job: services.repository.getActiveJob(),
    items: services.repository.listCollectionItems(),
  }));
  handle(IPC.collectionImportText, async (rawText) => {
    await ensureAuthorized();
    const parsed = parseSourceText(sourceTextSchema.parse(rawText));
    if (parsed.valid.length === 0) throw new Error('没有识别到有效的星图或抖音主页链接');
    services.repository.clearCollection();
    const job = services.repository.createJob(parsed.valid);
    services.emit({ type: 'collection.changed', job, items: services.repository.listCollectionItems(job.id) });
    return { job, imported: parsed.valid.length, duplicates: parsed.duplicates, invalid: parsed.invalid.length };
  });
  handle(IPC.collectionImportFile, async () => {
    await ensureAuthorized();
    const parsed = await chooseAndParseSources();
    if (!parsed) return null;
    if (parsed.sources.length === 0) throw new Error('文件中没有可采集的主页链接');
    services.repository.clearCollection();
    const job = services.repository.createJob(parsed.sources);
    services.emit({ type: 'collection.changed', job, items: services.repository.listCollectionItems(job.id) });
    return { job, imported: parsed.sources.length, duplicates: parsed.duplicates, invalid: parsed.invalid };
  });
  handle(IPC.collectionStart, async (rawId) => {
    await ensureAuthorized();
    return services.collection.start(entityIdSchema.parse(rawId));
  });
  handle(IPC.collectionPause, (rawId) => services.collection.pause(entityIdSchema.parse(rawId)));
  handle(IPC.collectionResume, async (rawId) => {
    await ensureAuthorized();
    return services.collection.resume(entityIdSchema.parse(rawId));
  });
  handle(IPC.collectionStop, (rawId) => services.collection.stop(entityIdSchema.parse(rawId)));
  handle(IPC.collectionRetry, async (rawIds) => {
    await ensureAuthorized();
    const ids = entityIdsSchema.parse(rawIds);
    const job = services.repository.resetCollectionItems(ids);
    if (!job) throw new Error('没有可重试的采集项');
    return services.collection.start(job.id);
  });
  handle(IPC.collectionClear, async () => {
    await ensureAuthorized();
    if (services.collection.isRunning()) throw new Error('请先停止当前采集任务');
    services.repository.clearCollection();
    services.emit({ type: 'collection.changed', job: null, items: [] });
  });
  handle(IPC.collectionExport, async (rawId) => {
    await ensureAuthorized();
    const id = entityIdSchema.parse(rawId);
    const settings = services.repository.getSettings();
    const items = services.repository.listCollectionItems(id);
    const isSvip = services.license.get().level === 'SVIP';
    return exportSnapshots(settings, services.repository.getSnapshots(id), items, isSvip);
  });

  handle(IPC.bloggersOpenBrowser, async () => {
    await ensurePremium();
    const account = services.repository.listAccounts().find((entry) => entry.status === 'healthy');
    if (!account) throw new Error('请先添加并验证可用账号');
    await services.bloggers.open(account.id);
  });
  handle(IPC.bloggersCapture, async () => {
    await ensurePremium();
    return services.bloggers.captureStatus();
  });
  handle(IPC.bloggersFetch, async (rawPages) => {
    await ensurePremium();
    return services.bloggers.fetch(z.number().int().min(1).max(500).parse(rawPages));
  });
  handle(IPC.bloggersPause, () => services.bloggers.pause());
  handle(IPC.bloggersResume, () => services.bloggers.resume());
  handle(IPC.bloggersStop, () => services.bloggers.stop());
  handle(IPC.bloggersClear, async () => {
    await ensurePremium();
    services.repository.clearBloggers();
    services.emit({ type: 'bloggers.changed', rows: [], status: '列表已清空' });
  });
  handle(IPC.bloggersExport, async () => {
    await ensurePremium();
    return exportBloggers(services.repository.listBloggers());
  });

  handle(IPC.linksGet, async () => {
    await ensureAuthorized();
    return services.repository.listLinks();
  });
  handle(IPC.linksImportText, async (rawText) => {
    await ensureAuthorized();
    return services.links.importText(sourceTextSchema.parse(rawText));
  });
  handle(IPC.linksImportFile, async () => {
    await ensureAuthorized();
    const urls = await chooseAndExtractLinks();
    return urls ? services.links.importText(urls.join('\n')) : null;
  });
  handle(IPC.linksStart, async () => {
    await ensureAuthorized();
    const account = services.repository.listAccounts().find((entry) => entry.status === 'healthy');
    if (!account) throw new Error('请先添加并验证可用账号');
    return services.links.start(account.id);
  });
  handle(IPC.linksStop, () => services.links.stop());
  handle(IPC.linksRetry, async (rawIds) => {
    await ensureAuthorized();
    const account = services.repository.listAccounts().find((entry) => entry.status === 'healthy');
    if (!account) throw new Error('请先添加并验证可用账号');
    return services.links.start(account.id, entityIdsSchema.parse(rawIds));
  });
  handle(IPC.linksClear, async () => {
    await ensureAuthorized();
    services.links.stop();
    services.repository.clearLinks();
    services.emit({ type: 'links.changed', items: [], status: '列表已清空' });
  });
  handle(IPC.linksExport, async () => {
    await ensureAuthorized();
    return exportLinks(services.repository.listLinks());
  });

  handle(IPC.licenseGet, () => services.license.get());
  handle(IPC.licenseActivate, async (rawKey, rawForce) => {
    const key = z.string().trim().min(1).max(128).parse(rawKey);
    const force = z.boolean().optional().default(false).parse(rawForce);
    const license = await services.license.activate(key, force);
    services.emit({ type: 'license.changed', license });
    return license;
  });
  handle(IPC.licenseUnbind, async () => {
    await services.license.unbind();
    services.emit({ type: 'license.changed', license: services.license.get() });
  });
};