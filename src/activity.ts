import { NODE_STATUSES, type Demand, type NodeActivityEvent, type NodeStatus, type PipelineLocalState, type PipelineNode } from './models/schema';
import { demandNodes, getPipelineFlow } from './models/templates';

export const isCurrentStatus = (status: NodeStatus) => ['running', 'waiting_human', 'blocked', 'failed'].includes(status);
export const currentNodes = (nodes: PipelineNode[]) => nodes.filter(node => isCurrentStatus(node.status));

export function validActivityEvents(value: unknown): value is NodeActivityEvent[] {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  return value.every(event => {
    if (!event || typeof event !== 'object' || typeof event.id !== 'string' || !event.id || ids.has(event.id)) return false;
    ids.add(event.id);
    return typeof event.nodeId === 'string' && NODE_STATUSES.includes(event.from) && NODE_STATUSES.includes(event.to) &&
      typeof event.at === 'string' && Number.isFinite(Date.parse(event.at)) && (event.previousEventId === null || typeof event.previousEventId === 'string') &&
      (event.stationId === null || typeof event.stationId === 'string') && (event.previousStationId === null || typeof event.previousStationId === 'string');
  });
}

export function recordActivity(before: PipelineLocalState, next: PipelineLocalState, at = new Date().toISOString(), newId = () => crypto.randomUUID()): PipelineLocalState {
  return { ...next, demands: next.demands.map(demand => {
    const previous = before.demands.find(item => item.id === demand.id);
    if (!previous) return demand;
    const oldNodes = demandNodes(getPipelineFlow(previous.workflowId), previous);
    const events = [...(previous.activityEvents || [])];
    for (const oldNode of oldNodes) {
      if (!isCurrentStatus(oldNode.status) || demandNodes(getPipelineFlow(demand.workflowId), demand).some(node => node.id === oldNode.id)) continue;
      const prior = events.filter(event => event.nodeId === oldNode.id).at(-1);
      events.push({ id: newId(), nodeId: oldNode.id, from: oldNode.status, to: 'skipped', at, previousEventId: prior?.id || null,
        previousStationId: oldNode.stationId || null, stationId: oldNode.stationId || null });
    }
    for (const node of demandNodes(getPipelineFlow(demand.workflowId), demand)) {
      const oldNode = oldNodes.find(item => item.id === node.id);
      if (!oldNode && !isCurrentStatus(node.status)) continue;
      if (oldNode?.status === node.status && (oldNode.stationId || null) === (node.stationId || null)) continue;
      if (oldNode?.status === node.status && !isCurrentStatus(node.status)) continue;
      const prior = events.filter(event => event.nodeId === node.id).at(-1);
      events.push({ id: newId(), nodeId: node.id, from: oldNode?.status || prior?.to || 'pending', to: node.status, at,
        previousEventId: prior?.id || null, previousStationId: oldNode?.stationId || null, stationId: node.stationId || null });
    }
    return { ...demand, ...(events.length ? { activityEvents: events } : {}) };
  }) };
}

export interface ActivityInterval { enteredAt: string | null; exitedAt: string | null; stationId: string | null }
export interface ActivitySummary {
  intervals: ActivityInterval[];
  enteredAt: string | null;
  exitedAt: string | null;
  durationMs: number | null;
  issue?: string;
}

