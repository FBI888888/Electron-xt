import { describe, expect, it } from 'vitest';
import { extractLinks, parseSource, parseSourceText } from '../src/shared/parsers';

describe('source parsers', () => {
  it('识别星图主页并提取 authorId', () => {
    expect(parseSource('https://www.xingtu.cn/ad/creator/author-homepage/douyin-video/123456')).toEqual({
      url: 'https://www.xingtu.cn/ad/creator/author-homepage/douyin-video/123456',
      sourceType: 'xingtu',
      authorId: '123456',
    });
  });

  it('从混合文本提取、去重并报告无效项', () => {
    const result = parseSourceText(`
      https://www.douyin.com/user/abc
      https://www.douyin.com/user/abc
      https://v.douyin.com/test/
      invalid-value
    `);
    expect(result.valid).toHaveLength(2);
    expect(result.duplicates).toBe(1);
    expect(result.invalid).toEqual([]);
  });

  it('提取分享文案中的链接', () => {
    expect(extractLinks('复制 https://v.douyin.com/a1/ 打开，备用 https://www.douyin.com/user/u2')).toEqual([
      'https://v.douyin.com/a1/',
      'https://www.douyin.com/user/u2',
    ]);
  });
});