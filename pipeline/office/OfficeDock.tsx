import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import type { PipelineLocalState } from '../models/schema';
import { DEMO_IDENTITIES, type OfficeIdentity } from './identities';
import type { OfficeNodeReport, OfficeSnapshot } from '../../../shared/office';
import { OfficePresenceClient } from './presence';
import { applyBeingNodeReport } from './reports';
import { projectOffice, STATUS_MARKERS, type OfficeTask } from './projection';
import { OfficeHost } from './host';
import { officeRole } from './roles';
import './office.css';

export function OfficeDock({ state, selectedIds, focusMode, active, fullView = false, onExitView, onNavigate, onReports }: { state: PipelineLocalState; selectedIds: string[]; focusMode: boolean; active: boolean; fullView?: boolean; onExitView?: () => void; onNavigate: (demandId: string, nodeId: string) => void; onReports?: (reports: OfficeNodeReport[], identities: OfficeIdentity[]) => void }) {
  const [open, setOpen] = useState(() => localStorage.getItem('starmap-office-open') !== 'false');
  const [height, setHeight] = useState(260);
  const [standalone, setStandalone] = useState(false);
  const [available, setAvailable] = useState(0);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [actorId, setActorId] = useState(DEMO_IDENTITIES[0].id);
  const [selectedTaskKey, setSelectedTaskKey] = useState('');
  const [reduced, setReduced] = useState(() => localStorage.getItem('starmap-office-reduced') === 'true');
  const [systemReduced, setSystemReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [documentVisible, setDocumentVisible] = useState(!document.hidden);
  const [error, setError] = useState('');
  const [identities, setIdentities] = useState<OfficeIdentity[]>(DEMO_IDENTITIES);
  const [presence, setPresence] = useState<OfficeSnapshot>({ sequence: 0, entries: [], reports: [] });
  const [reportErrors, setReportErrors] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<{ eventId: string; status: string; code?: string }[]>([]);
  const feedbackSignature = useRef('');
  const reportsSignature = useRef('');
  const stateRef = useRef(state);
  stateRef.current = state;
  const reportsCallback = useRef(onReports);
  reportsCallback.current = onReports;
  const root = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const host = useRef<OfficeHost | null>(null);
  const resize = useRef<{ start: number; height: number } | null>(null);
  const projection = useMemo(() => projectOffice(state, identities, presence.entries), [state, identities, presence.entries]);
  const presentations = JSON.stringify(projection.people.map(({ id, status, title, screen }) => ({ id, status, title, screen })));
  const highlights = JSON.stringify(projection.people.filter(person => person.tasks.some(task => task.demandId === state.selectedDemandId && selectedIds.includes(task.nodeId))).map(person => person.id));
  const largeRoster = identities.length > 8;
  const detached = standalone || (!fullView && largeRoster);
  const expanded = (fullView || open) && !focusMode;
  const compact = (!fullView && available < 580) || availableWidth < (fullView ? 600 : 700);
  const sceneVisible = expanded && active && documentVisible && (detached || !compact);
  const dockHeight = Math.min(height, Math.max(220, available - 360));
  const person = projection.people.find(person => person.id === actorId);
  const selectedTask = [...projection.people.flatMap(item => item.tasks), ...projection.unbound].find(task => task.key === selectedTaskKey);

  useEffect(() => {
    const instance = new OfficeHost(DEMO_IDENTITIES, setActorId, next => { setIdentities(next); setActorId(current => next.some(identity => identity.id === current) ? current : next[0]?.id || ''); }, next => {
      const signature = JSON.stringify(next);
      if (signature !== feedbackSignature.current) { feedbackSignature.current = signature; setFeedback(next); }
    });
    host.current = instance;
    const client = new OfficePresenceClient(snapshot => {
      setPresence(snapshot);
      instance.roster(snapshot.entries.map(entry => entry.identity));
      instance.presence(snapshot.entries);
      const reportSignature = JSON.stringify([snapshot.reports, snapshot.entries.map(entry => entry.identity)]);
      if (reportSignature !== reportsSignature.current) {
        reportsSignature.current = reportSignature;
        const roster = snapshot.entries.map(entry => entry.identity);
        const rejected = snapshot.reports.map(report => ({ report, result: applyBeingNodeReport(stateRef.current, report, roster) })).filter(item => item.result.code);
        setReportErrors(rejected.map(item => item.report.eventId + ': ' + item.result.code));
        reportsCallback.current?.(snapshot.reports, roster);
      }
    }, input => instance.receive(input), setError);
    void client.connect();
    void instance.scene.mount(canvas.current!).catch(reason => setError(String(reason)));
    const observer = new ResizeObserver(entries => { setAvailable(entries[0].contentRect.height); setAvailableWidth(entries[0].contentRect.width); });
    if (root.current?.parentElement) observer.observe(root.current.parentElement);
    const visibility = () => setDocumentVisible(!document.hidden);
    document.addEventListener('visibilitychange', visibility);
    return () => { client.dispose(); observer.disconnect(); document.removeEventListener('visibilitychange', visibility); instance.dispose(); host.current = null; };
  }, []);
  useEffect(() => { host.current?.project(JSON.parse(presentations)); }, [presentations]);
  useEffect(() => { if (fullView) setStandalone(false); }, [fullView]);
  useEffect(() => { host.current?.scene.select(JSON.parse(highlights)); }, [highlights]);
  useEffect(() => { host.current?.setActive(sceneVisible); }, [sceneVisible]);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setSystemReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => { host.current?.setReduced(reduced || systemReduced); localStorage.setItem('starmap-office-reduced', String(reduced)); }, [reduced, systemReduced]);
  useEffect(() => { localStorage.setItem('starmap-office-open', String(open)); }, [open]);
  useEffect(() => { if (!expanded || !active) setStandalone(false); }, [expanded, active]);
  useEffect(() => { if (detached && expanded && active) canvas.current?.parentElement?.focus(); }, [detached, expanded, active]);

  const beginResize = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    resize.current = { start: event.clientY, height };
  };
  const navigate = (task: OfficeTask) => { setSelectedTaskKey(task.key); setOpen(true); if (task.actorId) setActorId(task.actorId); if (compact && !fullView) setStandalone(true); };
  const reviewDemo = projection.reviews.length > 0 && projection.reviews.every(task => task.demo);
  const mixedReviewDemo = !reviewDemo && projection.reviews.some(task => task.demo);
  const taskButton = (task: OfficeTask) => <button type="button" key={task.key} data-office-task={task.key} aria-pressed={selectedTaskKey === task.key} onClick={() => navigate(task)}><span>{task.demo && "演示 · "}{task.demandTitle} · {task.title}</span><small>{STATUS_MARKERS[task.status]}{task.reason && ' · ' + task.reason}{task.source && ' · 由 ' + task.source + ' 上报'}</small></button>;

  return <section ref={root} className="office-dock" aria-label="协作舱" tabIndex={-1} data-expanded={expanded} data-full-view={fullView} data-detached={expanded && active && detached} data-large-roster={largeRoster} onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Delete' || ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase()))) event.preventDefault();
    if (detached && event.key === 'Escape') { event.preventDefault(); setStandalone(false); if (largeRoster) setOpen(false); root.current?.focus(); }
    if (detached && event.key === 'Tab') {
      const controls = Array.from(root.current!.querySelectorAll<HTMLElement>('.office-body button:not(:disabled), .office-body input, .office-body summary')).filter(element => element.getClientRects().length);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === canvas.current?.parentElement)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }} onKeyUp={event => event.stopPropagation()} onWheel={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} onPointerMove={event => event.stopPropagation()} style={{ height: expanded && !compact && !detached && !fullView ? dockHeight : undefined }}>
    {expanded && !fullView && available >= 580 && <div className="office-resize" role="separator" aria-label="调整协作舱高度" aria-orientation="horizontal" aria-valuemin={220} aria-valuemax={360} aria-valuenow={dockHeight} tabIndex={0} onPointerDown={beginResize} onPointerMove={event => { if (resize.current) setHeight(Math.min(360, Math.max(220, resize.current.height + resize.current.start - event.clientY))); }} onPointerUp={() => { resize.current = null; }} onPointerCancel={() => { resize.current = null; }} onKeyDown={event => { event.stopPropagation(); if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); setHeight(value => Math.min(360, Math.max(220, value + (event.key === 'ArrowUp' ? 10 : -10)))); } }} />}
    <header className="office-heading"><button type="button" aria-expanded={expanded} onClick={() => fullView ? onExitView?.() : setOpen(value => !value)} disabled={focusMode}>{fullView ? '返回画布' : (expanded ? '▾ 协作舱' : '▸ 协作舱')}</button><span>{identities.length} 位伙伴 · {identities.filter(identity => identity.demo).length} 位演示</span><button type="button" className="office-review" disabled={!projection.reviews.length} onClick={() => { const task = projection.reviews[0]; if (task) navigate(task); }}><span aria-hidden="true">◉</span> {reviewDemo ? "演示 · 待你审核" : "待你审核"} {projection.reviews.length} 项{mixedReviewDemo ? "（含演示）" : ""}</button></header>
    <div className="office-body" hidden={!expanded || (compact && !detached)} role={detached ? 'dialog' : undefined} aria-modal={detached || undefined} aria-label={detached ? '独立协作舱' : undefined} tabIndex={detached ? -1 : undefined}>
      {detached && <button type="button" className="office-detached-close" onClick={() => { setStandalone(false); if (largeRoster) setOpen(false); root.current?.focus(); }}>关闭独立协作舱</button>}
      <div className="office-scene" ref={canvas} />
      <aside className="office-people" aria-label="人员与关联任务"><div className="office-person-tabs">{projection.people.map(item => <button type="button" key={item.id} data-office-actor={item.id} data-status={item.status} data-stale={presence.entries.some(entry => entry.identity.id === item.id && (entry.expired || entry.disconnected || entry.status === 'offline'))} data-highlighted={JSON.parse(highlights).includes(item.id)} aria-pressed={item.id === actorId} onClick={() => setActorId(item.id)}>{item.identity.name}<small>{item.identity.demo ? '演示 · ' : ''}{officeRole(item.identity).label} · {item.marker}</small></button>)}</div>
        <div className="office-task-list"><strong>{person?.identity.name} · {person?.identity.demo ? '演示' : 'Being'} · {person?.tasks.length || 0} 项</strong>{person?.tasks.map(taskButton)}<details><summary>未绑定任务 {projection.unbound.length} 项</summary>{projection.unbound.map(taskButton)}</details><details><summary>人类伙伴 · {reviewDemo ? "演示 · 待你审核" : "待你审核"} {projection.reviews.length} 项</summary>{projection.reviews.map(taskButton)}</details></div>
        <div className="office-activity-feedback" aria-live="polite">{reportErrors.slice(-2).map(item => <div key={item}>节点上报未应用 · {item}</div>)}{feedback.slice(-2).map(item => <div key={item.eventId + item.status}>{item.eventId} · {item.status}{item.code && ' · ' + item.code}</div>)}</div>
        {selectedTask && <section className="office-task-detail" aria-label="办公室任务详情"><strong>{selectedTask.title}</strong><p>{selectedTask.demandTitle} · {STATUS_MARKERS[selectedTask.status]}</p>{selectedTask.reason && <p>{selectedTask.reason}</p>}<button type="button" onClick={() => { onNavigate(selectedTask.demandId, selectedTask.nodeId); if (detached || fullView) { setStandalone(false); setOpen(false); onExitView?.(); } }}>在画布中打开</button></section>}
        <label className="office-reduced"><input type="checkbox" checked={reduced || systemReduced} disabled={systemReduced} onChange={event => setReduced(event.target.checked)} />减少动态效果</label>{error && <p role="status">场景暂不可用，任务列表可继续使用：{error}</p>}
      </aside>
    </div>
    {expanded && compact && !detached && <div className="office-compact"><button type="button" onClick={() => setStandalone(true)}>打开独立协作舱</button><span>窗口有点小，已切换为摘要模式。</span></div>}
  </section>;
}
