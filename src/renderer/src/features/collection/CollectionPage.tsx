import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { FileDown, FileUp, Pause, Play, RotateCcw, Square, Trash2 } from 'lucide-react';
import type { CollectionItem, ItemStatus, JobStatus } from '../../../../shared/domain';
import { DataTable } from '../../components/DataTable';
import { Badge, Button, Modal, PageHeader } from '../../components/ui';
import { useConfirm } from '../../components/ConfirmProvider';
import { useAppStore } from '../../store/appStore';

const itemStatus = (status: ItemStatus) => {
  const map: Record<ItemStatus, { tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger'; label: string }> = {
    pending: { tone: 'neutral', label: '待采集' }, resolving: { tone: 'info', label: '解析达人' }, running: { tone: 'info', label: '采集中' }, ok: { tone: 'success', label: '成功' }, partial: { tone: 'warning', label: '部分成功' }, failed: { tone: 'danger', label: '失败' }, cancelled: { tone: 'neutral', label: '已取消' },
  };
  return <Badge tone={map[status].tone}>{map[status].label}</Badge>;
};

const jobStatusLabel: Record<JobStatus | 'idle', string> = {
  idle: '空闲',
  running: '运行中',
  paused: '已暂停',
  stopping: '停止中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已停止',
};

const jobTone = (status?: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' => {
  if (status === 'completed') return 'success';
  if (status === 'running' || status === 'stopping') return 'info';
  if (status === 'paused') return 'warning';
  if (status === 'failed' || status === 'cancelled') return 'danger';
  return 'neutral';
};

export const CollectionPage = () => {
  const job = useAppStore((state) => state.job);
  const items = useAppStore((state) => state.collectionItems);
  const setError = useAppStore((state) => state.setError);
  const confirm = useConfirm();
  const [importOpen, setImportOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const running = job?.status === 'running';
  const paused = job?.status === 'paused';
  const progress = job?.total ? job.processed / job.total * 100 : 0;

  const invoke = async <T,>(action: () => Promise<{ ok: true; value: T } | { ok: false; error: { message: string } }>) => {
    setBusy(true); const result = await action(); setBusy(false); if (!result.ok) setError(result.error.message); return result;
  };

  const columns = useMemo<Array<ColumnDef<CollectionItem>>>(() => [
    { accessorKey: 'sourceUrl', header: '采集目标', size: 360, cell: ({ row }) => <span className="truncate" title={row.original.sourceUrl}>{row.original.sourceUrl}</span> },
    { accessorKey: 'nickname', header: '达人昵称', size: 150, cell: ({ row }) => row.original.nickname || '—' },
    { accessorKey: 'authorId', header: '星图 ID', size: 150, cell: ({ row }) => row.original.authorId || '—' },
    { accessorKey: 'fans', header: '粉丝数', size: 100, cell: ({ row }) => row.original.fans || '—' },
    { accessorKey: 'status', header: '状态', size: 120, cell: ({ row }) => itemStatus(row.original.status) },
    { accessorKey: 'accountRemark', header: '使用账号', size: 130, cell: ({ row }) => row.original.accountRemark || '—' },
    { accessorKey: 'collectedAt', header: '快照时间', size: 170, cell: ({ row }) => row.original.collectedAt ? new Date(row.original.collectedAt).toLocaleString('zh-CN') : '—' },
    { id: 'error', header: '异常', size: 260, enableSorting: false, cell: ({ row }) => <span className="truncate text-danger" title={row.original.errors.map((error) => error.message).join('; ')}>{row.original.errors.map((error) => error.message).join('; ') || '—'}</span> },
  ], []);

  const importText = async () => {
    const result = await invoke(() => window.api.collection.importText(text));
    if (result.ok) { setText(''); setImportOpen(false); }
  };
  const clearCollection = async (): Promise<void> => {
    const confirmed = await confirm({
      title: '清空采集任务',
      description: '当前任务、任务条目和已保存快照将被永久删除，此操作无法撤销。',
      confirmLabel: '清空任务',
      tone: 'danger',
    });
    if (confirmed) await invoke(() => window.api.collection.clear());
  };
  const failedIds = items.filter((item) => ['failed', 'cancelled'].includes(item.status)).map((item) => item.id);

  return (
    <div className="page">
      <PageHeader title="采集任务" description="导入达人主页，创建可暂停、可恢复并保留部分结果的数据快照任务。" actions={<><Button onClick={() => setImportOpen(true)} disabled={running || paused}><FileUp size={16} />粘贴导入</Button><Button onClick={() => invoke(() => window.api.collection.importFile())} disabled={running || paused}><FileUp size={16} />文件导入</Button>{!running && !paused ? <Button variant="primary" disabled={!job || busy} onClick={() => job && invoke(() => window.api.collection.start(job.id))}><Play size={16} />开始采集</Button> : null}</>} />
      <div className="page-content collection-layout">
        <section className="task-strip">
          <div><span>任务状态</span><Badge tone={jobTone(job?.status)}>{jobStatusLabel[job?.status ?? 'idle']}</Badge></div>
          <div className="task-strip__progress"><div className="progress-track"><span style={{ width: `${progress}%` }} /></div><strong>{Math.round(progress)}%</strong></div>
          <div className="task-strip__stats">
            <span>成功 {job?.succeeded ?? 0}</span>
            <span>部分 {job?.partial ?? 0}</span>
            <span>失败 {job?.failed ?? 0}</span>
            <span>{job?.speedPerMinute ?? 0}/分钟</span>
          </div>
          <div className="task-strip__actions">
            {running ? <Button onClick={() => job && invoke(() => window.api.collection.pause(job.id))}><Pause size={16} />暂停</Button> : null}
            {paused ? <Button variant="primary" onClick={() => job && invoke(() => window.api.collection.resume(job.id))}><Play size={16} />继续</Button> : null}
            {running || paused ? <Button variant="danger" onClick={() => job && invoke(() => window.api.collection.stop(job.id))}><Square size={15} />停止</Button> : null}
          </div>
        </section>
        <DataTable data={items} columns={columns} searchPlaceholder="搜索主页、昵称或星图 ID" toolbar={<><Button disabled={failedIds.length === 0 || running || paused} onClick={() => invoke(() => window.api.collection.retry(failedIds))}><RotateCcw size={15} />重试失败项</Button><Button disabled={!job || running || paused} onClick={() => job && invoke(() => window.api.collection.export(job.id))}><FileDown size={15} />导出快照</Button><Button variant="ghost" disabled={items.length === 0 || running || paused} onClick={() => void clearCollection()}><Trash2 size={15} />清空</Button></>} emptyTitle="还没有采集目标" emptyDescription="通过 Excel、TXT 文件或粘贴文本导入星图/抖音主页。" />
      </div>
      <Modal open={importOpen} onOpenChange={setImportOpen} title="粘贴采集目标" description="支持星图主页、抖音主页与抖音短链接，自动去重并报告无效内容。" footer={<><Button onClick={() => setImportOpen(false)}>取消</Button><Button variant="primary" disabled={!text.trim() || busy} onClick={importText}>创建任务</Button></>}><label className="field"><span>主页链接</span><textarea rows={10} value={text} onChange={(event) => setText(event.target.value)} placeholder="每行一个链接，也可以直接粘贴包含链接的文本" /></label></Modal>
    </div>
  );
};
