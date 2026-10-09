import type { PipelineFlow, PipelineNode, PipelineStation, PipelineTransition } from "./schema";

const group = "Agent Team";
const station = (id: string, title: string, subtitle: string, nodeIds: string[]): PipelineStation => ({
  id, kind: "station", title, subtitle, nodeIds, locked: true,
});

const step = (id: string, stationId: string, title: string, owner: string, description: string, status: PipelineNode["status"] = "pending"): PipelineNode => ({
  id, kind: "node", stationId, title, status, owner, owner_group: group, description,
  trigger: ["事件"], execution: "being", evidenceLevel: "L2", input: "待补充", output: "待补充",
  timeout: "待补充", failureRoute: "待补充",
});

const review = (id: `H${1 | 2 | 3 | 4}`, stationId: string, title: string, owner: string, description: string): PipelineNode => ({
  id, reviewCode: id, kind: "gate", gateRole: "agent_review", stationId, title, status: "pending", owner,
  owner_group: group, description, trigger: ["人工"], execution: "being+人", evidenceLevel: "L2",
  input: "待补充", output: "审核结论与证据", timeout: "待补充", failureRoute: "待补充",
  options: ["通过", "退回"], defaultOption: "待补充", requires_human_review: true,
  assigned_user: "local-user", locked: true,
});

export const beingsDevelopmentStations: PipelineStation[] = [
  station("S01", "需求确认", "明确范围、目标与验收条件", ["N01", "H1"]),
  station("S02", "评审", "检查方案、依赖与验收语义；reviewer 按独立评审流程旁路收件", ["N02", "H2"]),
  station("S03", "开发准备", "准备执行输入与测试条件", ["N03"]),
  station("S04", "开发", "实现、审查并合并变更", ["N04", "N05", "H3"]),
  station("S05", "测试", "独立执行、修复并完成验收", ["N06", "N07", "H4"]),
  station("S06", "发布", "准备、发布并观察结果", ["N08", "N09", "N10"]),
];

export const beingsDevelopmentNodes: PipelineNode[] = [
  step("N01", "S01", "需求确认", "产品 Agent", "确认需求范围、目标和验收条件。", "ready"),
  review("H1", "S01", "需求确认审核", "产品 Agent", "确认 Agent Team 收到的需求、范围与验收语义。"),
  step("N02", "S02", "方案评审", "产品 Agent", "检查方案、依赖、风险和验收条款。"),
  review("H2", "S02", "测试设计审核", "测试 Agent", "确认测试设计、测试条件与能力缺口。未确认时 suite 保持 DRAFT，不用于正式验收执行；人工确认语义后可带明确 missing 进入 REVIEWED。reviewer 可按独立评审流程收件核验。"),
  step("N03", "S03", "开发准备", "开发 Agent", "准备执行输入、分支、环境和测试条件。"),
  step("N04", "S04", "开发实现", "开发 Agent", "根据已确认的输入完成实现并产出构建证据。"),
  step("N05", "S04", "代码评审", "开发 Agent", "检查变更、自动化结果与版本依据，完成合并。"),
  review("H3", "S04", "实现审核", "开发 Agent", "确认实现与代码审核结果。"),
  step("N06", "S05", "测试执行", "测试 Agent", "在真实运行环境执行测试并记录结果。交接必须返回完整 testChecklist（AUTOMATED_PASS / MANUAL_REQUIRED / AUTOMATION_MISSING / FAIL / BLOCKED / UNKNOWN / SKIPPED），不能只给通过总数；缺自动化能力须补实现，不得把 missing 改写成人工已验证。"),
  step("N07", "S05", "问题修复与验收", "开发 Agent", "处理失败项并准备复验，完成产品验收输入。"),
  review("H4", "S05", "最终验收审核", "测试 Agent", "确认真实测试结果与最终验收。"),
  step("N08", "S06", "发布准备", "开发 Agent", "准备发布说明、检查清单与回滚条件。"),
  step("N09", "S06", "发布执行", "开发 Agent", "执行获批发布并读回版本与发布时间。"),
  step("N10", "S06", "观察与复盘", "coordinator", "观察发布结果，记录结论与后续行动。复盘按真实运行评测口径：指标从完整实际事件计算，不从收件文件数估造；正确阻塞不算 Agent 失败。"),
];

export const beingsDevelopmentTransitions: PipelineTransition[] = [
  { id: "E01", fromNode: "N01", event: "完成", toNode: "H1" },
  { id: "E03", fromNode: "N02", event: "完成", toNode: "H2" },
  { id: "E06", fromNode: "N04", event: "完成", toNode: "N05" },
  { id: "E07", fromNode: "N05", event: "完成", toNode: "H3" },
  { id: "E09", fromNode: "N06", event: "失败", toNode: "N07", toStatus: "failed" },
  { id: "E10", fromNode: "N06", event: "通过", toNode: "N07" },
  { id: "E11", fromNode: "N07", event: "完成", toNode: "H4" },
  { id: "E13", fromNode: "N08", event: "完成", toNode: "N09" },
  { id: "E14", fromNode: "N09", event: "完成", toNode: "N10" },
];

const beingsDevelopmentStationLinks = [
  { fromStationId: "S01", toStationId: "S02" },
  { fromStationId: "S02", toStationId: "S03" },
  { fromStationId: "S03", toStationId: "S04" },
  { fromStationId: "S04", toStationId: "S05" },
  { fromStationId: "S05", toStationId: "S06" },
];

const layout: PipelineFlow["layout"] = {
  S01: { x: 60, y: 118 }, S02: { x: 410, y: 118 }, S03: { x: 760, y: 118 },
  S04: { x: 1110, y: 118 }, S05: { x: 1460, y: 118 }, S06: { x: 1810, y: 118 },
  N01: { x: 84, y: 190 }, H1: { x: 84, y: 310 }, N02: { x: 434, y: 190 }, H2: { x: 434, y: 310 },
  N03: { x: 784, y: 190 }, N04: { x: 1134, y: 190 }, N05: { x: 1134, y: 310 }, H3: { x: 1134, y: 430 },
  N06: { x: 1484, y: 190 }, N07: { x: 1484, y: 310 }, H4: { x: 1484, y: 430 },
  N08: { x: 1834, y: 190 }, N09: { x: 1834, y: 310 }, N10: { x: 1834, y: 430 },
};

export const beingsDevelopmentWorkflow: PipelineFlow = {
  id: "beings-development", name: "beings 开发流程", version: "v5-station-chain",
  source: "agent-team-spec-v0.2.md", groupName: "需求开发流程组",
  description: "需求开发流程组：保留 Agent Team 工作流，包含 H1-H4 人工审核点。对齐 d5-dcc-provider MR 10 流程更新（reviewer 独立评审 / 测试交付完整清单 / 按用例推进 / 真实运行评测）。",
  stations: beingsDevelopmentStations, nodes: beingsDevelopmentNodes, transitions: beingsDevelopmentTransitions,
  stationLinks: beingsDevelopmentStationLinks,
  layout, itemOrder: ["S01", "S02", "S03", "S04", "S05", "S06"],
};
