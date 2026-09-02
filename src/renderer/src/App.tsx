import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './layout/AppShell';
import { AccountsPage } from './features/accounts/AccountsPage';
import { BloggersPage } from './features/bloggers/BloggersPage';
import { CollectionPage } from './features/collection/CollectionPage';
import { LicensePage } from './features/license/LicensePage';
import { ActivationGate } from './features/license/ActivationGate';
import { LinksPage } from './features/links/LinksPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { ConfirmProvider } from './components/ConfirmProvider';
import { LoadingScreen } from './components/ui';
import { useAppStore } from './store/appStore';

export const App = () => {
  const initialize = useAppStore((state) => state.initialize);
  const loading = useAppStore((state) => state.loading);
  const license = useAppStore((state) => state.license);
  const hasPremiumAccess = license?.level === 'VVIP' || license?.level === 'SVIP';
  useEffect(() => {
    let unsubscribe: () => void = () => undefined;
    void initialize().then((dispose) => { unsubscribe = dispose; });
    return () => unsubscribe();
  }, [initialize]);

  if (loading) return <LoadingScreen />;
  return <ConfirmProvider><HashRouter><Routes><Route element={<AppShell />}><Route index element={<Navigate to="/collection" replace />} /><Route path="collection" element={<CollectionPage />} /><Route path="accounts" element={<AccountsPage />} /><Route path="bloggers" element={hasPremiumAccess ? <BloggersPage /> : <Navigate to="/collection" replace />} /><Route path="links" element={<LinksPage />} /><Route path="settings" element={<SettingsPage />} /><Route path="license" element={<LicensePage />} /><Route path="*" element={<Navigate to="/collection" replace />} /></Route></Routes><ActivationGate /></HashRouter></ConfirmProvider>;
};