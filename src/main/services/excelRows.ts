import type { BloggerRow, CollectionItem, CollectionSnapshot, LinkConversionItem } from '../../shared/domain';

export interface SnapshotExportData {
  rows: Record<string, unknown>[];
  header: string[];
}

const toWan = (value: unknown): string => {
  if (value === undefined || value === null || value === '') return '';
  const text = String(value).trim();
  if (!text || /w$/i.test(text)) return text;
  const number = Number.parseFloat(text);
  if (Number.isNaN(number)) return text;
  return number >= 10_000 ? `${(number / 10_000).toFixed(1)}w` : String(number);
};

const fallbackSnapshots = (
  snapshots: CollectionSnapshot[],
  items: CollectionItem[],
): CollectionSnapshot[] => {
  const covered = new Set(snapshots.map((snapshot) => snapshot.itemId));
  return items
    .filter((item) => ['ok', 'partial'].includes(item.status) && !covered.has(item.id))
    .map((item) => ({
      itemId: item.id,
      authorId: item.authorId ?? '',
      data: {
        达人昵称: item.nickname,
        粉丝数: item.fans,
      },
      errors: item.errors,
      createdAt: item.collectedAt ?? new Date().toISOString(),
    }));
};

export const buildSnapshotExportData = (
  snapshots: CollectionSnapshot[],
  items: CollectionItem[],
  isSvip: boolean,
): SnapshotExportData => {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const effectiveSnapshots = [...snapshots, ...fallbackSnapshots(snapshots, items)];
  const prefixFields = [
    '星图ID',
    '星图主页',
    '达人昵称',
    ...(isSvip ? ['微信号'] : []),
    '归属地',
    '性别',
    '个人介绍',
    '抖音ID',
    '抖音主页',
    'MCN机构',
    '粉丝数',
    '粉丝数-万',
    '月连接用户数',
    '月连接用户数-万',
    '月深度用户数',
    '发布视频数',
    '热门榜单',
    '达人类型',
    '内容主题',
  ];
  const skipped = new Set([...prefixFields, 'authorId', 'author_id', '微信号']);
  const sanitizedData = effectiveSnapshots.map((snapshot) => {
    const data = { ...snapshot.data };
    if (!isSvip) delete data['微信号'];
    return { snapshot, item: itemById.get(snapshot.itemId), data };
  });
  const extraKeys: string[] = [];
  for (const { data } of sanitizedData) {
    for (const key of Object.keys(data)) {
      if (!skipped.has(key) && !extraKeys.includes(key)) extraKeys.push(key);
    }
  }
  const rows = sanitizedData.map(({ snapshot, item, data }) => {
    const row: Record<string, unknown> = {
      星图ID: snapshot.authorId || data.authorId || data.author_id || '',
      星图主页: `https://www.xingtu.cn/ad/creator/author-homepage/douyin-video/${snapshot.authorId}`,
      达人昵称: data['达人昵称'] ?? item?.nickname ?? '',
      归属地: data['归属地'] ?? '',
      性别: data['性别'] ?? '',
      个人介绍: data['个人介绍'] ?? '',
      抖音ID: data['抖音ID'] ?? '',
      抖音主页: item?.sourceType === 'douyin' ? item.sourceUrl : (data['抖音主页'] ?? ''),
      MCN机构: data['MCN机构'] ?? '',
      粉丝数: data['粉丝数'] ?? '',
      '粉丝数-万': toWan(data['粉丝数']),
      月连接用户数: data['月连接用户数'] ?? '',
      '月连接用户数-万': toWan(data['月连接用户数']),
      月深度用户数: data['月深度用户数'] ?? '',
      发布视频数: data['发布视频数'] ?? '',
      热门榜单: data['热门榜单'] ?? '',
      达人类型: data['达人类型'] ?? '',
      内容主题: data['内容主题'] ?? '',
    };
    if (isSvip) row['微信号'] = data['微信号'] ?? '';
    for (const key of extraKeys) row[key] = data[key] ?? '';
    row['采集时间'] = item?.collectedAt ?? snapshot.createdAt;
    return row;
  });
  return { rows, header: [...prefixFields, ...extraKeys, '采集时间'] };
};

export const buildBloggerExportRows = (rows: BloggerRow[]): Record<string, unknown>[] =>
  rows.map((row, index) => ({
    序号: index + 1,
    星图主页: row.xingtuUrl,
    达人昵称: row.nickname,
    归属地: row.location,
    性别: row.gender,
    个人标签: row.personalTags,
    内容标签: row.contentTags,
    粉丝数: row.fans,
    '粉丝数-万': toWan(row.fans),
    '30天涨粉': row.fansGrowth30d,
    播放中位数: row.playMedian,
    '播放中位-万': toWan(row.playMedian),
    互动中位数: row.interactionMedian,
    '互动中位-万': toWan(row.interactionMedian),
    完播率: row.completionRate,
    互动率: row.interactionRate,
    预估播放量: row.expectedPlay,
    '预估播放-万': toWan(row.expectedPlay),
    电商等级: row.ecomLevel,
    星图指数: row.starIndex,
    传播指数: row.spreadIndex,
    种草指数: row.shoppingIndex,
    '1-20秒报价': row.prices[0],
    '20-60秒报价': row.prices[1],
    '60秒+报价': row.prices[2],
  }));

const linkStatusLabel = (status: LinkConversionItem['status']): string => {
  if (status === 'ok' || status === 'no-xingtu') return '成功';
  if (status === 'failed' || status === 'cancelled') return '失败';
  return '待转换';
};

export const buildLinkExportRows = (items: LinkConversionItem[]): Record<string, unknown>[] =>
  items.map((item, index) => ({
    序号: index + 1,
    状态: linkStatusLabel(item.status),
    原始链接: item.sourceText,
    抖音主页: item.douyinUrl,
    星图昵称: item.nickname,
    星图主页: item.xingtuUrl,
    错误信息: item.error,
  }));