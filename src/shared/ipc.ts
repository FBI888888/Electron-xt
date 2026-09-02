import type {
  AccountDraft,
  AccountSummary,
  AppEvent,
  BloggerFilterCapture,
  BloggerRow,
  BootstrapData,
  CollectionItem,
  CollectionJob,
  CollectionSettings,
  EntityId,
  ImportSummary,
  LicenseInfo,
  LinkConversionItem,
  Result,
} from './domain';

export const IPC = {
  bootstrap: 'app:bootstrap',
  accountsList: 'accounts:list',
  accountsAdd: 'accounts:add',
  accountsUpdate: 'accounts:update',
  accountsRemove: 'accounts:remove',
  accountsCheck: 'accounts:check',
  accountsCheckAll: 'accounts:check-all',
  accountsOpenLogin: 'accounts:open-login',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  collectionGet: 'collection:get',
  collectionImportText: 'collection:import-text',
  collectionImportFile: 'collection:import-file',
  collectionStart: 'collection:start',
  collectionPause: 'collection:pause',
  collectionResume: 'collection:resume',
  collectionStop: 'collection:stop',
  collectionRetry: 'collection:retry',
  collectionClear: 'collection:clear',
  collectionExport: 'collection:export',
  bloggersOpenBrowser: 'bloggers:open-browser',
  bloggersCapture: 'bloggers:capture',
  bloggersFetch: 'bloggers:fetch',
  bloggersStop: 'bloggers:stop',
  bloggersClear: 'bloggers:clear',
  bloggersExport: 'bloggers:export',
  linksGet: 'links:get',
  linksImportText: 'links:import-text',
  linksImportFile: 'links:import-file',
  linksStart: 'links:start',
  linksStop: 'links:stop',
  linksRetry: 'links:retry',
  linksClear: 'links:clear',
  linksExport: 'links:export',
  licenseGet: 'license:get',
  licenseActivate: 'license:activate',
  licenseUnbind: 'license:unbind',
  appEvent: 'app:event',
} as const;

export interface ElectronApi {
  bootstrap(): Promise<Result<BootstrapData>>;
  accounts: {
    list(): Promise<Result<AccountSummary[]>>;
    add(draft: AccountDraft): Promise<Result<AccountSummary>>;
    update(id: EntityId, draft: AccountDraft): Promise<Result<AccountSummary>>;
    remove(id: EntityId): Promise<Result<void>>;
    check(id: EntityId): Promise<Result<AccountSummary>>;
    checkAll(): Promise<Result<AccountSummary[]>>;
    openLogin(provider: 'xingtu' | 'fangzhou'): Promise<Result<void>>;
  };
  settings: {
    get(): Promise<Result<CollectionSettings>>;
    update(settings: CollectionSettings): Promise<Result<CollectionSettings>>;
  };
  collection: {
    get(): Promise<Result<{ job: CollectionJob | null; items: CollectionItem[] }>>;
    importText(text: string): Promise<Result<ImportSummary>>;
    importFile(): Promise<Result<ImportSummary | null>>;
    start(jobId: EntityId): Promise<Result<CollectionJob>>;
    pause(jobId: EntityId): Promise<Result<CollectionJob>>;
    resume(jobId: EntityId): Promise<Result<CollectionJob>>;
    stop(jobId: EntityId): Promise<Result<CollectionJob>>;
    retry(itemIds: EntityId[]): Promise<Result<CollectionJob>>;
    clear(): Promise<Result<void>>;
    export(jobId: EntityId): Promise<Result<string | null>>;
  };
  bloggers: {
    openBrowser(): Promise<Result<void>>;
    capture(): Promise<Result<BloggerFilterCapture>>;
    fetch(maxPages: number): Promise<Result<BloggerRow[]>>;
    stop(): Promise<Result<void>>;
    clear(): Promise<Result<void>>;
    export(): Promise<Result<string | null>>;
  };
  links: {
    get(): Promise<Result<LinkConversionItem[]>>;
    importText(text: string): Promise<Result<LinkConversionItem[]>>;
    importFile(): Promise<Result<LinkConversionItem[] | null>>;
    start(): Promise<Result<LinkConversionItem[]>>;
    stop(): Promise<Result<void>>;
    retry(ids: EntityId[]): Promise<Result<LinkConversionItem[]>>;
    clear(): Promise<Result<void>>;
    export(): Promise<Result<string | null>>;
  };
  license: {
    get(): Promise<Result<LicenseInfo>>;
    activate(key: string, force?: boolean): Promise<Result<LicenseInfo>>;
    unbind(): Promise<Result<void>>;
  };
  onEvent(listener: (event: AppEvent) => void): () => void;
}