import { NavLink, Outlet } from 'react-router-dom';
import {
  BadgeCheck,
  Database,
  FileInput,
  KeyRound,
  Link2,
  Settings2,
  UsersRound,
} from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { Badge, ErrorBanner } from '../components/ui';

const navigation = [
  { to: '/collection', label: '采集任务', icon: Database },
  { to: '/accounts', label: '账号管理', icon: UsersRound },
  { to: '/bloggers', label: '达人列表', icon: FileInput, premium: true },
  { to: '/links', label: '链接转换', icon: Link2 },
  { to: '/settings', label: '采集设置', icon: Settings2 },
];

export const AppShell = () => {
  const license = useAppStore((state) => state.license);
  const error = useAppStore((state) => state.error);
  const clearError = useAppStore((state) => state.clearError);
  const hasPremiumAccess = license?.level === 'VVIP' || license?.level === 'SVIP';
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand__mark"><BadgeCheck size={20} /></div><div><strong>星图数据快照</strong><span>服务商采集工作台</span></div></div>
        <nav className="navigation">
          <span className="navigation__label">工作区</span>
          {navigation.filter((item) => !item.premium || hasPremiumAccess).map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} className={({ isActive }) => `nav-link ${isActive ? 'nav-link--active' : ''}`}><Icon size={18} /><span>{label}</span></NavLink>)}
        </nav>
        <div className="sidebar__footer">
          <NavLink to="/license" className={({ isActive }) => `nav-link ${isActive ? 'nav-link--active' : ''}`}><KeyRound size={18} /><span>授权信息</span></NavLink>
          <div className="member-card"><span>当前版本</span><strong>{license?.level ?? 'UNKNOWN'}</strong><small>{license?.daysRemaining ?? 0} 天有效期</small></div>
        </div>
      </aside>
      <div className="workspace">
        <div className="topbar"><span className="topbar__hint">数据保存在本机，账号凭据已加密</span><Badge tone={license?.isOffline ? 'warning' : license?.isActivated ? 'success' : 'danger'}>{license?.isOffline ? '离线授权' : license?.isActivated ? '授权正常' : '未激活'}</Badge></div>
        {error ? <ErrorBanner message={error} onClose={clearError} /> : null}
        <main className="page"><Outlet /></main>
      </div>
    </div>
  );
};