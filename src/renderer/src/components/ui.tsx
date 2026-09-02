import * as Dialog from '@radix-ui/react-dialog';
import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from 'react';
import { AlertCircle, CheckCircle2, LoaderCircle, X, XCircle } from 'lucide-react';

export const Button = ({ className = '', variant = 'secondary', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
}) => <button className={`button button--${variant} ${className}`} {...props} />;

export const Badge = ({ tone, children }: PropsWithChildren<{ tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral' }>) => (
  <span className={`badge badge--${tone}`}><span className="badge__dot" />{children}</span>
);

export const ProgressBar = ({ value }: { value: number }) => (
  <div className="progress" aria-label={`进度 ${Math.round(value)}%`}>
    <div className="progress__bar" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
  </div>
);

export const StatCard = ({ label, value, hint, tone = 'default' }: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'danger';
}) => (
  <article className={`stat-card stat-card--${tone}`}>
    <span className="stat-card__label">{label}</span>
    <strong className="stat-card__value">{value}</strong>
    {hint ? <span className="stat-card__hint">{hint}</span> : null}
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
    <div className="empty-state__icon"><AlertCircle size={22} /></div>
    <strong>{title}</strong>
    <p>{description}</p>
    {action}
  </div>
);

export const LoadingScreen = () => (
  <div className="loading-screen"><LoaderCircle className="spin" size={24} /><span>正在加载工作区</span></div>
);

export const ErrorBanner = ({ message, onClose }: { message: string; onClose: () => void }) => (
  <div className="error-banner" role="alert"><XCircle size={17} /><span>{message}</span><button onClick={onClose}><X size={16} /></button></div>
);

export const SuccessMark = ({ children }: PropsWithChildren) => (
  <span className="success-mark"><CheckCircle2 size={15} />{children}</span>
);

export const Modal = ({ open, onOpenChange, title, description, children, footer }: PropsWithChildren<{
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  description?: string;
  footer?: ReactNode;
}>) => (
  <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay" />
      <Dialog.Content className="dialog-content">
        <div className="dialog-header">
          <div><Dialog.Title>{title}</Dialog.Title>{description ? <Dialog.Description>{description}</Dialog.Description> : null}</div>
          <Dialog.Close className="icon-button" aria-label="关闭"><X size={18} /></Dialog.Close>
        </div>
        <div className="dialog-body">{children}</div>
        {footer ? <div className="dialog-footer">{footer}</div> : null}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
);