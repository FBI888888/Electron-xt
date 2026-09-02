import { create } from 'zustand';
import type {
  AccountSummary,
  AppEvent,
  BloggerRow,
  BootstrapData,
  CollectionItem,
  CollectionJob,
  CollectionSettings,
  LicenseInfo,
  LinkConversionItem,
} from '../../../shared/domain';

interface AppState {
  initialized: boolean;
  loading: boolean;
  error: string;
  accounts: AccountSummary[];
  settings: CollectionSettings | null;
  job: CollectionJob | null;
  collectionItems: CollectionItem[];
  bloggers: BloggerRow[];
  bloggerStatus: string;
  links: LinkConversionItem[];
  linkStatus: string;
  license: LicenseInfo | null;
  initialize(): Promise<() => void>;
  applyBootstrap(data: BootstrapData): void;
  applyEvent(event: AppEvent): void;
  setError(message: string): void;
  clearError(): void;
  setSettings(settings: CollectionSettings): void;
}

export const useAppStore = create<AppState>((set, get) => ({
  initialized: false,
  loading: true,
  error: '',
  accounts: [],
  settings: null,
  job: null,
  collectionItems: [],
  bloggers: [],
  bloggerStatus: '',
  links: [],
  linkStatus: '',
  license: null,

  async initialize() {
    if (get().initialized) return () => undefined;
    const result = await window.api.bootstrap();
    if (!result.ok) {
      set({ loading: false, error: result.error.message });
      return () => undefined;
    }
    get().applyBootstrap(result.value);
    const unsubscribe = window.api.onEvent((event) => get().applyEvent(event));
    set({ initialized: true, loading: false });
    return unsubscribe;
  },

  applyBootstrap(data) {
    set({
      accounts: data.accounts,
      settings: data.settings,
      job: data.activeJob,
      collectionItems: data.collectionItems,
      bloggers: data.bloggers,
      links: data.links,
      license: data.license,
    });
  },

  applyEvent(event) {
    switch (event.type) {
      case 'accounts.changed':
        set({ accounts: event.accounts });
        break;
      case 'collection.changed':
        set({ job: event.job, collectionItems: event.items });
        break;
      case 'bloggers.changed':
        set({ bloggers: event.rows, bloggerStatus: event.status });
        break;
      case 'links.changed':
        set({ links: event.items, linkStatus: event.status });
        break;
      case 'license.changed':
        set({ license: event.license });
        break;
    }
  },

  setError: (message) => set({ error: message }),
  clearError: () => set({ error: '' }),
  setSettings: (settings) => set({ settings }),
}));