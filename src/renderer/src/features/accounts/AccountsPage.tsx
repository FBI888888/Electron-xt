import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { LogIn, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { AccountSummary } from '../../../../shared/domain';
import { DataTable } from '../../components/DataTable';
import { Badge, Button, Modal, PageHeader, ProgressBar } from '../../components/ui';
import { useConfirm } from '../../components/ConfirmProvider';
import { useAppStore } from '../../store/appStore';

const statusBadge = (status: AccountSummary['status']) => {
  const map = {
    healthy: ['success', '正常'],
    invalid: ['danger', '失效'],
    limited: ['warning', '受限'],
    unchecked: ['neutral', '未检查'],
  } as const;
  const [tone, label] = map[status];
  return <Badge tone={tone}>{label}</Badge>;
};

export const AccountsPage = () => {
  const accounts = useAppStore((state) => state.accounts);
  const setError = useAppStore((state) => state.setError);
  const confirm = useConfirm();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [remark, setRemark] = useState('');
  const [cookies, setCookies] = useState('');
  const [busy, setBusy] = useState(false);
  const [loginDraft, setLoginDraft] = useState<{ provider: 'xingtu' | 'fangzhou'; remark: string } | null>(null);

  const invoke = async (action: () => Promise<{ ok: boolean; error?: { message: string } }>) => {
    setBusy(true);
    const result = await action();
    setBusy(false);
    if (!result.ok && result.error) setError(result.error.message);
    return result.ok;
  };

  const startWebLogin = async (): Promise<void> => {
    if (!loginDraft?.remark.trim()) {
      setError('请输入账号备注');
      return;
    }
    const { provider, remark: accountRemark } = loginDraft;
    setLoginDraft(null);
    await invoke(() => window.api.accounts.openLogin(provider, accountRemark.trim()));
  };

  const openCreate = () => {
    setEditingId(null);
    setRemark('');
    setCookies('');
    setModalOpen(true);
  };

  const openEdit = (account: AccountSummary) => {
    setEditingId(account.id);
    setRemark(account.remark);
    setCookies('');
    setModalOpen(true);
  };

  const removeAccount = async (account: AccountSummary): Promise<void> => {
    const confirmed = await confirm({
      title: '删除星图账号',
      description: `确定删除账号“${account.remark}”吗？已加密保存的账号凭据也会一并删除。`,
      confirmLabel: '删除账号',
      tone: 'danger',
    });
    if (confirmed) await invoke(() => window.api.accounts.remove(account.id));
  };

  const columns = useMemo<Array<ColumnDef<AccountSummary>>>(() => [
    { accessorKey: 'remark', header: '备注', size: 140 },
    { accessorKey: 'nickname', header: '星图昵称', size: 160, cell: ({ row }) => row.original.nickname || '—' },
    { accessorKey: 'grade', header: '等级', size: 80, cell: ({ row }) => row.original.grade ? `Lv${row.original.grade}` : '—' },
    { accessorKey: 'status', header: '状态', size: 100, cell: ({ row }) => statusBadge(row.original.status) },
    { id: 'quota', header: '今日配额', size: 220, cell: ({ row }) => {
      const { used, limit } = row.original.quota;
      return <div className="quota-cell"><div><span>{used} / {limit}</span><small>{limit ? `${Math.max(0, limit - used)} 次可用` : '无可用配额'}</small></div><ProgressBar value={limit ? used / limit * 100 : 100} /></div>;
    } },
    { accessorKey: 'lastCheckedAt', header: '最后检查', size: 170, cell: ({ row }) => row.original.lastCheckedAt ? new Date(row.original.lastCheckedAt).toLocaleString('zh-CN') : '—' },
    { accessorKey: 'cookiePreview', header: '凭据', size: 120, cell: () => <Badge tone="neutral">已加密</Badge> },
    { id: 'actions', header: '操作', enableSorting: false, size: 180, cell: ({ row }) => <div className="row-actions"><button title="编辑账号" onClick={() => openEdit(row.original)}><Pencil size={15} /></button><button title="检查账号" onClick={() => invoke(() => window.api.accounts.check(row.original.id))}><RefreshCw size={15} /></button><button className="danger" title="删除账号" onClick={() => void removeAccount(row.original)}><Trash2 size={15} /></button></div> },
  ], []);

  const saveAccount = async () => {
    const success = editingId
      ? await invoke(() => window.api.accounts.update(editingId, cookies.trim() ? { remark, cookies: cookies.trim() } : { remark }))
      : await invoke(() => window.api.accounts.add({ remark, cookies }));
    if (success) {
      setRemark('');
      setCookies('');
      setEditingId(null);
      setModalOpen(false);
    }
  };

  return (
    <div className="page">
    <PageHeader title="账号管理" description="集中维护星图账号健康状态与每日采集配额，Cookie 仅在主进程加密保存。" actions={<><Button onClick={() => setLoginDraft({ provider: 'fangzhou', remark: '' })} disabled={busy}><LogIn size={16} />方舟登录</Button><Button onClick={() => setLoginDraft({ provider: 'xingtu', remark: '' })} disabled={busy}><LogIn size={16} />星图登录</Button><Button onClick={() => invoke(() => window.api.accounts.checkAll())} disabled={busy}><RefreshCw size={16} />检查全部</Button><Button variant="primary" onClick={openCreate}><Plus size={16} />手动添加</Button></>} />
    <div className="page-content">
    <DataTable data={accounts} columns={columns} searchPlaceholder="搜索账号备注或昵称" emptyTitle="还没有星图账号" emptyDescription="建议通过星图登录自动获取账号，也可以手动粘贴 Cookie。" />
    </div>
    <Modal
      open={modalOpen}
      onOpenChange={setModalOpen}
      title={editingId ? '编辑星图账号' : '添加星图账号'}
      description={editingId ? '可只改备注；填写 Cookie 后会重新验证并覆盖原凭据。' : '提交后会先验证账号，并将凭据加密保存。'}
      footer={<><Button onClick={() => setModalOpen(false)}>取消</Button><Button variant="primary" disabled={busy || !remark.trim() || (!editingId && !cookies.trim())} onClick={() => void saveAccount()}>{busy ? '正在验证…' : editingId ? '保存修改' : '验证并添加'}</Button></>}
    >
      <div className="form-stack">
        <label className="field"><span>账号备注</span><input value={remark} onChange={(event) => setRemark(event.target.value)} placeholder="例如：主账号 A" /></label>
        <label className="field"><span>{editingId ? '替换 Cookie（留空表示不修改）' : 'Cookie'}</span><textarea value={cookies} onChange={(event) => setCookies(event.target.value)} placeholder={editingId ? '留空则保留原凭据' : '粘贴完整 Cookie 字符串'} rows={6} /></label>
      </div>
    </Modal>
    <Modal
      open={Boolean(loginDraft)}
      onOpenChange={(open) => { if (!open) setLoginDraft(null); }}
      title={loginDraft?.provider === 'fangzhou' ? '方舟登录' : '星图登录'}
      description="先填写备注，再打开登录窗口。关闭窗口且未登录不会创建账号。"
      footer={<><Button onClick={() => setLoginDraft(null)}>取消</Button><Button variant="primary" disabled={busy || !loginDraft?.remark.trim()} onClick={() => void startWebLogin()}>{busy ? '正在打开…' : '打开登录窗口'}</Button></>}
    >
      <label className="field">
        <span>账号备注</span>
        <input
          autoFocus
          value={loginDraft?.remark ?? ''}
          onChange={(event) => setLoginDraft((current) => current ? { ...current, remark: event.target.value } : current)}
          onKeyDown={(event) => event.key === 'Enter' && void startWebLogin()}
          placeholder="例如：主账号 A"
        />
      </label>
    </Modal>
    </div>
  );
};
