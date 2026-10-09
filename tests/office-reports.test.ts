import { describe, expect, it } from 'vitest';
import { applyBeingNodeReport } from '../desktop/renderer/pipeline/office/reports';
import { projectOffice } from '../desktop/renderer/pipeline/office/projection';
import { createDemand, getPipelineFlow } from '../desktop/renderer/pipeline/models/templates';
import { DEMO_IDENTITIES } from '../desktop/renderer/pipeline/office/identities';
import type { PipelineLocalState } from '../desktop/renderer/pipeline/models/schema';
import type { OfficeNodeReport } from '../desktop/shared/office';
const fixture = () => ({ board: { currentUserId: 'human', revision: 1 }, demands: [createDemand('验收任务', '产品交付组', getPipelineFlow())], selectedDemandId: '' }) as unknown as PipelineLocalState;
const report = (state: PipelineLocalState, status: OfficeNodeReport['status']): OfficeNodeReport => ({ type: 'node', beingId: 'demo-product', demandId: state.demands[0].id, nodeId: 'N01', eventId: 'report-1', runId: 'run-1', runOrder: 1, eventOrder: 1, status, reason: '需要人类确认授权摘要', reportedAt: 1000 });
describe('being node reports keep business truth and review safety', () => {
  it('persists formal reasons/source and is idempotent across snapshots and local edits', () => {
    const state = fixture(), input = report(state, 'blocked');
    const result = applyBeingNodeReport(state, input, DEMO_IDENTITIES);
    expect(result.code).toBeUndefined();
    expect(result.state.demands[0].nodeStates.N01).toBe('blocked');
    expect(projectOffice(result.state, DEMO_IDENTITIES).people[0].tasks.find(task => task.nodeId === 'N01')).toMatchObject({ reason: input.reason, source: 'demo-product' });
    expect(applyBeingNodeReport(result.state, input, DEMO_IDENTITIES).state).toBe(result.state);
    const local = structuredClone(result.state); local.demands[0].nodeStates.N01 = 'ready'; local.demands[0].nodeOverrides.N01.stateSource = 'local';
    expect(applyBeingNodeReport(local, input, DEMO_IDENTITIES).state).toBe(local);
    expect(projectOffice(local, DEMO_IDENTITIES).people[0].tasks.find(task => task.nodeId === 'N01')?.source).toBeUndefined();
    const older = { ...input, eventId: 'old', runOrder: 0, runId: 'old' };
    expect(applyBeingNodeReport(result.state, older, DEMO_IDENTITIES).code).toBe('STALE_RUN');
  });
  it('rejects unbound authors, gate bypass, and absent evidence without mutating state', () => {
    const state = fixture();
    expect(applyBeingNodeReport(state, { ...report(state, 'blocked'), beingId: 'other' }, DEMO_IDENTITIES).code).toBe('NOT_ASSIGNED');
    state.demands[0].nodeOverrides.H1 = { owner: '产品 Agent', execution: 'being' };
    expect(applyBeingNodeReport(state, { ...report(state, 'done'), nodeId: 'H1' }, DEMO_IDENTITIES).code).toBe('HUMAN_REVIEW_REQUIRED');
    expect(applyBeingNodeReport(state, { ...report(state, 'running'), nodeId: 'N02', beingId: 'demo-product' }, DEMO_IDENTITIES).code).toBe('GATE_BLOCKED');
    state.demands[0].nodeStates.H1 = 'done'; state.demands[0].nodeOverrides.H1 = { approver: 'human', evidence: '已审核' };
    state.demands[0].nodeOverrides.N01 = { description: '', evidence: '' };
    expect(applyBeingNodeReport(state, report(state, 'done'), DEMO_IDENTITIES).code).toBe('EVIDENCE_REQUIRED');
    state.demands[0].nodeOverrides.N01.description = '原流程完成证据';
    expect(applyBeingNodeReport(state, report(state, 'done'), DEMO_IDENTITIES).state.demands[0].nodeStates.N01).toBe('done');
  });
});
