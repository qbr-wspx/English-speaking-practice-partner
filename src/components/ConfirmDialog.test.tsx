// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';
import { useConfirmation } from '../hooks/useConfirmation';

describe('nonblocking confirmation and focus recovery', () => {
  let root: Root, container: HTMLDivElement;
  const performed = vi.fn();
  let ask: ReturnType<typeof useConfirmation>['confirm'];
  function Harness() {
    const confirmation = useConfirmation(); ask = confirmation.confirm;
    const [text, setText] = useState('');
    return <><button id="trigger" onClick={async () => {
      if (await confirmation.confirm({ title:'删除？', message:'仅测试', confirmLabel:'删除' })) performed();
    }}>打开确认</button><input value={text} onChange={e => setText(e.target.value)} /><select><option>A2</option><option>B1</option></select>
    {confirmation.request && <ConfirmDialog request={confirmation.request} onResult={confirmation.respond} />}</>;
  }
  async function click(selector: string) { await act(async () => { container.querySelector<HTMLButtonElement>(selector)!.click(); }); }
  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); performed.mockReset();
    container=document.createElement('div'); document.body.append(container); root=createRoot(container);
    await act(async () => root.render(<Harness />));
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
  it('restores trigger focus after repeated cancel and lets other inputs take focus', async () => {
    for (let i=0;i<20;i++) {
      container.querySelector<HTMLButtonElement>('#trigger')!.focus(); await click('#trigger');
      expect(document.activeElement?.textContent).toBe('取消');
      await click('[role="alertdialog"] button');
      expect(document.activeElement?.id).toBe('trigger');
      expect(container.querySelector('[role="alertdialog"]')).toBeNull();
      for (const control of container.querySelectorAll<HTMLElement>('input,select')) { control.focus(); expect(document.activeElement).toBe(control); }
    }
    expect(performed).not.toHaveBeenCalled();
  });
  it('Escape cancels, while approving executes once despite rapid repeated clicks', async () => {
    await click('#trigger');
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
    expect(performed).not.toHaveBeenCalled();
    await click('#trigger'); await click('#trigger');
    await click('[role="alertdialog"] button:last-child');
    expect(performed).toHaveBeenCalledTimes(1);
  });
  it('traps Tab only while visible and releases the key handler on close', async () => {
    await click('#trigger');
    const cancel=container.querySelector<HTMLButtonElement>('[role="alertdialog"] button')!;
    const approve=container.querySelector<HTMLButtonElement>('[role="alertdialog"] button:last-child')!;
    approve.focus(); const tab=new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}); document.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true); expect(document.activeElement).toBe(cancel);
    await click('[role="alertdialog"] button');
    const next=new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}); document.dispatchEvent(next);
    expect(next.defaultPrevented).toBe(false);
  });
  it('resolves an outstanding decision as cancelled when unmounted', async () => {
    let decision!: Promise<boolean>;
    await act(async () => { decision=ask({title:'删除？',message:'仅测试',confirmLabel:'删除'}); });
    await act(async () => root.render(null));
    expect(await decision).toBe(false); expect(performed).not.toHaveBeenCalled();
  });
});
