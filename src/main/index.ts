import { app, BrowserWindow, Menu, session } from 'electron';
import { dirname, join } from 'node:path';
import type { AppEvent } from '../shared/domain';
import { IPC } from '../shared/ipc';
import { openDatabase } from '../infrastructure/storage/database';
import { createCredentialVault } from '../infrastructure/storage/credentialVault';
import { createDouyinLinkResolver } from '../infrastructure/douyin/linkResolver';
import { migrateLegacyData } from '../infrastructure/storage/legacyMigration';
import { ApplicationRepository } from '../infrastructure/storage/repositories';
import { createXingtuGateway } from '../infrastructure/xingtu/gateway';
import { CollectionEngine } from '../modules/collection/engine';
import { registerIpcHandlers } from './ipc/register';
import { BloggerService } from './services/bloggerService';
import { LicenseGateway } from './services/licenseGateway';
import { LinkService } from './services/linkService';
import { LoginService } from './services/loginService';
import { createMainWindow } from './windows/mainWindow';

let mainWindow: BrowserWindow | null = null;
let cleanup: (() => void) | null = null;

const emit = (event: AppEvent): void => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.appEvent, event);
};

const bootstrap = async (): Promise<void> => {
  Menu.setApplicationMenu(null);
  const userData = app.getPath('userData');
  const database = openDatabase(join(userData, 'xingtu-snapshots.sqlite'));
  const repository = new ApplicationRepository(database, createCredentialVault());
  await migrateLegacyData({
    database,
    repository,
    legacyDataDirectories: [join(process.cwd(), 'data'), join(dirname(app.getPath('exe')), 'data')],
    backupDirectory: join(userData, 'migration-backup'),
  });
  repository.recoverInterruptedCollection();

  const xingtu = createXingtuGateway();
  const linkResolver = createDouyinLinkResolver();
  const license = new LicenseGateway(userData, [process.cwd(), dirname(app.getPath('exe'))]);
  await license.verify();
  mainWindow = createMainWindow();
  const parent = (): BrowserWindow | null => mainWindow;
  const collection = new CollectionEngine(repository, xingtu, linkResolver, emit);
  const login = new LoginService(parent, repository, xingtu, emit);
  const bloggers = new BloggerService(parent, repository, emit);
  const links = new LinkService(repository, xingtu, linkResolver, emit);

  registerIpcHandlers({ repository, xingtu, collection, bloggers, links, login, license, emit });

  license.startHeartbeat((message) => {
    emit({ type: 'license.changed', license: license.get() });
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitle(`星图数据快照 - ${message}`);
  });

  cleanup = () => {
    collection.shutdown();
    links.stop();
    bloggers.close();
    login.closeAll();
    license.stopHeartbeat();
    database.close();
  };
};

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    await bootstrap();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow();
    });
  });

  app.on('before-quit', () => {
    cleanup?.();
    cleanup = null;
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}