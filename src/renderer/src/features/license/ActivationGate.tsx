import { useState } from 'react';
import { KeyRound, LoaderCircle } from 'lucide-react';
import { Button } from '../../components/ui';
import { useConfirm } from '../../components/ConfirmProvider';
import { useAppStore } from '../../store/appStore';
import logo from '../../assets/logo.png';

export const ActivationGate = () => {
  const license = useAppStore((state) => state.license);
  const applyEvent = useAppStore((state) => state.applyEvent);
  const confirm = useConfirm();
  const [key, setKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setLocalError] = useState('');

  const activate = async (force = false) => {
    const normalizedKey = key.trim();
    if (!normalizedKey || (submitting && !force)) return;
    setSubmitting(true);
    setLocalError('');
    try {
      const result = await window.api.license.activate(normalizedKey, force);
      if (result.ok) {
        applyEvent({ type: 'license.changed', license: result.value });
        return;
      }
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
      setLocalError(result.error.message);
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : '激活失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="activation-page">
      <section className="activation-panel">
        <div className="activation-panel__brand">
          <div className="brand__mark brand__mark--large"><img src={logo} alt="" /></div>
          <div>
            <span>星图数据快照</span>
            <small>服务商数据采集与快照管理</small>
          </div>
        </div>
        <div className="activation-panel__content">
          <span className="eyebrow">设备授权</span>
          <h1>激活后开始使用</h1>
          <p>软件会在线校验授权状态。采集数据、账号信息与导出文件均保存在本机。</p>
          <label className="field">
            <span>授权码</span>
            <div className="input-with-icon">
              <KeyRound size={17} />
              <input
                value={key}
                onChange={(event) => setKey(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && void activate()}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                autoFocus
              />
            </div>
          </label>
          {error ? <div className="inline-alert inline-alert--warning" role="alert">{error}</div> : null}
          <Button variant="primary" disabled={!key.trim() || submitting} onClick={() => void activate()}>
            {submitting ? <LoaderCircle className="spin" size={16} /> : null}
            {submitting ? '正在验证…' : '验证并激活'}
          </Button>
        </div>
        <footer>
          机器码 {license?.machineCode || '正在获取'} · 如需购买或更换授权，请联系软件服务方。
        </footer>
      </section>
    </main>
  );
};
