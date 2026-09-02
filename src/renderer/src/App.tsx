import { useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './layout/AppShell';
import { AccountsPage } from './features/accounts/AccountsPage';
import { BloggersPage } from './features/bloggers/BloggersPage';
import { CollectionPage } from './features/collection/CollectionPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { LicensePage } from './features/license/LicensePage';
import { ActivationGate } from './features/license/ActivationGate';
import { LinksPage } from './features/links/LinksPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { AboutPage } from './features/about/AboutPage';
import { ConfirmProvider } from './components/ConfirmProvider';
import { Button, LoadingScreen, Modal } from './components/ui';
import { useAppStore } from './store/appStore';

export const App = () => {
  const initialize = useAppStore((state) => state.initialize);
  const loading = useAppStore((state) => state.loading);
  const license = useAppStore((state) => state.license);
  const hasPremiumAccess = license?.level === 'VVIP' || license?.level === 'SVIP';
  const [disclaimerOpen, setDisclaimerOpen] = useState(false);

  useEffect(() => {
    let unsubscribe: () => void = () => undefined;
    void initialize().then((dispose) => { unsubscribe = dispose; });
    return () => unsubscribe();
  }, [initialize]);

  useEffect(() => {
    if (!loading && license?.isActivated && sessionStorage.getItem('disclaimer-accepted') !== 'yes') {
      const timer = window.setTimeout(() => setDisclaimerOpen(true), 0);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [license, loading]);

  if (loading) return <LoadingScreen />;

  return (
    <ConfirmProvider>
      {!license?.isActivated ? (
        <ActivationGate />
      ) : (
        <HashRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<DashboardPage />} />
              <Route path="collection" element={<CollectionPage />} />
              <Route path="accounts" element={<AccountsPage />} />
              <Route path="bloggers" element={hasPremiumAccess ? <BloggersPage /> : <Navigate to="/" replace />} />
              <Route path="links" element={<LinksPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="license" element={<LicensePage />} />
              <Route path="about" element={<AboutPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
          <Modal
            open={disclaimerOpen}
            onOpenChange={() => undefined}
            closable={false}
            title="软件使用免责声明"
            description="继续使用前请阅读并确认以下条款。"
            footer={
              <>
                <Button variant="danger" onClick={() => void window.api.quit()}>拒绝并退出</Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    sessionStorage.setItem('disclaimer-accepted', 'yes');
                    setDisclaimerOpen(false);
                  }}
                >
                  接受并继续
                </Button>
              </>
            }
          >
            <div className="legal-copy">
              <p>本软件仅提供公开信息采集工具功能，仅支持采集星图平台已公开的达人主页信息，不具备获取非公开数据的能力。</p>
              <p>您承诺使用本软件时严格遵守《中华人民共和国网络安全法》《数据安全法》《个人信息保护法》等相关法律法规，以及星图、抖音等平台的用户协议与社区规范，不得用于任何违法违规用途。</p>
              <p><strong>禁止利用本软件实施以下行为：</strong>采集非公开信息、过度爬取导致平台服务器负载异常、侵害他人隐私权/知识产权/商业秘密等合法权益、用于 spam 营销、诈骗等违法活动。</p>
              <p>本软件仅为工具提供者，不对您使用软件的行为及结果承担责任。如因您违规使用软件导致的任何法律纠纷、行政处罚、第三方索赔等，均由您自行承担全部责任，与软件开发者无关。</p>
              <p><strong>您使用本软件即表示已充分阅读、理解并同意本声明全部条款，若不同意请立即停止使用。</strong></p>
            </div>
          </Modal>
        </HashRouter>
      )}
    </ConfirmProvider>
  );
};
