/** 星图的数据契约。流程定义固定为 beings 开发流程，实例只保存本地编辑。 */
export const NODE_STATUSES = [
  "pending",
  "ready",
  "running",
  "waiting_human",
  "blocked",
  "failed",
  "done",
  "skipped",
] as const;
export type NodeStatus = (typeof NODE_STATUSES)[number];

export const EXECUTION_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "timed_out",
  "cancelled",
  "taken_over",
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const DEMAND_STATUSES = [
  "demand.drafting",
  "demand.pending_review",
  "demand.reviewed",
  "demand.scheduled",
  "demand.developing",
  "demand.validating",
  "demand.released",
  "demand.paused",
  "demand.cancelled",
] as const;
export type DemandStatus = (typeof DEMAND_STATUSES)[number];

/** bug 修复流程沿用 Jira 口述的状态全集；状态历史写在星轨实例中。 */
export const BUG_STATUSES = ["开放", "开发中", "测试中", "重新打开", "已解决", "已关闭"] as const;
export type BugStatus = (typeof BUG_STATUSES)[number];
export type BugPriority = "P0" | "P1" | "P2" | "P3";
export interface BugHistoryEntry {
  status: BugStatus;
  at: string;
  content: string;
}
export interface BugIssue {
  priority: BugPriority;
  assignee: string;
  details: string;
  attachments: string[];
  status: BugStatus;
  history: BugHistoryEntry[];
}

export const DELIVERABLE_STATUSES = [
  "deliv.drafting",
  "deliv.developing",
  "deliv.validating",
  "deliv.released",
  "deliv.cancelled",
] as const;
export type DeliverableStatus = (typeof DELIVERABLE_STATUSES)[number];

export const DECISION_STATUSES = ["open", "decided", "expired", "superseded"] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];
export const ACTION_STATUSES = ["open", "done", "cancelled"] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];
export const ARTIFACT_STATUSES = ["draft", "final", "superseded"] as const;
export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number];
export const DEPENDENCY_STATUSES = ["open", "satisfied", "broken"] as const;
export type DependencyStatus = (typeof DEPENDENCY_STATUSES)[number];
export const RELEASE_TRAIN_STATUSES = ["planning", "loading", "shipping", "shipped", "closed"] as const;
export type ReleaseTrainStatus = (typeof RELEASE_TRAIN_STATUSES)[number];

export type PipelineNodeKind = "node" | "gate";
export type PipelineCanvasKind = "station" | PipelineNodeKind;
export type PipelineGateRole = "product" | "agent_review" | "custom";
export type Trigger = "事件" | "定时" | "人工";
export type ExecutionActor = "skill" | "being" | "人" | "skill+being" | "being+人" | "skill+人";
export interface PipelinePoint { x: number; y: number }

export interface PipelineNode {
  id: string;
  kind: PipelineNodeKind;
  /** V6 起站只是分组容器；null/undefined 表示自由节点。 */
  stationId?: string | null;
  /** 任意节点可拥有子节点；与站级分组相互独立。 */
  parentNodeId?: string;
  title: string;
  status: NodeStatus;
  stateReason?: string;
  stateSource?: "local" | "being";
  stateReport?: import("../../../shared/office").OfficeNodeReport;
  owner: string;
  owner_group: string;
  description: string;
  trigger: Trigger[];
  execution?: ExecutionActor;
  evidenceLevel?: `L${0 | 1 | 2 | 3 | 4 | 5}`;
  evidence?: string;
  approver?: string;
  input?: string;
  output?: string;
  timeout?: string;
  failureRoute?: string;
  /** 闸口字段：普通节点为空。 */
  gateRole?: PipelineGateRole;
  reviewCode?: `H${1 | 2 | 3 | 4}`;
  options?: string[];
  defaultOption?: string;
  minimumEvidence?: `L${0 | 1 | 2 | 3 | 4 | 5}`;
  precondition?: string;
  /** 节点本身是否需要人工审核，与审核任务是否分配给当前用户分开表达。 */
  requires_human_review?: boolean;
  /** 当前审核/操作任务被分配给谁；单机原型使用 board.currentUserId。 */
  assigned_user?: string;
  /** 协作更新序号与当前用户最后已读序号；update_seq > last_seen_seq 时显示更新圆点。 */
  update_seq?: number;
  last_seen_seq?: number;
  /** v0.2 锁定的 5 个产品闸口不可在编辑器中删除或改型。 */
  locked?: boolean;
}

