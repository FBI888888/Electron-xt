import { useState } from 'react';
import { Copy, KeyRound, RefreshCw, ShieldCheck, Unlink } from 'lucide-react';
import { Button, PageHeader } from '../../components/ui';
import { useConfirm } from '../../components/ConfirmProvider';
import { useAppStore } from '../../store/appStore';

export const LicensePage = () => {
  const license = useAppStore((state) => state.license);
  const setError = useAppStore((state) => state.setError);
  const confirm = useConfirm();
  const [key, setKey] = useState('');
  const activate = async (force = false): Promise<void> => {
    const normalizedKey = key.trim();
    const result = await window.api.license.activate(normalizedKey, force);
    if (result.ok) {
      setKey('');
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
    setError(result.error.message);
  };
  const unbind = async (): Promise<void> => {
    const confirmed = await confirm({
      title: '解绑当前设备',
      description: '解绑后本机将立即退出授权状态，本地采集数据不会被删除。',
      confirmLabel: '确认解绑',
      tone: 'danger',
    });
    if (!confirmed) return;
    const result = await window.api.license.unbind();
    if (!result.ok) setError(result.error.message);
  };
  const copy = (value: string) => void navigator.clipboard.writeText(value);
  if (!license) return null;
  return (
    <div className="page">
      <PageHeader title="授权信息" description="查看当前设备授权状态。更换授权码不会影响本地采集数据。" />
      <div className="page-content page-content--scroll license-layout">
        <section className="license-hero">
          <div className="license-hero__icon"><ShieldCheck size={28} /></div>
          <div>
            <span className="eyebrow">当前会员</span>
            <h2>{license.level}</h2>
            <p>{license.isOffline ? '离线验证' : license.isActivated ? '授权正常' : '未激活'} · 有效期至 {license.expiresAt ? new Date(license.expiresAt).toLocaleString('zh-CN') : '—'}</p>
          </div>
          <strong>{license.daysRemaining}<small>剩余天数</small></strong>
        </section>
        <section className="section-panel detail-list">
          <div><span>到期时间</span><code>{license.expiresAt ? new Date(license.expiresAt).toLocaleString('zh-CN') : '—'}</code></div>
          <div>
            <span>授权码</span>
            <code>{license.licenseKey || '—'}</code>
            {license.licenseKey ? <button onClick={() => copy(license.licenseKey)} aria-label="复制授权码"><Copy size={15} /></button> : null}
          </div>
          <div>
            <span>机器码</span>
            <code>{license.machineCode}</code>
            <button onClick={() => copy(license.machineCode)} aria-label="复制机器码"><Copy size={15} /></button>
          </div>
        </section>
        <section className="section-panel">
          <h3>更换授权码</h3>
          <p>输入新的授权码并验证。更换不会删除本机采集数据。</p>
          <label className="field">
            <span>新授权码</span>
            <div className="input-with-icon">
              <KeyRound size={16} />
              <input value={key} onChange={(event) => setKey(event.target.value)} placeholder="输入新的授权码" />
            </div>
          </label>
          <div className="card-actions">
            <Button variant="primary" disabled={!key.trim()} onClick={() => void activate()}><RefreshCw size={15} />验证授权</Button>
          </div>
        </section>
        <section className="danger-zone">
          <div>
            <h3>解绑当前设备</h3>
            <p>解绑后需要重新输入授权码才能进入软件。本地采集数据不会被删除。</p>
          </div>
          <Button variant="danger" onClick={() => void unbind()}><Unlink size={16} />解绑设备</Button>
        </section>
      </div>
    </div>
  );
};
