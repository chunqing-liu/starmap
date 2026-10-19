import type { PipelineFlow, PipelineNode, PipelineStation, PipelineTransition } from "./schema";

const group = "Agent Team";
const station = (id: string, title: string, subtitle: string, nodeIds: string[], track?: PipelineStation["track"]): PipelineStation => ({
  id, kind: "station", title, subtitle, nodeIds, locked: true, ...(track ? { track } : {}),
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
  station("S02", "评审", "先出测试设计再审核；reviewer 按独立评审流程旁路接收消息", ["N02", "N13", "H2"]),
  station("S03", "开发准备", "准备执行输入与测试条件", ["N03"], "dev"),
  station("S04", "开发", "实现、自测、审查、合并并完成交付核验；这条轨到交付核验即算开发闭环，不等测试", ["N04", "N05", "N12", "H3", "N11"], "dev"),
  station("S05", "测试", "独立执行、修复并完成验收；只约束上线准出", ["N06", "N07", "H4"], "release"),
  station("S06", "发布", "准备、发布并观察结果；发生在准出之后，不参与闭环判定", ["N08", "N09", "N10"]),
];

const rawBeingsDevelopmentNodes: PipelineNode[] = [
  step("N01", "S01", "需求确认", "产品 Agent", "确认需求范围、目标和验收条件。", "ready"),
  review("H1", "S01", "需求确认审核", "产品 Agent", "确认 Agent Team 收到的需求、范围与验收语义。"),
  step("N02", "S02", "方案评审", "产品 Agent", "检查方案、依赖、风险和验收条款。"),
  review("H2", "S02", "测试设计审核", "测试 Agent", "确认测试设计、测试条件与能力缺口。默认由独立 Agent 自动判定；命中语义例外、覆盖不可判定或范围扩大时转人工。未确认时 suite 保持 DRAFT，不用于正式验收执行；人工确认语义后可带明确 missing 进入 REVIEWED。"),
  step("N13", "S02", "测试设计", "测试 Agent", "按需求与验收语义编写测试设计：用例、环境条件、自动化能力清单与缺口。方案自身的问题在本环节由原作者修订，不占用开发迭代，也不阻塞开发闭环。"),
  step("N03", "S03", "开发准备", "开发 Agent", "准备执行输入、分支、环境和测试条件。"),
  step("N04", "S04", "开发实现", "开发 Agent", "根据已确认的输入完成实现并产出构建证据。"),
  step("N05", "S04", "代码评审", "开发 Agent", "检查变更、自动化结果与版本依据，完成合并。"),
  step("N12", "S04", "开发自测", "开发 Agent", "开发闭环必做项：先在工作台用可执行契约覆盖真实客户端路径与适用原生行为，得到可复现证据；自测不过不进入实现审核。测试范围按风险判断，不套用过重测试。"),
  review("H3", "S04", "实现审核", "开发 Agent", "确认实现、开发自测与代码审核结果。通过时输出固定候选（产物身份、环境、租约），正式测试必须消费同一版本。低风险通过由自动判定完成，高风险或跨范围变更转人工。"),
  step("N11", "S04", "交付核验", "开发 Agent", "核对交付物清单与构建产物、适用原生身份一致；证据绑定源码、用例与产物版本：版本变化时受影响项重新验证，未变化的证据可复用。开发闭环以此收口，不依赖 H2、正式测试或 H4。"),
  step("N06", "S05", "测试执行", "测试 Agent", "消费 H3 输出的固定开发候选（同一产物身份、环境与租约）与已审测试设计，在真实运行环境执行测试并记录结果。交接必须返回完整 testChecklist（AUTOMATED_PASS / MANUAL_REQUIRED / AUTOMATION_MISSING / FAIL / BLOCKED / UNKNOWN / SKIPPED），不能只给通过总数；缺自动化能力须补实现，不得把 missing 改写成人工已验证。"),
  step("N07", "S05", "问题修复与验收", "开发 Agent", "实现缺陷走关联修复并独立复审，复验只复测受影响项；原开发快照与失败证据必须保留，不得覆盖。测试方案自身问题退回测试设计修订，不占开发迭代。完成产品验收输入。"),
  review("H4", "S05", "最终验收审核", "测试 Agent", "确认真实测试结果与最终验收。"),
  step("N08", "S06", "发布准备", "开发 Agent", "准备发布说明、检查清单与回滚条件。"),
  step("N09", "S06", "发布执行", "开发 Agent", "执行获批发布并读回版本与发布时间。"),
  step("N10", "S06", "观察与复盘", "coordinator", "观察发布结果，记录结论与后续行动。复盘按真实运行评测口径：指标从完整实际事件计算，不从消息文件数估造；正确阻塞不算 Agent 失败。口径固定为：各阶段完成情况、执行/等待/返工分别计时、模型账单与人工人时分列、缺陷分类与去重、每个数字可回溯到原始证据；缺失项明确标注，不推测补齐。"),
];

/**
 * 轨归属（Lite 项目组 2026-10-19 拍板）：
 * 开发闭环 = H1 + 范围内实现/构建/开发自测 + 适用原生身份 + H3 + 交付核验(N11)，不等 H2、正式测试或 H4。
 * 上线准出 = H2 + 正式测试执行/报告 + 正式测试驱动的缺陷返修 + H4，只约束上线。
 */
const DEV_TRACK_NODE_IDS = ["N02", "N03", "N04", "N05", "N12", "H3", "N11"];
const RELEASE_TRACK_NODE_IDS = ["H2", "N06", "N07", "H4"];
/** 发布站（N08-N10）发生在准出之后，既不算开发闭环也不算上线准出，不参与两条轨的计数。 */
/** 默认自动判定的闸口：H2 测试设计、H3 实现审核；命中风险条件才转人工。 */
const AUTO_GATE_NODE_IDS = ["H2", "H3"];
const withTrack = (node: PipelineNode): PipelineNode => {
  if (AUTO_GATE_NODE_IDS.includes(node.id)) {
    const autoNode: PipelineNode = { ...node, requires_human_review: false };
    if (DEV_TRACK_NODE_IDS.includes(node.id)) return { ...autoNode, track: "dev" };
    if (RELEASE_TRACK_NODE_IDS.includes(node.id)) return { ...autoNode, track: "release" };
    return autoNode;
  }
  if (DEV_TRACK_NODE_IDS.includes(node.id)) return { ...node, track: "dev" };
  // N07 同时承担两类返修：开发自测驱动的留在实现环节，正式测试驱动的才挂失败报告。
  // 默认模板不预填报告名，留空由正式测试失败时自动带上，避免画布上出现假的报告引用。
  if (node.id === "N07") return { ...node, track: "release", repairKind: "formal_test" };
  if (RELEASE_TRACK_NODE_IDS.includes(node.id)) return { ...node, track: "release" };
  return node;
};
export const beingsDevelopmentNodes: PipelineNode[] = rawBeingsDevelopmentNodes.map(withTrack);

export const beingsDevelopmentTransitions: PipelineTransition[] = [
  { id: "E01", fromNode: "N01", event: "完成", toNode: "H1" },
  { id: "E03", fromNode: "N02", event: "完成", toNode: "N13" },
  { id: "E03b", fromNode: "N13", event: "完成", toNode: "H2" },
  { id: "E03c", fromNode: "H2", event: "退回", toNode: "N13", toStatus: "pending", note: "测试方案自身问题退回原测试作者修订，不影响开发轨" },
  { id: "E06", fromNode: "N04", event: "完成", toNode: "N05" },
  { id: "E07", fromNode: "N05", event: "完成", toNode: "N12" },
  { id: "E07a", fromNode: "N12", event: "完成", toNode: "H3" },
  { id: "E07b", fromNode: "H3", event: "通过", toNode: "N11" },
  { id: "E07c", fromNode: "H3", event: "固定候选", toNode: "N06", note: "正式测试消费同一产物身份、环境与租约；同版本可复用有效证据" },
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
  N01: { x: 84, y: 190 }, H1: { x: 84, y: 310 }, N02: { x: 434, y: 190 }, N13: { x: 434, y: 310 }, H2: { x: 434, y: 430 },
  N03: { x: 784, y: 190 }, N04: { x: 1134, y: 190 }, N05: { x: 1134, y: 310 }, N12: { x: 1134, y: 430 },
  H3: { x: 1134, y: 550 }, N11: { x: 1134, y: 670 },
  N06: { x: 1484, y: 190 }, N07: { x: 1484, y: 310 }, H4: { x: 1484, y: 430 },
  N08: { x: 1834, y: 190 }, N09: { x: 1834, y: 310 }, N10: { x: 1834, y: 430 },
};

export const beingsDevelopmentWorkflow: PipelineFlow = {
  id: "beings-development", name: "beings 开发流程", version: "v5-station-chain",
  source: "agent-team-spec-v0.2.md", groupName: "需求开发流程组",
  description: "需求开发流程组：保留 Agent Team 工作流，包含 H1-H4 人工审核点。对齐 d5-dcc-provider MR 10 流程更新（reviewer 独立评审 / 测试交付完整清单 / 按用例推进 / 真实运行评测）。",
  stations: beingsDevelopmentStations, nodes: beingsDevelopmentNodes, transitions: beingsDevelopmentTransitions,
  specVersion: { bundle: "provider-team-independent-testing-20261019", transitions: "4.0.0", reviewGates: "2.0.0", loadedAt: "2026-10-19" },
  stationLinks: beingsDevelopmentStationLinks,
  layout, itemOrder: ["S01", "S02", "S03", "S04", "S05", "S06"],
};
