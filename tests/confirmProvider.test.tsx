// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfirmProvider, useConfirm } from '../src/renderer/src/components/ConfirmProvider';

const Harness = () => {
  const confirm = useConfirm();
  const [result, setResult] = useState<boolean | null>(null);
  const open = async (): Promise<void> => {
    setResult(await confirm({
      title: '删除记录',
      description: '该操作无法撤销。',
      confirmLabel: '确认删除',
      tone: 'danger',
    }));
  };
  return (
    <>
      <button onClick={() => void open()}>打开确认</button>
      <output>{result === null ? '等待操作' : result ? '已确认' : '已取消'}</output>
    </>
  );
};

const renderHarness = () => render(<ConfirmProvider><Harness /></ConfirmProvider>);

afterEach(cleanup);

describe('ConfirmProvider', () => {
  it('确认按钮将 Promise 解析为 true，并把焦点还给触发按钮', async () => {
    renderHarness();
    const trigger = screen.getByRole('button', { name: '打开确认' });
    trigger.focus();
    fireEvent.click(trigger);

    fireEvent.click(await screen.findByRole('button', { name: '确认删除' }));

    expect(await screen.findByText('已确认')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('取消按钮将 Promise 解析为 false', async () => {
    renderHarness();
    fireEvent.click(screen.getByRole('button', { name: '打开确认' }));

    fireEvent.click(await screen.findByRole('button', { name: '取消' }));

    expect(await screen.findByText('已取消')).toBeTruthy();
  });

  it('Escape 和右上角关闭按钮都按取消处理', async () => {
    const first = renderHarness();
    fireEvent.click(screen.getByRole('button', { name: '打开确认' }));
    fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' });
    expect(await screen.findByText('已取消')).toBeTruthy();
    first.unmount();

    renderHarness();
    fireEvent.click(screen.getByRole('button', { name: '打开确认' }));
    fireEvent.click(await screen.findByRole('button', { name: '关闭' }));
    expect(await screen.findByText('已取消')).toBeTruthy();
  });
});