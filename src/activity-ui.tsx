import { useEffect, useRef, useState } from 'react';
import type { Demand, PipelineNode, PipelineStation } from './models/schema';
import { currentNodes, formatDuration, nodeActivity, stageDuration } from './activity';
import { capturePluginStorage } from './host';
import { reminderPlan, SimulatedReminderService, verifyDirectory, type ReminderAttempt, type VerifiedDirectory } from './reminders';
import './activity.css';

function useClock() {
  const [, refresh] = useState(0);
  useEffect(() => { const timer = setInterval(() => refresh(value => value + 1), 1000); return () => clearInterval(timer); }, []);
  return Date.now();
}
const timestamp = (value: string | null) => value ? new Date(value).toLocaleString() : '未记录';

export function NodeActivityPanel({ demand, node }: { demand: Demand; node: PipelineNode }) {
  const summary = nodeActivity(demand, node, useClock());
  return <section className="activity-detail" aria-label="节点真实时间">
    <h4>节点时间 · 本机操作记录</h4>
    <dl><div><dt>最近进入</dt><dd>{timestamp(summary.enteredAt)}</dd></div><div><dt>最近退出</dt><dd>{timestamp(summary.exitedAt)}</dd></div><div><dt>累计节点耗时</dt><dd>{formatDuration(summary.durationMs)}</dd></div></dl>
    {summary.issue && <p role="alert">{summary.issue}</p>}
    <p>历史缺失不补造；旧节点未记录进入时间时，不推算耗时。等待、阻塞、失败仍属当前节点。</p>
    <details><summary>阶段进出明细（{summary.intervals.length}）</summary><ul>{summary.intervals.map((interval, index) => <li key={index}>{interval.stationId || '未归站'}：{timestamp(interval.enteredAt)} → {interval.exitedAt ? timestamp(interval.exitedAt) : isNaN(Date.parse(interval.enteredAt || '')) ? '未记录' : '进行中'}</li>)}</ul></details>
  </section>;
}

export function ActivityOverview({ demand, nodes, stations, onSelect }: { demand: Demand; nodes: PipelineNode[]; stations: PipelineStation[]; onSelect(id: string): void }) {
  const now = useClock();
  const active = currentNodes(nodes);
  const [open, setOpen] = useState(false);
  const [directory, setDirectory] = useState<VerifiedDirectory | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState<ReminderAttempt | null>(null);
  const service = useRef(new SimulatedReminderService(capturePluginStorage()));
  const plan = reminderPlan(demand, nodes, directory, now);
  const verify = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setNotice(''); setDirectory(null); setAttempt(null);
    try {
      const result = await window.grove.town.query({ kind: 'contacts' });
      if (!result.ok) throw new Error('公开通讯录读取失败，地址未核验');
      setDirectory(verifyDirectory(result.data)); setNotice('只读通讯录核验完成；仍然仅模拟发送，不代表真实可投递。');
    } catch { setNotice('通讯录读取或格式核验失败；未发送任何消息。'); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const run = async (retryFailed = false) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setNotice('');
    try { setAttempt(await service.current.run(reminderPlan(demand, nodes, directory), retryFailed)); setNotice('模拟完成：没有调用任何消息发送接口。'); }
    catch (error) { setNotice(error instanceof Error ? error.message : '模拟失败，未发送消息'); }
    finally { busyRef.current = false; setBusy(false); }
  };
  return <section className="activity-overview" aria-label="当前节点与阶段耗时">
    <div className="activity-current"><strong>当前节点 {active.length}</strong><div className="activity-node-list">{active.length ? active.map(node => <button key={node.id} title={node.title + ' · ' + node.owner} onClick={() => onSelect(node.id)}>{node.title} · {node.owner || '负责人未填'}</button>) : <span>暂无已进入节点（待就绪不计入）</span>}</div><button onClick={() => setOpen(value => !value)} aria-expanded={open}>催办当前负责 Being（仅模拟）</button></div>
    <details className="activity-stage-details"><summary>阶段耗时（并行区间不重复累加）</summary><div className="activity-stages" aria-label="阶段耗时">{stations.map(station => <span key={station.id}>{station.title}：{formatDuration(stageDuration(demand, nodes, station.id, now))}</span>)}</div></details>
    {open && <div className="reminder-panel" role="region" aria-label="模拟催办面板">
      <p><strong>仅模拟，不对外发送。</strong>负责 Being 使用节点中明确绑定的 Town ID；负责人文字不自动猜测地址。通讯录存在不等于已验证真实消息送达。</p>
      <button disabled={busy} onClick={() => void verify()}>只读核验通讯录地址</button>
      <ul>{plan.recipients.map(recipient => <li key={recipient.id}>{recipient.name} · {recipient.id} · {recipient.nodeIds.length} 个当前节点</li>)}{plan.blocked.map((message, index) => <li key={index}>{message}</li>)}</ul>
      <button disabled={busy || plan.blocked.length > 0 || !plan.recipients.length} onClick={() => void run()}>确认模拟催办</button>
      {attempt?.results.some(result => result.status === 'failed') && attempt.key === plan.key && <button disabled={busy || plan.blocked.length > 0} onClick={() => void run(true)}>仅重试模拟失败收件人</button>}
      {notice && <p role="status">{notice}</p>}
      {attempt && <ul aria-label="模拟送达结果">{attempt.key !== plan.key && <li>上一次操作结果，非当前节点催办结果。</li>}{attempt.results.map(result => <li key={result.recipientId}>{result.recipientId}：{result.status === 'simulated-delivered' ? '模拟送达（非真实消息）' : result.status === 'failed' ? '模拟失败' : '模拟结果待确认'}</li>)}</ul>}
      <p>阶段耗时按已记录区间取并集，并行不重复累加；五分钟内相同节点/负责人防重复，跨设备全局防重尚未联测。</p>
    </div>}
  </section>;
}
