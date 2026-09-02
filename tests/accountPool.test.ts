import { describe, expect, it } from 'vitest';
import type { AccountSummary, CollectionSettings } from '../src/shared/domain';
import { AccountPool } from '../src/modules/accounts/accountPool';

const account = (id: string, used: number, limit = 5): AccountSummary => ({
  id,
  remark: id,
  nickname: id,
  grade: 1,
  status: 'healthy',
  quota: { used, limit, reserved: 0, date: '2026-07-19' },
  lastCheckedAt: null,
  cookiePreview: '已安全保存',
});

const settings: CollectionSettings = {
  filename: 'data.xlsx',
  directory: '',
  fields: [],
  accountMode: 'round-robin',
  singleAccountId: null,
  concurrency: 2,
};

describe('AccountPool', () => {
  it('轮询分配账号并记录消耗', () => {
    const consumed: string[] = [];
    const pool = new AccountPool([account('a', 0), account('b', 0)], settings, (id) => consumed.push(id));
    const first = pool.reserve();
    const second = pool.reserve();
    expect(first?.account.id).toBe('a');
    expect(second?.account.id).toBe('b');
    first?.release(true);
    second?.release(false);
    expect(consumed).toEqual(['a']);
  });

  it('跳过已耗尽配额的账号', () => {
    const pool = new AccountPool([account('full', 5), account('ready', 4)], settings, () => undefined);
    expect(pool.reserve()?.account.id).toBe('ready');
    expect(pool.reserve()).toBeNull();
  });

  it('固定账号模式只使用指定账号', () => {
    const pool = new AccountPool(
      [account('a', 0), account('b', 0)],
      { ...settings, accountMode: 'single', singleAccountId: 'b' },
      () => undefined,
    );
    expect(pool.reserve()?.account.id).toBe('b');
  });
});