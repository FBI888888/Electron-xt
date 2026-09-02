import { useState } from 'react';
import { Copy, KeyRound, RefreshCw, Unlink } from 'lucide-react';
import { Badge, Button, PageHeader } from '../../components/ui';
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
  return <>
    <PageHeader title="授权信息" description="查看当前设备授权状态。更换授权码不会影响本地采集数据。" />
    <div className="license-layout">
      <section className="license-card license-card--summary"><div><span className="eyebrow">当前授权</span><h2>{license.level}</h2><Badge tone={license.isOffline ? 'warning' : license.isActivated ? 'success' : 'danger'}>{license.isOffline ? '离线验证' : license.isActivated ? '正常' : '未激活'}</Badge></div><div className="license-days"><strong>{license.daysRemaining}</strong><span>剩余天数</span></div></section>
      <section className="license-card"><h2>授权详情</h2><dl className="details-list"><div><dt>到期时间</dt><dd>{license.expiresAt ? new Date(license.expiresAt).toLocaleString('zh-CN') : '—'}</dd></div><div><dt>授权码</dt><dd><code>{license.licenseKey || '—'}</code>{license.licenseKey ? <button onClick={() => copy(license.licenseKey)}><Copy size={15} /></button> : null}</dd></div><div><dt>机器码</dt><dd><code>{license.machineCode}</code><button onClick={() => copy(license.machineCode)}><Copy size={15} /></button></dd></div></dl></section>
      <section className="license-card"><h2>更换授权</h2><p>输入新的授权码并重新验证。若授权已绑定其他设备，服务端可能要求管理员处理。</p><label className="field"><span>新授权码</span><div className="input-with-icon"><KeyRound size={16} /><input value={key} onChange={(event) => setKey(event.target.value)} placeholder="输入新的授权码" /></div></label><div className="card-actions"><Button variant="primary" disabled={!key.trim()} onClick={() => void activate()}><RefreshCw size={15} />验证授权</Button><Button variant="danger" onClick={() => void unbind()}><Unlink size={15} />解绑设备</Button></div></section>
    </div>
  </>;
};