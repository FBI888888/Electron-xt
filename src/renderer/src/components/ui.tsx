import * as Dialog from '@radix-ui/react-dialog';
import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from 'react';
import { CheckCircle2, X, XCircle } from 'lucide-react';
import logo from '../assets/logo.png';

export const Button = ({ className = '', variant = 'secondary', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
}) => <button className={`button button--${variant} ${className}`} {...props} />;

export const Badge = ({ tone, children }: PropsWithChildren<{ tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral' }>) => (
  <span className={`status-badge status-badge--${tone}`}>{children}</span>
);

export const ProgressBar = ({ value }: { value: number }) => (
  <div className="progress-track" aria-label={`进度 ${Math.round(value)}%`}>
    <span style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
  </div>
);

export const StatCard = ({ label, value, hint, tone = 'default' }: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'danger';
}) => (
  <article className={`metric ${tone === 'default' ? '' : `stat-card--${tone}`}`}>
    <span>{label}</span>
    <strong>{value}</strong>
    {hint ? <div className="metric__footer"><span>{hint}</span></div> : null}
  </article>
);

export const PageHeader = ({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) => (
  <header className="page-header">
    <div><h1>{title}</h1><p>{description}</p></div>
    {actions ? <div className="page-header__actions">{actions}</div> : null}
  </header>
);

export const EmptyState = ({ title, description, action }: { title: string; description: string; action?: ReactNode }) => (
  <div className="empty-state">
    <div className="empty-state__mark" />
    <h3>{title}</h3>
    <p>{description}</p>
    {action}
  </div>
);

export const LoadingScreen = () => (
  <div className="boot-screen">
    <div className="boot-screen__mark"><img src={logo} alt="" /></div>
    <p>正在初始化本地数据与授权状态…</p>
  </div>
);

export const ErrorBanner = ({ message, onClose }: { message: string; onClose: () => void }) => (
  <div className="toast-viewport">
    <div className="toast toast--error error-banner" role="alert">
      <XCircle size={17} />
      <span>{message}</span>
      <button onClick={onClose} aria-label="关闭"><X size={16} /></button>
    </div>
  </div>
);

export const SuccessMark = ({ children }: PropsWithChildren) => (
  <span className="success-mark"><CheckCircle2 size={15} />{children}</span>
);

export const Modal = ({ open, onOpenChange, title, description, children, footer, closable = true }: PropsWithChildren<{
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  description?: string;
  footer?: ReactNode;
  closable?: boolean;
}>) => (
  <Dialog.Root open={open} onOpenChange={(next) => { if (!next && !closable) return; onOpenChange(next); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay" />
      <Dialog.Content className="dialog-content" {...(closable ? {} : { onPointerDownOutside: (event) => event.preventDefault(), onEscapeKeyDown: (event) => event.preventDefault() })}>
        <div className="dialog-header">
          <div><Dialog.Title>{title}</Dialog.Title>{description ? <Dialog.Description>{description}</Dialog.Description> : null}</div>
          {closable ? <Dialog.Close className="icon-button" aria-label="关闭"><X size={18} /></Dialog.Close> : null}
        </div>
        <div className="dialog-body">{children}</div>
        {footer ? <div className="dialog-footer">{footer}</div> : null}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
);
