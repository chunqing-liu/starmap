import { useEffect, useRef, useState } from 'react';
import { pluginStorage } from './host';

const preferenceKey = 'pipeline:assist-instruction';
const defaultInstruction = '请分析当前任务，给出下一步行动、风险和验收建议。';
export function PipelineSettings() {
  const [instruction, setInstruction] = useState(pluginStorage.getItem(preferenceKey) || defaultInstruction);
  return <section className="pipeline-sdk-settings"><h2>Being 协作设置</h2>
    <label>协作提示<textarea value={instruction} maxLength={2000} onChange={e => setInstruction(e.target.value)} /></label>
    <p>发送时会附上当前星轨和选中节点。客户端会展示完整消息，确认后发送。</p>
    <button onClick={() => pluginStorage.setItem(preferenceKey, instruction.trim() || defaultInstruction)}>保存设置</button>
    </section>;
}

export function PipelineConnections({ context }: { context: string }) {
  const [open, setOpen] = useState(window.grove.command === 'being-assist');
  const [being, setBeing] = useState(''), [busy, setBusy] = useState(false), [result, setResult] = useState('');
  const [query, setQuery] = useState('');
  const [seeds, setSeeds] = useState<{ id: string; title: string }[]>([]);
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
  const message = `${pluginStorage.getItem(preferenceKey) || defaultInstruction}\n\n${context}`.slice(0, 16000);
  const search = () => void run(async () => {
    const value = await window.grove.town.query({ kind: 'seeds', q: query });
    if (!value.ok) throw new Error(value.message);
    const items = Array.isArray(value.data.seeds) ? value.data.seeds : [];
    setSeeds(items.filter((seed: any) => typeof seed?.id === 'string').slice(0, 24).map((seed: any) => ({ id: seed.id, title: String(seed.title || seed.name || seed.id) })));
    setResult(items.length ? '' : '没有找到种子。');
  });
  return <div className="pipeline-sdk">
    <button type="button" className="pipeline-toolbar-button" aria-expanded={open} onClick={() => setOpen(!open)}>Town / Being 协作</button>
    {open && <section className="pipeline-sdk-panel" aria-label="Town 与 Being 协作">
      <strong>{being}</strong><p>当前星轨和选中节点会作为协作上下文。</p>
      <div className="pipeline-sdk-actions">
        <button disabled={busy} onClick={() => void run(async () => { const value = await window.grove.being.compose(message); setResult(value.inserted ? '已放入对话草稿，可打开对话查看并发送。' : '未插入：对话已有草稿或尚未就绪。'); })}>放入对话草稿</button>
        <button disabled={busy} onClick={() => void run(async () => { const value = await window.grove.being.chat(message); setResult(value.status === 'accepted' ? '消息已排队，请在主对话查看进展。' : value.text || 'Being 已完成回复。'); })}>请 Being 协助</button>
        <button disabled={busy} onClick={() => void run(() => window.grove.ui.navigate('chat'))}>打开对话</button>
      </div>
      <div className="pipeline-sdk-search">
        <input aria-label="搜索 Town 种子" placeholder="搜索 Town 种子…" value={query} maxLength={300} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); search(); } }} />
        <button type="button" disabled={busy} onClick={search}>查找种子</button>
      </div>
      <ul>{seeds.map(seed => <li key={seed.id}><button disabled={busy} onClick={() => void run(() => window.grove.ui.navigate('seeds', seed.id))}>{seed.title}</button></li>)}</ul>
      {busy && <p role="status">正在等待…</p>}
      {result && <pre className="pipeline-sdk-result" aria-label="协作结果">{result}</pre>}
    </section>}
  </div>;
}