export function nodeActivity(demand: Demand, node: PipelineNode, now = Date.now()): ActivitySummary {
  const intervals: ActivityInterval[] = [];
  const invalid = (issue: string): ActivitySummary => ({ intervals: [], enteredAt: null, exitedAt: null, durationMs: null, issue });
  if (!validActivityEvents(demand.activityEvents || [])) return invalid('时间记录格式异常，需核对');
  const remaining = (demand.activityEvents || []).filter(event => event.nodeId === node.id);
  const events: NodeActivityEvent[] = [];
  let parentId: string | null = null;
  while (remaining.length) {
    const children = remaining.filter(event => event.previousEventId === parentId);
    if (children.length !== 1) return invalid('时间记录有并发分叉或缺失，需核对');
    const event = children[0]; events.push(event); remaining.splice(remaining.indexOf(event), 1); parentId = event.id;
  }
  let active: ActivityInterval | undefined;
  let previous: NodeActivityEvent | undefined;
  let enteredAt: string | null = null;
  let exitedAt: string | null = null;
  for (const event of events) {
    if (!Number.isFinite(Date.parse(event.at)) || event.previousEventId !== (previous?.id || null) ||
      (previous && (event.from !== previous.to || Date.parse(event.at) < Date.parse(previous.at)))) return invalid('时间记录有冲突或时钟倒退，需核对');
    if (!previous && isCurrentStatus(event.from)) {
      active = { enteredAt: null, exitedAt: null, stationId: event.previousStationId };
      intervals.push(active);
    }
    if (!previous && ['done', 'skipped'].includes(event.from)) intervals.push({ enteredAt: null, exitedAt: null, stationId: event.previousStationId });
    const moved = event.previousStationId !== event.stationId;
    if (!isCurrentStatus(event.from) && isCurrentStatus(event.to)) { enteredAt = event.at; exitedAt = null; }
    if ((isCurrentStatus(event.from) && !isCurrentStatus(event.to)) || (!isCurrentStatus(event.from) && ['done', 'skipped'].includes(event.to))) exitedAt = event.at;
    if (active && (!isCurrentStatus(event.to) || moved)) { active.exitedAt = event.at; active = undefined; }
    if (isCurrentStatus(event.to) && !active) {
      active = { enteredAt: event.at, exitedAt: null, stationId: event.stationId };
      intervals.push(active);
    } else if (!isCurrentStatus(event.from) && ['done', 'skipped'].includes(event.to)) {
      intervals.push({ enteredAt: null, exitedAt: event.at, stationId: event.stationId });
    }
    previous = event;
  }
  if (previous && previous.to !== node.status) return invalid('当前状态与时间记录不一致，需核对');
  if (!events.length) return { intervals, enteredAt: null, exitedAt: null, durationMs: null };
  if (previous && now < Date.parse(previous.at)) return invalid('本机时钟早于记录，需核对');
  const complete = intervals.length > 0 && intervals.every(interval => interval.enteredAt !== null);
  const durationMs = complete ? intervals.reduce((total, interval) => total + (interval.exitedAt ? Date.parse(interval.exitedAt) : now) - Date.parse(interval.enteredAt!), 0) : null;
  return { intervals, enteredAt, exitedAt, durationMs };
}

export function stageDuration(demand: Demand, nodes: PipelineNode[], stationId: string, now = Date.now()): number | null {
  if (!validActivityEvents(demand.activityEvents || [])) return null;
  const historical = (demand.activityEvents || []).filter(event => !nodes.some(node => node.id === event.nodeId));
  const removed = [...new Set(historical.map(event => event.nodeId))].map(id => {
    const latest = historical.filter(event => event.nodeId === id).at(-1)!;
    return { id, status: latest.to, stationId: latest.stationId } as PipelineNode;
  });
  const summaries = [...nodes, ...removed].map(node => ({ node, summary: nodeActivity(demand, node, now) }));
  if (summaries.some(({ node, summary }) => (summary.issue && (node.stationId === stationId || demand.activityEvents?.some(event => event.nodeId === node.id && (event.stationId === stationId || event.previousStationId === stationId)))) || (node.stationId === stationId && !summary.intervals.length && node.status !== 'pending' && node.status !== 'ready'))) return null;
  const intervals = summaries.flatMap(({ summary }) => summary.intervals.filter(interval => interval.stationId === stationId));
  if (!intervals.length || intervals.some(interval => !interval.enteredAt)) return null;
  const ranges = intervals.map(interval => [Date.parse(interval.enteredAt!), interval.exitedAt ? Date.parse(interval.exitedAt) : now]).sort((left, right) => left[0] - right[0]);
  let total = 0;
  let end = -Infinity;
  for (const [start, finish] of ranges) { total += Math.max(0, finish - Math.max(start, end)); end = Math.max(end, finish); }
  return total;
}

export function formatDuration(duration: number | null) {
  if (duration === null) return '未记录';
  const seconds = Math.floor(duration / 1000);
  if (seconds < 60) return seconds + '秒';
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? minutes + '分' : Math.floor(minutes / 60) + '小时' + minutes % 60 + '分';
}
