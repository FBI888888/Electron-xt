import { ipcRenderer, contextBridge } from 'electron';
import type { ElectronApi } from '../shared/ipc';
import { IPC } from '../shared/ipc';
import type { AppEvent } from '../shared/domain';

const api: ElectronApi = {
  bootstrap: () => ipcRenderer.invoke(IPC.bootstrap),
  quit: () => ipcRenderer.invoke(IPC.appQuit),
  accounts: {
    list: () => ipcRenderer.invoke(IPC.accountsList),
    add: (draft) => ipcRenderer.invoke(IPC.accountsAdd, draft),
    update: (id, draft) => ipcRenderer.invoke(IPC.accountsUpdate, id, draft),
    remove: (id) => ipcRenderer.invoke(IPC.accountsRemove, id),
    check: (id) => ipcRenderer.invoke(IPC.accountsCheck, id),
    checkAll: () => ipcRenderer.invoke(IPC.accountsCheckAll),
    openLogin: (provider, remark) => ipcRenderer.invoke(IPC.accountsOpenLogin, provider, remark),
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (settings) => ipcRenderer.invoke(IPC.settingsUpdate, settings),
    chooseDirectory: () => ipcRenderer.invoke(IPC.settingsChooseDirectory),
  },
  collection: {
    get: () => ipcRenderer.invoke(IPC.collectionGet),
    importText: (text) => ipcRenderer.invoke(IPC.collectionImportText, text),
    importFile: () => ipcRenderer.invoke(IPC.collectionImportFile),
    start: (jobId) => ipcRenderer.invoke(IPC.collectionStart, jobId),
    pause: (jobId) => ipcRenderer.invoke(IPC.collectionPause, jobId),
    resume: (jobId) => ipcRenderer.invoke(IPC.collectionResume, jobId),
    stop: (jobId) => ipcRenderer.invoke(IPC.collectionStop, jobId),
    retry: (itemIds) => ipcRenderer.invoke(IPC.collectionRetry, itemIds),
    clear: () => ipcRenderer.invoke(IPC.collectionClear),
    export: (jobId) => ipcRenderer.invoke(IPC.collectionExport, jobId),
  },
  bloggers: {
    openBrowser: () => ipcRenderer.invoke(IPC.bloggersOpenBrowser),
    capture: () => ipcRenderer.invoke(IPC.bloggersCapture),
    fetch: (maxPages) => ipcRenderer.invoke(IPC.bloggersFetch, maxPages),
    pause: () => ipcRenderer.invoke(IPC.bloggersPause),
    resume: () => ipcRenderer.invoke(IPC.bloggersResume),
    stop: () => ipcRenderer.invoke(IPC.bloggersStop),
    clear: () => ipcRenderer.invoke(IPC.bloggersClear),
    export: () => ipcRenderer.invoke(IPC.bloggersExport),
  },
  links: {
    get: () => ipcRenderer.invoke(IPC.linksGet),
    importText: (text) => ipcRenderer.invoke(IPC.linksImportText, text),
    importFile: () => ipcRenderer.invoke(IPC.linksImportFile),
    start: () => ipcRenderer.invoke(IPC.linksStart),
    stop: () => ipcRenderer.invoke(IPC.linksStop),
    retry: (ids) => ipcRenderer.invoke(IPC.linksRetry, ids),
    clear: () => ipcRenderer.invoke(IPC.linksClear),
    export: () => ipcRenderer.invoke(IPC.linksExport),
  },
  license: {
    get: () => ipcRenderer.invoke(IPC.licenseGet),
    activate: (key, force) => ipcRenderer.invoke(IPC.licenseActivate, key, force),
    unbind: () => ipcRenderer.invoke(IPC.licenseUnbind),
  },
  onEvent(listener) {
    const handler = (_event: Electron.IpcRendererEvent, payload: AppEvent): void => listener(payload);
    ipcRenderer.on(IPC.appEvent, handler);
    return () => ipcRenderer.removeListener(IPC.appEvent, handler);
  },
};

contextBridge.exposeInMainWorld('api', api);