import type { NodeStatus, PipelineLocalState } from '../models/schema';
import { demandNodes, getPipelineFlow } from '../models/templates';
import type { OfficeIdentity } from './identities';
import type { OfficePresence } from '../../../shared/office';
import type { ActorPresentation } from './bridge';

export interface OfficeTask {
  key: string;
  demandId: string;
  nodeId: string;
  demandTitle: string;
  title: string;
  owner: string;
  status: NodeStatus;
  reason: string;
  actorId?: string;
  needsMe: boolean;
  source?: string;
  demo: boolean;
}
export interface OfficePerson extends ActorPresentation { identity: OfficeIdentity; tasks: OfficeTask[]; marker: string }
export interface OfficeProjection { people: OfficePerson[]; unbound: OfficeTask[]; reviews: OfficeTask[] }

export const STATUS_MARKERS: Record<NodeStatus, string> = {
  pending: '待命', ready: '可接手', running: '工作中 · 来自流程状态', waiting_human: '待审核', blocked: '阻塞', failed: '异常', done: '已结束', skipped: '已跳过',
};
const priority: NodeStatus[] = ['failed', 'blocked', 'waiting_human', 'running', 'ready', 'pending', 'done', 'skipped'];

export function projectOffice(state: PipelineLocalState, identities: OfficeIdentity[], presence: OfficePresence[] = []): OfficeProjection {
  const tasks = state.demands.flatMap(demand => demandNodes(getPipelineFlow(demand.workflowId), demand).map(node => {
    const assignees = node.assigned_user ? identities.filter(identity => identity.assignedUsers?.includes(node.assigned_user!)) : [];
    const matches = node.execution === '人' ? [] : assignees.length ? assignees : node.owner.trim() ? identities.filter(identity => identity.owners.includes(node.owner.trim())) : [];
    return { demo: Boolean(demand.demo) && node.stateSource !== 'being', key: demand.id + ':' + node.id, demandId: demand.id, nodeId: node.id, demandTitle: demand.title, title: node.title, owner: node.owner, source: node.stateSource === 'being' ? node.stateReport?.beingId : undefined, status: node.status, reason: node.stateReason || (node.status === 'blocked' ? '阻塞原因未上报' : node.status === 'waiting_human' ? '审核原因未上报' : node.status === 'skipped' ? '跳过原因未上报' : ''), actorId: matches.length === 1 ? matches[0].id : undefined, needsMe: node.status === 'waiting_human' && Boolean(node.kind === 'gate' || node.requires_human_review) && node.assigned_user === state.board.currentUserId } satisfies OfficeTask;
  }));
  return {
    people: identities.map(identity => {
      const assigned = tasks.filter(task => task.actorId === identity.id);
      const primary = priority.map(status => assigned.find(task => task.status === status)).find(Boolean);
      const live = presence.find(entry => entry.identity.id === identity.id && (!entry.identity.demo || entry.lastSeen > 0));
      const stale = live && (live.expired || live.disconnected || live.status === 'offline');
      const marker = live ? (stale ? '过期/离线 · 最后更新 ' + new Date(live.lastSeen).toLocaleTimeString() : live.status === 'working' ? '工作中 · 来自 Being 实况' : live.status === 'thinking' ? '思考中 · 来自 Being 实况' : '待命 · 来自 Being 实况') : primary ? STATUS_MARKERS[primary.status].replace('来自流程状态', primary.source ? '来自 Being 上报' : '来自流程状态') : '待命';
      const status = live ? (stale ? 'idle' : live.status === 'offline' ? 'idle' : live.status) : primary?.status === 'running' ? 'working' : 'idle';
      const completed = !stale && assigned.some(task => task.status === 'done') && assigned.every(task => task.status === 'done' || task.status === 'skipped');
      return { id: identity.id, identity, tasks: assigned, status, screen: stale ? 'off' : status !== 'idle' ? status : completed ? 'done' : 'off', marker, title: marker + ' · ' + assigned.length + '项' + (primary?.reason ? ' · ' + primary.reason : '') };
    }),
    unbound: tasks.filter(task => !task.actorId),
    reviews: tasks.filter(task => task.needsMe),
  };
}
