import { ArrowRight, CheckCircle2, CircleAlert, Clock3, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge, PageHeader } from '../../components/ui';
import { useAppStore } from '../../store/appStore';

const jobStatusLabel: Record<string, string> = {
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

export const DashboardPage = () => {
  const accounts = useAppStore((state) => state.accounts);
  const job = useAppStore((state) => state.job);
  const settings = useAppStore((state) => state.settings);
  const healthyAccounts = accounts.filter((account) => account.status === 'healthy').length;
  const progress = job?.total ? Math.round((job.processed / job.total) * 100) : 0;
  const succeeded = (job?.succeeded ?? 0) + (job?.partial ?? 0);

  return (
    <div className="page">
      <PageHeader title="工作台" description="查看账号可用性、当前任务和常用操作。" />
      <div className="page-content page-content--scroll">
        <section className="metric-grid">
          <article className="metric metric--primary">
            <span>当前任务</span>
            <strong>{!job || job.status === 'idle' ? '暂无任务' : `${job.processed} / ${job.total}`}</strong>
            <div className="metric__footer">
              <Badge tone={jobTone(job?.status)}>{jobStatusLabel[job?.status ?? 'idle']}</Badge>
              <span>{progress}%</span>
            </div>
          </article>
          <article className="metric">
            <span>可用账号</span>
            <strong>{healthyAccounts}</strong>
            <div className="metric__footer"><Users size={15} /><span>共 {accounts.length} 个账号</span></div>
          </article>
          <article className="metric">
            <span>成功快照</span>
            <strong>{succeeded}</strong>
            <div className="metric__footer"><CheckCircle2 size={15} /><span>包含部分完成</span></div>
          </article>
          <article className="metric">
            <span>失败目标</span>
            <strong>{job?.failed ?? 0}</strong>
            <div className="metric__footer"><CircleAlert size={15} /><span>可在任务页查看原因</span></div>
          </article>
        </section>

        <section className="dashboard-grid">
          <article className="section-panel">
            <div className="section-heading">
              <div><span className="eyebrow">运行状态</span><h2>采集任务</h2></div>
              <Link to="/collection" className="text-link">打开任务页 <ArrowRight size={15} /></Link>
            </div>
            {!job || job.status === 'idle' ? (
              <div className="compact-empty"><Clock3 size={20} /><span>导入达人主页后即可创建采集任务。</span></div>
            ) : (
              <>
                <div className="progress-row"><div className="progress-track"><span style={{ width: `${progress}%` }} /></div><strong>{progress}%</strong></div>
                <div className="task-summary-row">
                  <span>已处理 {job.processed}</span>
                  <span>成功 {job.succeeded}</span>
                  <span>失败 {job.failed}</span>
                  <span>{job.name || '任务执行中'}</span>
                </div>
              </>
            )}
          </article>
          <article className="section-panel">
            <div className="section-heading"><div><span className="eyebrow">建议操作</span><h2>开始前检查</h2></div></div>
            <ul className="check-list">
              <li className={healthyAccounts > 0 ? 'is-done' : ''}>至少有一个已验证账号</li>
              <li className={settings?.filename ? 'is-done' : ''}>确认导出文件名称</li>
              <li className={settings && settings.concurrency > 0 ? 'is-done' : ''}>根据账号承载能力设置并发</li>
            </ul>
          </article>
        </section>
      </div>
    </div>
  );
};
