import { useEffect, useState } from 'react';
import type { PluginTaskSnapshot, PluginTaskStatus } from '@beings/grove-plugin-sdk';
import { pluginStorage } from './host';
import type { NodeStatus } from './models/schema';

function useSnapshot<T>(read: () => Promise<T>, subscribe: (changed: () => void) => Promise<() => void>) {
  const [snapshot, setSnapshot] = useState<T>(), [error, setError] = useState('');
  useEffect(() => {
    let active = true, revision = 0, stop: (() => void) | undefined;
    const refresh = async () => {
      const request = ++revision;
      try { const value = await read(); if (active && request === revision) { setSnapshot(value); setError(''); } }
      catch (e) { if (active && request === revision) { setSnapshot(undefined); setError(e instanceof Error ? e.message : String(e)); } }
    };
    void subscribe(() => void refresh()).then(dispose => { if (active) { stop = dispose; void refresh(); } else dispose(); }, e => { if (active) setError(String(e)); });
    return () => { active = false; stop?.(); };
  }, [read, subscribe]);
  return { snapshot, error };
}
const readTasks = () => window.grove.being.tasks.list();
const subscribeTasks = (changed: () => void) => window.grove.being.tasks.onChange(changed);
export const taskLabels: Record<PluginTaskStatus, string> = { queued: '排队中', running: '执行中', done: '已完成', failed: '失败', cancelled: '已取消', interrupted: '已中断', budget_exhausted: '预算耗尽', timeout: '超时' };
const taskNodeStatus: Record<PluginTaskStatus, NodeStatus> = { queued: 'ready', running: 'running', done: 'done', failed: 'failed', cancelled: 'blocked', interrupted: 'blocked', budget_exhausted: 'blocked', timeout: 'failed' };

interface Binding { id: string; scopeId: string; sceneId: string }
const bindingsKey = 'pipeline:task-bindings';
function bindings(): Record<string, Binding> {
  try { const value = JSON.parse(pluginStorage.getItem(bindingsKey) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; }
}
export function NodeTaskPanel({ nodeKey, onApply }: { nodeKey: string; onApply: (status: NodeStatus) => void }) {
  const { snapshot, error } = useSnapshot<PluginTaskSnapshot>(readTasks, subscribeTasks);
  const [binding, setBinding] = useState<Binding | undefined>(() => bindings()[nodeKey]);
  const scoped = binding && snapshot && binding.scopeId === snapshot.scopeId && binding.sceneId === snapshot.sceneId;
  const task = scoped ? snapshot.tasks.find(task => task.id === binding.id) : undefined;
  function bind(id: string) {
    if (!snapshot) return;
    const next = id ? { id, scopeId: snapshot.scopeId, sceneId: snapshot.sceneId } : undefined;
    const values = bindings(); if (next) values[nodeKey] = next; else delete values[nodeKey];
    pluginStorage.setItem(bindingsKey, JSON.stringify(values)); setBinding(next);
  }
  return <section className="pipeline-node-task" aria-label="节点关联任务"><h4>关联 Being 任务</h4>
    {error && <p role="alert">{error}</p>}
    {snapshot && <label>当前场景任务<select aria-label="当前场景任务" value={task?.id || ''} onChange={event => bind(event.target.value)}>
      <option value="">选择任务…</option>{snapshot.tasks.map(task => <option key={task.id} value={task.id}>{task.id.slice(-16)} · {taskLabels[task.status]}</option>)}
    </select></label>}
    {binding && <>
      <p>{task ? <>实时状态：<strong data-task-status={task.status}>{taskLabels[task.status]}</strong></> : '关联任务不在当前场景任务记录中，暂不推断节点状态。'}</p>
      {task && <button type="button" onClick={() => onApply(taskNodeStatus[task.status])}>应用任务状态到节点</button>}
      <button type="button" disabled={!snapshot} onClick={() => bind('')}>解除任务关联</button>
    </>}
    <p className="pipeline-task-help">任务状态实时更新。应用到节点时仍需满足流程闸口和验收规则。</p>
  </section>;
}
