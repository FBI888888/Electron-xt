import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Download, Play, Square, Trash2, ExternalLink } from 'lucide-react';
import type { BloggerRow } from '../../../../shared/domain';
import { DataTable } from '../../components/DataTable';
import { Badge, Button, PageHeader, StatCard } from '../../components/ui';
import { useConfirm } from '../../components/ConfirmProvider';
import { useAppStore } from '../../store/appStore';

const compact = (value: number) => value >= 10_000 ? `${(value / 10_000).toFixed(1)}万` : String(value || 0);

export const BloggersPage = () => {
  const rows = useAppStore((state) => state.bloggers);
  const status = useAppStore((state) => state.bloggerStatus);
  const setError = useAppStore((state) => state.setError);
  const confirm = useConfirm();
  const [maxPages, setMaxPages] = useState(100);
  const [fetching, setFetching] = useState(false);
  const invoke = async <T,>(action: () => Promise<{ ok: true; value: T } | { ok: false; error: { message: string } }>) => { const result = await action(); if (!result.ok) setError(result.error.message); return result; };
  const fetchRows = async () => { setFetching(true); await invoke(() => window.api.bloggers.fetch(maxPages)); setFetching(false); };
  const clearBloggers = async (): Promise<void> => {
    const confirmed = await confirm({
      title: '清空达人列表',
      description: `将永久删除当前保存的 ${rows.length} 条达人记录，此操作无法撤销。`,
      confirmLabel: '清空列表',
      tone: 'danger',
    });
    if (confirmed) await invoke(() => window.api.bloggers.clear());
  };
  const columns = useMemo<Array<ColumnDef<BloggerRow>>>(() => [
    { accessorKey: 'nickname', header: '达人', size: 200, cell: ({ row }) => <div className="person-cell">{row.original.avatarUrl ? <img src={row.original.avatarUrl} alt="" /> : <span className="avatar-fallback">{row.original.nickname.slice(0, 1)}</span>}<div><strong>{row.original.nickname}</strong><span>{row.original.location || '地区未知'}</span></div></div> },
    { accessorKey: 'fans', header: '粉丝数', size: 110, cell: ({ row }) => compact(row.original.fans) },
    { accessorKey: 'fansGrowth30d', header: '30天涨粉', size: 110 },
    { accessorKey: 'playMedian', header: '播放中位数', size: 120, cell: ({ row }) => compact(row.original.playMedian) },
    { accessorKey: 'interactionRate', header: '互动率', size: 100 },
    { accessorKey: 'completionRate', header: '完播率', size: 100 },
    { accessorKey: 'starIndex', header: '星图指数', size: 100 },
    { accessorKey: 'ecomLevel', header: '电商等级', size: 100, cell: ({ row }) => <Badge tone="neutral">{row.original.ecomLevel}</Badge> },
    { accessorKey: 'contentTags', header: '内容标签', size: 260, cell: ({ row }) => <span className="truncate" title={row.original.contentTags}>{row.original.contentTags || '—'}</span> },
    { id: 'price', header: '1-20秒报价', size: 120, cell: ({ row }) => row.original.prices[0] },
    { id: 'open', header: '', size: 60, enableSorting: false, cell: ({ row }) => <a className="icon-link" href={row.original.xingtuUrl} target="_blank" rel="noreferrer" title="打开星图主页"><ExternalLink size={16} /></a> },
  ], []);
  const averageFans = rows.length ? Math.round(rows.reduce((sum, row) => sum + row.fans, 0) / rows.length) : 0;

  return <>
    <PageHeader title="达人列表" description="在星图达人广场设置筛选条件后，按原筛选条件分页获取并保存达人快照。" actions={<><Button onClick={() => invoke(() => window.api.bloggers.openBrowser())}>打开达人广场</Button><label className="compact-field"><span>最大页数</span><input type="number" min={1} max={500} value={maxPages} onChange={(event) => setMaxPages(Number(event.target.value))} /></label>{fetching ? <Button variant="danger" onClick={() => invoke(() => window.api.bloggers.stop())}><Square size={15} />停止</Button> : <Button variant="primary" onClick={fetchRows}><Play size={16} />开始获取</Button>}</>} />
    <div className="stats-grid stats-grid--compact"><StatCard label="达人总数" value={rows.length} hint={status || '等待捕获筛选条件'} /><StatCard label="平均粉丝" value={compact(averageFans)} /><StatCard label="有电商等级" value={rows.filter((row) => row.ecomLevel !== '-').length} /><StatCard label="有报价数据" value={rows.filter((row) => row.prices.some((price) => price !== '-')).length} /></div>
    <DataTable data={rows} columns={columns} pageSize={100} virtualized searchPlaceholder="搜索达人、地区或标签" toolbar={<><Button onClick={() => invoke(() => window.api.bloggers.export())} disabled={!rows.length}><Download size={15} />导出</Button><Button variant="ghost" disabled={!rows.length} onClick={() => void clearBloggers()}><Trash2 size={15} />清空</Button></>} emptyTitle="尚未获取达人列表" emptyDescription="打开达人广场，完成一次筛选并点击搜索，然后返回这里开始获取。" />
  </>;
};