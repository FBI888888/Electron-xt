import { useEffect, useState } from 'react';
import { Folder, LockKeyhole, Save } from 'lucide-react';
import type { CollectField, CollectionSettings } from '../../../../shared/domain';
import { Button, PageHeader, SuccessMark } from '../../components/ui';
import { useAppStore } from '../../store/appStore';

const fieldGroups: Array<{ title: string; description: string; fields: Array<[CollectField, string]> }> = [
  { title: '商业能力', description: '报价、传播、种草与转化效果', fields: [['spread-info', '传播价值'], ['effect-estimate', '效果预估'], ['seed-value', '种草价值'], ['convert-ability', '星图短视频转化'], ['ecom-stat', '全部带货数据']] },
  { title: '创作能力', description: '内容表现、类型与评论反馈', fields: [['latest-videos', '最新视频表现'], ['content-type', '内容类型分析'], ['hot-words', '热词分析'], ['playlet-theme', '定制短剧题材']] },
  { title: '履约与画像', description: '合作履约、连接用户和受众分布', fields: [['contract-info', '履约能力'], ['link-user', '连接用户分布'], ['audience-profile', '用户画像']] },
];

export const SettingsPage = () => {
  const settings = useAppStore((state) => state.settings);
  const accounts = useAppStore((state) => state.accounts);
  const setSettings = useAppStore((state) => state.setSettings);
  const setError = useAppStore((state) => state.setError);
  const [draft, setDraft] = useState<CollectionSettings | null>(settings);
  const [saved, setSaved] = useState(false);
  useEffect(() => setDraft(settings), [settings]);
  if (!draft) return null;

  const toggleField = (field: CollectField) => setDraft((current) => current ? ({ ...current, fields: current.fields.includes(field) ? current.fields.filter((item) => item !== field) : [...current.fields, field] }) : current);
  const save = async () => {
    const result = await window.api.settings.update(draft);
    if (!result.ok) { setError(result.error.message); return; }
    setSettings(result.value); setSaved(true); setTimeout(() => setSaved(false), 2200);
  };

  return <>
    <PageHeader title="采集设置" description="控制快照字段、账号调度和任务并发。设置保存在当前用户目录。" actions={<Button variant="primary" onClick={save}><Save size={16} />保存设置</Button>} />
    {saved ? <div className="inline-notice"><SuccessMark>设置已保存，将在下一次任务启动时生效</SuccessMark></div> : null}
    <div className="settings-layout">
      <section className="settings-card"><div className="settings-card__header"><div><h2>基础配置</h2><p>导出文件名、账号选择和并发数</p></div></div><div className="settings-card__body form-grid"><label className="field"><span>默认文件名</span><input value={draft.filename} onChange={(event) => setDraft({ ...draft, filename: event.target.value })} /></label><label className="field"><span>默认保存目录</span><div className="input-with-icon"><Folder size={16} /><input value={draft.directory} onChange={(event) => setDraft({ ...draft, directory: event.target.value })} placeholder="留空时导出时选择" /></div></label><label className="field"><span>账号调度</span><select value={draft.accountMode} onChange={(event) => setDraft({ ...draft, accountMode: event.target.value as CollectionSettings['accountMode'] })}><option value="round-robin">多账号轮询</option><option value="single">固定单账号</option></select></label><label className="field"><span>固定账号</span><select disabled={draft.accountMode !== 'single'} value={draft.singleAccountId ?? ''} onChange={(event) => setDraft({ ...draft, singleAccountId: event.target.value || null })}><option value="">请选择账号</option>{accounts.filter((account) => account.status === 'healthy').map((account) => <option value={account.id} key={account.id}>{account.remark} · {account.nickname}</option>)}</select></label><label className="field"><span>任务并发数</span><input type="number" min={1} max={6} value={draft.concurrency} onChange={(event) => setDraft({ ...draft, concurrency: Math.min(6, Math.max(1, Number(event.target.value))) })} /><small>建议保持 2；过高并发可能触发平台限制。</small></label></div></section>
      <section className="settings-card settings-card--wide"><div className="settings-card__header"><div><h2>采集字段</h2><p>基础信息、商业卡片、月连接用户、月涨粉率和报价始终采集</p></div><span className="locked-label"><LockKeyhole size={14} />5 项必采</span></div><div className="settings-card__body field-groups">{fieldGroups.map((group) => <div className="field-group" key={group.title}><div><h3>{group.title}</h3><p>{group.description}</p></div><div className="field-options">{group.fields.map(([value, label]) => <label className={`field-option ${draft.fields.includes(value) ? 'field-option--selected' : ''}`} key={value}><input type="checkbox" checked={draft.fields.includes(value)} onChange={() => toggleField(value)} /><span>{label}</span></label>)}</div></div>)}</div></section>
    </div>
  </>;
};