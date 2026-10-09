import type { PipelineFlow, PipelineNode, PipelineStation, PipelineTransition } from "./schema";

const group = "bug 修复";
const station = (id: string, title: string, subtitle: string, nodeIds: string[]): PipelineStation => ({
  id, kind: "station", title, subtitle, nodeIds, locked: true,
});
const step = (id: string, stationId: string, title: string, owner: string, description: string, status: PipelineNode["status"] = "pending"): PipelineNode => ({
  id, kind: "node", stationId, title, status, owner, owner_group: group, description,
  trigger: ["事件"], execution: "being", evidenceLevel: "L2", input: "待补充", output: "待补充",
  timeout: "待补充", failureRoute: "退回开发",
});

export const bugFixStations: PipelineStation[] = [
  station("B-S01", "填写", "填写完成即视为已提交", ["B01"]),
  station("B-S02", "开发", "定位、修复并提供修复证据", ["B03"]),
  station("B-S03", "测试验证", "通过后关闭；不通过退回开发", ["B04"]),
];

export const bugFixNodes: PipelineNode[] = [
  step("B01", "B-S01", "填写 Bug 信息", "提报人", "录入 Bug 标题、优先级、经办人与详情；填写完成即等于提交。", "ready"),
  step("B03", "B-S02", "开发修复", "开发 Agent", "定位问题、实现修复并附上可核验证据；完成后进入测试验证。"),
  step("B04", "B-S03", "测试验证", "测试 Agent", "验证修复结果；通过后节点进入已关闭，不通过则把问题退回开发。"),
];

export const bugFixTransitions: PipelineTransition[] = [
  { id: "B-E01", fromNode: "B01", event: "填写完成（已提交）", toNode: "B03" },
  { id: "B-E03", fromNode: "B03", event: "开发完成", toNode: "B04" },
  { id: "B-E04", fromNode: "B04", event: "通过（已关闭）", toStatus: "done" },
  { id: "B-E05", fromNode: "B04", event: "不通过（重新打开）", toNode: "B03", toStatus: "failed" },
];

const layout: PipelineFlow["layout"] = {
  "B-S01": { x: 80, y: 118 }, "B-S02": { x: 470, y: 118 }, "B-S03": { x: 860, y: 118 },
  B01: { x: 104, y: 190 }, B03: { x: 494, y: 190 }, B04: { x: 884, y: 190 },
};

export const bugFixWorkflow: PipelineFlow = {
  id: "bug-fix", name: "bug 修复流程", version: "v9-bug-fix",
  source: "pipeline/v9-requirements.md", groupName: group,
  description: "填写 → 开发 → 测试验证；通过关闭，不通过退回开发。提交与重新打开仅作为状态。",
  stations: bugFixStations, nodes: bugFixNodes, transitions: bugFixTransitions,
  layout, itemOrder: ["B-S01", "B-S02", "B-S03"],
};
