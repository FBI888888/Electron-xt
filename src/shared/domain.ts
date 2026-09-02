export type EntityId = string;

export type Result<T, E extends AppError = AppError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export interface AppError {
  code: string;
  message: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

export type MembershipLevel = 'VIP' | 'VVIP' | 'SVIP' | 'UNKNOWN';
export type AccountStatus = 'unchecked' | 'healthy' | 'invalid' | 'limited';

export interface AccountQuota {
  used: number;
  limit: number;
  reserved: number;
  date: string;
}

export interface AccountSummary {
  id: EntityId;
  remark: string;
  nickname: string;
  grade: number;
  status: AccountStatus;
  quota: AccountQuota;
  lastCheckedAt: string | null;
  cookiePreview: string;
}

export interface AccountDraft {
  remark: string;
  cookies: string;
}

export type CollectField =
  | 'spread-info'
  | 'effect-estimate'
  | 'seed-value'
  | 'convert-ability'
  | 'ecom-stat'
  | 'latest-videos'
  | 'content-type'
  | 'hot-words'
  | 'playlet-theme'
  | 'contract-info'
  | 'link-user'
  | 'audience-profile';

export interface CollectionSettings {
  filename: string;
  directory: string;
  fields: CollectField[];
  accountMode: 'round-robin' | 'single';
  singleAccountId: EntityId | null;
  concurrency: number;
}

export type JobStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'stopping'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ItemStatus =
  | 'pending'
  | 'resolving'
  | 'running'
  | 'ok'
  | 'partial'
  | 'failed'
  | 'cancelled';

export interface CollectionStepError {
  step: string;
  message: string;
  retryable: boolean;
}

export interface CollectionItem {
  id: EntityId;
  jobId: EntityId;
  sourceUrl: string;
  sourceType: 'xingtu' | 'douyin';
  authorId: string | null;
  nickname: string;
  fans: string;
  status: ItemStatus;
  accountRemark: string;
  collectedAt: string | null;
  errors: CollectionStepError[];
}

export interface CollectionJob {
  id: EntityId;
  name: string;
  status: JobStatus;
  total: number;
  processed: number;
  succeeded: number;
  partial: number;
  failed: number;
  startedAt: string | null;
  finishedAt: string | null;
  speedPerMinute: number;
}

export interface CollectionSnapshot {
  itemId: EntityId;
  authorId: string;
  data: Record<string, unknown>;
  errors: CollectionStepError[];
  createdAt: string;
}

export interface ImportSummary {
  job: CollectionJob;
  imported: number;
  duplicates: number;
  invalid: number;
}

export interface BloggerFilterCapture {
  ready: boolean;
  capturedAt: string | null;
  description: string;
}

export interface BloggerRow {
  id: string;
  avatarUrl: string;
  xingtuUrl: string;
  nickname: string;
  location: string;
  gender: string;
  personalTags: string;
  contentTags: string;
  fans: number;
  fansGrowth30d: string;
  playMedian: number;
  interactionMedian: number;
  completionRate: string;
  interactionRate: string;
  expectedPlay: number;
  ecomLevel: string;
  starIndex: string;
  spreadIndex: string;
  shoppingIndex: string;
  prices: [string, string, string];
}

export type LinkStatus = 'pending' | 'processing' | 'ok' | 'no-xingtu' | 'failed' | 'cancelled';

export interface LinkConversionItem {
  id: EntityId;
  sourceText: string;
  extractedUrl: string;
  douyinUrl: string;
  xingtuUrl: string;
  nickname: string;
  status: LinkStatus;
  error: string;
}

export interface LicenseInfo {
  machineCode: string;
  licenseKey: string;
  level: MembershipLevel;
  expiresAt: string | null;
  daysRemaining: number;
  isActivated: boolean;
  isOffline: boolean;
}

export interface BootstrapData {
  accounts: AccountSummary[];
  settings: CollectionSettings;
  activeJob: CollectionJob | null;
  collectionItems: CollectionItem[];
  bloggers: BloggerRow[];
  links: LinkConversionItem[];
  license: LicenseInfo;
}

export type AppEvent =
  | { type: 'accounts.changed'; accounts: AccountSummary[] }
  | { type: 'collection.changed'; job: CollectionJob | null; items: CollectionItem[] }
  | { type: 'bloggers.changed'; rows: BloggerRow[]; status: string }
  | { type: 'links.changed'; items: LinkConversionItem[]; status: string }
  | { type: 'license.changed'; license: LicenseInfo };