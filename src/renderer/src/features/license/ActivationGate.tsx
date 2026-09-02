import { useState } from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { Button } from '../../components/ui';
import { useConfirm } from '../../components/ConfirmProvider';
import { useAppStore } from '../../store/appStore';

export const ActivationGate = () => {
  const license = useAppStore((state) => state.license);
  const setError = useAppStore((state) => state.setError);
  const confirm = useConfirm();
  const [key, setKey] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (license?.isActivated) return null;

  const activate = async (force = false) => {
    setSubmitting(true);
    const normalizedKey = key.trim();
    const result = await window.api.license.activate(normalizedKey, force);
    setSubmitting(false);
    if (result.ok) return;
    if (!force && result.error.code === 'ALREADY_ACTIVATED') {
      const confirmed = await confirm({
        title: '强制绑定当前设备',
        description: '该授权码已绑定其他设备。继续后将解绑原设备并绑定到当前设备。',
        confirmLabel: '继续绑定',
        tone: 'warning',
      });
      if (confirmed) await activate(true);
      return;
    }
    setError(result.error.message);
  };

  return (
    <div className="activation-gate">
      <section className="activation-card">
        <div className="activation-card__icon"><ShieldCheck size={28} /></div>
        <span className="eyebrow">软件授权</span>
        <h1>激活星图数据快照</h1>
        <p>输入管理员提供的授权码。激活后可使用账号管理、数据采集、达人列表与链接转换。</p>
        <label className="field"><span>授权码</span><div className="input-with-icon"><KeyRound size={17} /><input value={key} onChange={(event) => setKey(event.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX" autoFocus /></div></label>
        <Button variant="primary" disabled={!key.trim() || submitting} onClick={() => void activate()}>{submitting ? '正在验证…' : '验证并进入工作台'}</Button>
        <div className="activation-card__meta"><span>机器码</span><code>{license?.machineCode || '正在获取'}</code></div>
      </section>
    </div>
  );
};