export interface PipelineStation {
  id: string;
  kind: "station";
  title: string;
  subtitle: string;
  nodeIds: string[];
  description?: string;
  locked?: boolean;
}

export type PipelineCanvasItem = PipelineNode | PipelineStation;

export interface PipelineTransition {
  id?: string;
  fromNode: string;
  event: string;
  toNode?: string;
  toNodes?: string[];
  toStatus?: NodeStatus;
  writeback?: string;
  note?: string;
}

/** 站到站的语义连接。空站先连接站边界，节点加入后按首尾节点自动解析。 */
export interface PipelineStationLink {
  id: string;
  fromStationId: string;
  toStationId: string;
}

export interface PipelineStationSeedLink {
  fromStationId: string;
  toStationId: string;
}

export interface PipelineFlow {
  id: string;
  name: string;
  version: string;
  source: string;
  description: string;
  /** 左侧星轨列表的默认分组名称。 */
  groupName?: string;
  stations: PipelineStation[];
  nodes: PipelineNode[];
  transitions: PipelineTransition[];
  /** 默认流程的站间连接种子；实例落地后由 Demand.stationLinks 保存带 id 的副本。 */
  stationLinks?: PipelineStationSeedLink[];
  /** 默认只决定初始呈现；实例中的坐标可自由覆盖。 */
  layout: Record<string, PipelinePoint>;
  itemOrder: string[];
}

export type NodeOverride = Partial<Pick<
  PipelineNode,
  "title" | "owner" | "description" | "kind" | "stationId" | "parentNodeId" |
  "trigger" | "execution" | "evidence" | "approver" | "gateRole" |
  "requires_human_review" | "assigned_user" | "update_seq" | "last_seen_seq" | "stateReason" | "stateReport" | "stateSource"
>>;
export type StationOverride = Partial<Pick<PipelineStation, "title" | "subtitle" | "description" | "nodeIds">>;

export interface Demand {
  id: string;
  demo?: boolean;
  title: string;
  summary: string;
  status: DemandStatus;
  flowRevision: string;
  owner_group: string;
  /** 实例所使用的流程；缺省值兼容 V3/V4 本地数据。 */
  workflowId?: string;
  /** 左侧星轨分组；不参与星轨标题展示。 */
  groupName?: string;
  /** 左栏排序、置顶与未读均属于星轨实例视图状态。 */
  sortOrder: number;
  pinned?: boolean;
  unread?: boolean;
  /** bug 修复组的 Jira 兼容字段与状态历史。 */
  bug?: BugIssue;
  nodeStates: Partial<Record<string, NodeStatus>>;
  nodeOverrides: Record<string, NodeOverride>;
  stationOverrides: Record<string, StationOverride>;
  customNodes: PipelineNode[];
  customStations: PipelineStation[];
  customTransitions: PipelineTransition[];
  stationLinks: PipelineStationLink[];
  /** stationId → 首/尾锚定节点 override；缺省时沿用站内顺序首尾。 */
  stationAnchors?: Record<string, { start?: string; end?: string }>;
  deletedNodeIds: string[];
  deletedStationIds: string[];
  deletedTransitionIds: string[];
  positions: Record<string, PipelinePoint>;
  deliverables: Array<{
    id: string;
    title: string;
    status: DeliverableStatus;
    releaseTrainId?: string;
  }>;
}

export interface PipelineBoardMetadata {
  id: string;
  name: string;
  version: string;
  sourceBoardId: string;
  sourceVersion: string;
  branchName: string;
  ownerGroup: string;
  /** 单机身份占位；多人身份接入后替换为真实用户 id。 */
  currentUserId: string;
  revision: number;
}

export interface PipelineLocalState {
  schemaVersion: 4;
  board: PipelineBoardMetadata;
  selectedDemandId: string;
  demands: Demand[];
}

/** Town/BL 协作写回的预留出口；第二版 UI 仍只使用本地原型数据。 */
export interface PipelineWritebackPort {
  writeDemand?(demand: Demand): Promise<void>;
}

export const pipelineWriteback: PipelineWritebackPort = {};
