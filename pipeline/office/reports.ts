import type { OfficeNodeReport } from '../../../shared/office';
import type { OfficeIdentity } from './identities';
import type { PipelineLocalState } from '../models/schema';
import { demandNodes, demandTransitions, getPipelineFlow } from '../models/templates';
import { deriveDemandStatus } from '../models/status';

export function applyBeingNodeReport(state: PipelineLocalState, report: OfficeNodeReport, identities: OfficeIdentity[]): { state: PipelineLocalState; code?: string } {
  const demand = state.demands.find(item => item.id === report.demandId);
  if (!demand) return { state, code: 'DEMAND_NOT_FOUND' };
  const flow = getPipelineFlow(demand.workflowId), nodes = demandNodes(flow, demand);
  const node = nodes.find(item => item.id === report.nodeId);
  if (!node) return { state, code: 'NODE_NOT_FOUND' };
  const matches = node.execution === '人' ? [] : identities.filter(identity => (node.owner.trim() && identity.owners.includes(node.owner.trim())) || (node.assigned_user && identity.assignedUsers?.includes(node.assigned_user)));
  if (matches.length !== 1 || matches[0].id !== report.beingId) return { state, code: 'NOT_ASSIGNED' };
  if ((node.kind === 'gate' || node.requires_human_review) && ['done', 'skipped'].includes(report.status)) return { state, code: 'HUMAN_REVIEW_REQUIRED' };
  const previous = node.stateReport;
  if (previous?.eventId === report.eventId) return { state };
  if (previous && previous.beingId === report.beingId && (report.runOrder < previous.runOrder || (report.runOrder === previous.runOrder && (report.runId !== previous.runId || report.eventOrder <= previous.eventOrder)))) return { state, code: 'STALE_RUN' };
  if (['ready', 'running', 'done', 'skipped'].includes(report.status)) {
    const incoming = demandTransitions(flow, demand).filter(item => item.toNode === node.id || item.toNodes?.includes(node.id));
    const sourceStations = demand.stationLinks.filter(link => link.toStationId === node.stationId).map(link => link.fromStationId);
    const blockers = nodes.filter(candidate => candidate.kind === 'gate' && (sourceStations.includes(candidate.stationId || '') || incoming.some(item => item.fromNode === candidate.id)));
    if (blockers.some(candidate => candidate.status !== 'done' || !candidate.approver?.trim() || !candidate.evidence?.trim())) return { state, code: 'GATE_BLOCKED' };
  }
  if (report.status === 'done' && !node.evidence?.trim() && !node.description?.trim()) return { state, code: 'EVIDENCE_REQUIRED' };
  let nextDemand = { ...demand, nodeStates: { ...demand.nodeStates, [node.id]: report.status }, nodeOverrides: { ...demand.nodeOverrides, [node.id]: { ...demand.nodeOverrides[node.id], stateReason: report.reason || '', stateSource: 'being' as const, stateReport: report } } };
  if (demand.workflowId === 'bug-fix' && node.id === 'B04' && demand.bug) {
    const status = report.status === 'done' ? '已关闭' : report.status === 'failed' || demand.bug.status === '已关闭' ? '重新打开' : demand.bug.status;
    if (status !== demand.bug.status) nextDemand = { ...nextDemand, bug: { ...demand.bug, status, history: [...demand.bug.history, { status, at: new Date(report.reportedAt).toISOString(), content: 'Being 上报验证结果。' }] } };
  }
  nextDemand.status = deriveDemandStatus(flow, nextDemand);
  return { state: { ...state, demands: state.demands.map(item => item.id === demand.id ? nextDemand : item) } };
}
