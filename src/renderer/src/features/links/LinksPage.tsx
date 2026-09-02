import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Download, FileUp, Play, RotateCcw, Square, Trash2 } from 'lucide-react';
import type { LinkConversionItem, LinkStatus } from '../../../../shared/domain';
import { DataTable } from '../../components/DataTable';
import { Badge, Button, Modal, PageHeader, StatCard } from '../../components/ui';
import { useConfirm } from '../../components/ConfirmProvider';
import { useAppStore } from '../../store/appStore';

const statusBadge = (status: LinkStatus) => {
  const map: Record<LinkStatus, { tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger'; label: string }> = {
    pending: { tone: 'neutral', label: '待转换' }, processing: { tone: 'info', label: '转换中' }, ok: { tone: 'success', label: '成功' }, 'no-xingtu': { tone: 'warning', label: '未入驻' }, failed: { tone: 'danger', label: '失败' }, cancelled: { tone: 'neutral', label: '已取消' },
  };
  return <Badge tone={map[status].tone}>{map[status].label}</Badge>;
};

export const LinksPage = () => {
  const items = useAppStore((state) => state.links);
  const status = useAppStore((state) => state.linkStatus);
  const setError = useAppStore((state) => state.setError);
  const confirm = useConfirm();
  const [modalOpen, setModalOpen] = useState(false);
  const [text, setText] = useState('');
  const [running, setRunning] = useState(false);
  const invoke = async <T,>(action: () => Promise<{ ok: true; value: T } | { ok: false; error: { message: string } }>) => { const result = await action(); if (!result.ok) setError(result.error.message); return result; };
  const start = async () => { setRunning(true); await invoke(() => window.api.links.start()); setRunning(false); };
  const columns = useMemo<Array<ColumnDef<LinkConversionItem>>>(() => [
    { accessorKey: 'status', header: '状态', size: 110, cell: ({ row }) => statusBadge(row.original.status) },
    { accessorKey: 'extractedUrl', header: '原始链接', size: 300, cell: ({ row }) => <span className="truncate" title={row.original.extractedUrl}>{row.original.extractedUrl}</span> },
    { accessorKey: 'douyinUrl', header: '抖音主页', size: 310, cell: ({ row }) => <span className="truncate">{row.original.douyinUrl || '—'}</span> },
    { accessorKey: 'nickname', header: '星图昵称', size: 150, cell: ({ row }) => row.original.nickname || '—' },
    { accessorKey: 'xingtuUrl', header: '星图主页', size: 330, cell: ({ row }) => row.original.xingtuUrl ? <a href={row.original.xingtuUrl} target="_blank" rel="noreferrer" className="text-link">{row.original.xingtuUrl}</a> : '—' },
    { accessorKey: 'error', header: '失败原因', size: 220, cell: ({ row }) => <span className="truncate text-danger" title={row.original.error}>{row.original.error || '—'}</span> },
  ], []);
  const failedIds = items.filter((item) => ['failed', 'cancelled'].includes(item.status)).map((item) => item.id);
  const importText = async () => { const result = await invoke(() => window.api.links.importText(text)); if (result.ok) { setText(''); setModalOpen(false); } };
  const clearLinks = async (): Promise<void> => {
    const confirmed = await confirm({
      title: '清空链接列表',
      description: `将永久删除当前 ${items.length} 条链接及其转换结果，此操作无法撤销。`,
      confirmLabel: '清空列表',
      tone: 'danger',
    });
    if (confirmed) await invoke(() => window.api.links.clear());
  };

  return (
    <div className="page">
      <PageHeader title="链接转换" description="将抖音短链接或主页批量解析为标准抖音主页与星图主页。" actions={<><Button onClick={() => setModalOpen(true)} disabled={running}><FileUp size={16} />粘贴导入</Button><Button onClick={() => invoke(() => window.api.links.importFile())} disabled={running}><FileUp size={16} />文件导入</Button>{running ? <Button variant="danger" onClick={() => invoke(() => window.api.links.stop())}><Square size={15} />停止</Button> : <Button variant="primary" onClick={start} disabled={!items.length}><Play size={16} />开始转换</Button>}</>} />
      <div className="page-content collection-layout">
        <div className="metric-grid">
          <StatCard label="总链接" value={items.length} hint={status || '等待导入'} />
          <StatCard label="成功" value={items.filter((item) => item.status === 'ok').length} tone="success" />
          <StatCard label="未入驻星图" value={items.filter((item) => item.status === 'no-xingtu').length} tone="warning" />
          <StatCard label="失败" value={items.filter((item) => item.status === 'failed').length} tone="danger" />
        </div>
        <DataTable data={items} columns={columns} searchPlaceholder="搜索原始链接、昵称或转换结果" toolbar={<><Button disabled={!failedIds.length || running} onClick={() => invoke(() => window.api.links.retry(failedIds))}><RotateCcw size={15} />重试失败项</Button><Button disabled={!items.length} onClick={() => invoke(() => window.api.links.export())}><Download size={15} />导出</Button><Button variant="ghost" disabled={!items.length || running} onClick={() => void clearLinks()}><Trash2 size={15} />清空</Button></>} emptyTitle="还没有待转换链接" emptyDescription="导入抖音主页、短链接或包含链接的文本。" />
      </div>
      <Modal open={modalOpen} onOpenChange={setModalOpen} title="粘贴待转换链接" description="系统会从文本中提取 HTTP/HTTPS 链接并自动去重。" footer={<><Button onClick={() => setModalOpen(false)}>取消</Button><Button variant="primary" disabled={!text.trim()} onClick={importText}>导入链接</Button></>}><label className="field"><span>链接文本</span><textarea rows={10} value={text} onChange={(event) => setText(event.target.value)} placeholder="每行一条，或直接粘贴分享文案" /></label></Modal>
    </div>
  );
};