import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildLinkExportRows, buildSnapshotExportData } from '../src/main/services/excelRows';
import type { CollectionItem, CollectionSnapshot, LinkConversionItem } from '../src/shared/domain';

const item: CollectionItem = {
  id: 'item-1',
  jobId: 'job-1',
  sourceUrl: 'https://v.douyin.com/source-link/',
  sourceType: 'douyin',
  authorId: 'author-1',
  nickname: '备用昵称',
  fans: '12345',
  status: 'ok',
  accountRemark: '账号A',
  collectedAt: '2026-07-19T12:00:00.000Z',
  errors: [],
};

const snapshot: CollectionSnapshot = {
  itemId: item.id,
  authorId: 'author-1',
  data: {
    authorId: 'internal-author-id',
    author_id: 'internal-author-id-2',
    达人昵称: '测试达人',
    微信号: 'private-wechat',
    归属地: '杭州',
    性别: '女',
    个人介绍: '简介',
    抖音ID: 'douyin-id',
    MCN机构: '测试机构',
    粉丝数: 12345,
    月连接用户数: 25000,
    达人类型: '剧情',
    内容主题: '生活',
    自定义字段: '扩展值',
  },
  errors: [{ step: 'optional', message: '可选字段失败', retryable: true }],
  createdAt: '2026-07-19T11:00:00.000Z',
};

const expectedBaseHeader = [
  '星图ID',
  '星图主页',
  '达人昵称',
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
  '达人类型',
  '内容主题',
  '自定义字段',
  '采集时间',
];

describe('Excel 导出契约', () => {
  it('非 SVIP 导出严格移除微信号和内部 authorId 字段，并保持旧版列顺序', () => {
    const result = buildSnapshotExportData([snapshot], [item], false);

    expect(result.header).toEqual(expectedBaseHeader);
    expect(result.rows[0]).toMatchObject({
      星图ID: 'author-1',
      星图主页: 'https://www.xingtu.cn/ad/creator/author-homepage/douyin-video/author-1',
      达人昵称: '测试达人',
      抖音主页: item.sourceUrl,
      '粉丝数-万': '1.2w',
      '月连接用户数-万': '2.5w',
      自定义字段: '扩展值',
      采集时间: item.collectedAt,
    });
    expect(result.rows[0]).not.toHaveProperty('微信号');
    expect(result.rows[0]).not.toHaveProperty('authorId');
    expect(result.rows[0]).not.toHaveProperty('author_id');
    expect(result.rows[0]).not.toHaveProperty('采集错误');
  });

  it('SVIP 在达人昵称后增加微信号列且保留敏感字段', () => {
    const result = buildSnapshotExportData([snapshot], [item], true);

    expect(result.header.slice(0, 5)).toEqual(['星图ID', '星图主页', '达人昵称', '微信号', '归属地']);
    expect(result.rows[0]?.['微信号']).toBe('private-wechat');
  });

  it('链接导出保持旧版中文状态文本', () => {
    const createItem = (status: LinkConversionItem['status']): LinkConversionItem => ({
      id: status,
      sourceText: 'source',
      extractedUrl: 'https://example.com',
      douyinUrl: '',
      xingtuUrl: '',
      nickname: '',
      status,
      error: '',
    });
    const rows = buildLinkExportRows([
      createItem('ok'),
      createItem('no-xingtu'),
      createItem('failed'),
      createItem('cancelled'),
      createItem('pending'),
      createItem('processing'),
    ]);

    expect(rows.map((row) => row['状态'])).toEqual(['成功', '成功', '失败', '失败', '待转换', '待转换']);
  });

  it('达人 IPC 在主进程使用 VVIP/SVIP 权限校验，采集导出按 SVIP 决定敏感字段', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'main', 'ipc', 'register.ts'), 'utf8');

    expect(source).toMatch(/bloggersOpenBrowser[\s\S]*?await ensurePremium\(\)/);
    expect(source).toMatch(/bloggersFetch[\s\S]*?await ensurePremium\(\)/);
    expect(source).toMatch(/bloggersExport[\s\S]*?await ensurePremium\(\)/);
    expect(source).toContain("const isSvip = services.license.get().level === 'SVIP'");
  });
});