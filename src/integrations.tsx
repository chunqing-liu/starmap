import { useEffect, useRef, useState } from 'react';
import { pluginStorage } from './host';
import { TeamSyncSettings } from './team-sync-ui';
import type { PipelineLocalState } from './models/schema';

const preferenceKey = 'pipeline:assist-instruction';
const defaultInstruction = '请分析当前任务，给出下一步行动、风险和验收建议。';
export function PipelineConnections({ context, onStateLoaded }: { context: string; onStateLoaded(state: PipelineLocalState): void }) {
  const [open, setOpen] = useState(false);
  const [being, setBeing] = useState(''), [busy, setBusy] = useState(false), [result, setResult] = useState('');
  const [instruction, setInstruction] = useState(pluginStorage.getItem(preferenceKey) || defaultInstruction);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    void window.grove.being.context().then(value => { if (alive.current) setBeing(value.connected ? `${value.name} · ${value.sceneLabel}` : '尚未连接 Being'); }, () => { if (alive.current) setBeing('Being 暂不可用'); });
    const stop = window.grove.being.onDelta(delta => { if (alive.current) setResult(previous => previous + delta.text); });
    return () => { alive.current = false; stop(); };
  }, []);
  async function run(operation: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setResult('');
    try { await operation(); } catch (error) { if (alive.current) setResult(error instanceof Error ? error.message : String(error)); }
    finally { if (alive.current) setBusy(false); }
  }
  const message = `${instruction.trim() || defaultInstruction}\n\n${context}`.slice(0, 16000);
  return <div className="pipeline-sdk">
    <button type="button" className="pipeline-toolbar-button" aria-expanded={open} onClick={() => setOpen(!open)}>协作</button>
    {open && <section className="pipeline-sdk-panel" aria-label="Being 协作">
      <strong>{being}</strong><p>当前星轨和选中节点会作为协作上下文。</p>
      <div className="pipeline-sdk-actions">
        <button disabled={busy} onClick={() => void run(async () => { const value = await window.grove.being.compose(message); setResult(value.inserted ? '已放入对话草稿，可打开对话查看并发送。' : '未插入：对话已有草稿或尚未就绪。'); })}>放入对话草稿</button>
        <button disabled={busy} onClick={() => void run(async () => { const value = await window.grove.being.chat(message); setResult(value.status === 'accepted' ? '消息已排队，请在主对话查看进展。' : value.text || 'Being 已完成回复。'); })}>请 Being 协助</button>
        <button disabled={busy} onClick={() => void run(() => window.grove.ui.navigate('chat'))}>打开对话</button>
      </div>
      {busy && <p role="status">正在等待…</p>}
      {result && <pre className="pipeline-sdk-result" aria-label="协作结果">{result}</pre>}
      <div className="pipeline-sdk-preferences">
        <label>协作提示<textarea value={instruction} maxLength={2000} onChange={event => setInstruction(event.target.value)} /></label>
        <p>发送时会附上当前星轨和选中节点。客户端会展示完整消息，确认后发送。</p>
        <button type="button" onClick={() => { const value = instruction.trim() || defaultInstruction; pluginStorage.setItem(preferenceKey, value); setInstruction(value); }}>保存设置</button>
      </div>
      <TeamSyncSettings onStateLoaded={onStateLoaded} />
    </section>}
  </div>;
}
