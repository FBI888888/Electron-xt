import { NavLink, Outlet } from 'react-router-dom';
import {
  BadgeCheck,
  Database,
  Gauge,
  Link2,
  ListFilter,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { ErrorBanner } from '../components/ui';
import logo from '../assets/logo.png';

const navigation = [
  { to: '/', label: '工作台', icon: Gauge, end: true },
  { to: '/accounts', label: '账号管理', icon: Users },
  { to: '/collection', label: '采集任务', icon: Database },
  { to: '/links', label: '链接转换', icon: Link2 },
  { to: '/bloggers', label: '达人列表', icon: ListFilter, premium: true },
  { to: '/settings', label: '采集设置', icon: Settings },
  { to: '/about', label: '关于', icon: ScrollText },
];

export const AppShell = () => {
  const license = useAppStore((state) => state.license);
  const error = useAppStore((state) => state.error);
  const clearError = useAppStore((state) => state.clearError);
  const hasPremiumAccess = license?.level === 'VVIP' || license?.level === 'SVIP';

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand__mark"><img src={logo} alt="" /></div>
          <div>
            <strong>星图数据快照</strong>
            <span>数据快照工具</span>
          </div>
        </div>
        <nav className="sidebar__nav">
          {navigation.filter((item) => !item.premium || hasPremiumAccess).map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} {...(end ? { end: true } : {})} className={({ isActive }) => `nav-link ${isActive ? 'nav-link--active' : ''}`}>
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar__footer">
          <NavLink to="/license" className={({ isActive }) => `license-chip ${isActive ? 'license-chip--active' : ''}`}>
            <ShieldCheck size={17} />
            <div>
              <span>{license?.level ?? '未授权'}</span>
              <small>{license ? `剩余 ${license.daysRemaining} 天` : '需要激活'}</small>
            </div>
            <BadgeCheck size={16} />
          </NavLink>
          <span className="version-label">v2.0.0</span>
        </div>
      </aside>
      <main className="workspace">
        <Outlet />
        {error ? <ErrorBanner message={error} onClose={clearError} /> : null}
      </main>
    </div>
  );
};
