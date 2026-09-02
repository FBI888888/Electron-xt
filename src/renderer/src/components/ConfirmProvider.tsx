import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { Button } from './ui';

export interface ConfirmOptions {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'warning' | 'danger';
}

interface ConfirmRequest {
  options: ConfirmOptions;
  resolve(result: boolean): void;
  trigger: HTMLElement | null;
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);

const scheduleFrame = (callback: () => void): void => {
  if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(callback);
  else window.setTimeout(callback, 0);
};

export const useConfirm = (): Confirm => {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm 必须在 ConfirmProvider 内使用');
  return confirm;
};

export const ConfirmProvider = ({ children }: PropsWithChildren) => {
  const [active, setActive] = useState<ConfirmRequest | null>(null);
  const activeRef = useRef<ConfirmRequest | null>(null);
  const queueRef = useRef<ConfirmRequest[]>([]);

  const show = useCallback((request: ConfirmRequest): void => {
    activeRef.current = request;
    setActive(request);
  }, []);

  const confirm = useCallback<Confirm>((options) => new Promise((resolve) => {
    const request: ConfirmRequest = {
      options,
      resolve,
      trigger: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    };
    if (activeRef.current) queueRef.current.push(request);
    else show(request);
  }), [show]);

  const settle = useCallback((result: boolean): void => {
    const request = activeRef.current;
    if (!request) return;
    activeRef.current = null;
    setActive(null);
    request.resolve(result);
    scheduleFrame(() => request.trigger?.focus());
    const next = queueRef.current.shift();
    if (next) scheduleFrame(() => show(next));
  }, [show]);

  useEffect(() => () => {
    activeRef.current?.resolve(false);
    queueRef.current.splice(0).forEach((request) => request.resolve(false));
  }, []);

  const options = active?.options;
  const tone = options?.tone ?? 'warning';

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog.Root open={active !== null} onOpenChange={(open) => { if (!open) settle(false); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content
            className={`dialog-content confirm-dialog confirm-dialog--${tone}`}
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            <div className="dialog-header confirm-dialog__header">
              <div className="confirm-dialog__heading">
                <span className="confirm-dialog__icon"><AlertTriangle size={20} /></span>
                <div>
                  <Dialog.Title>{options?.title ?? '请确认操作'}</Dialog.Title>
                  <Dialog.Description>{options?.description ?? ''}</Dialog.Description>
                </div>
              </div>
              <button className="icon-button" aria-label="关闭" onClick={() => settle(false)}><X size={18} /></button>
            </div>
            <div className="dialog-footer">
              <Button onClick={() => settle(false)}>{options?.cancelLabel ?? '取消'}</Button>
              <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={() => settle(true)}>
                {options?.confirmLabel ?? '确认'}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </ConfirmContext.Provider>
  );
};