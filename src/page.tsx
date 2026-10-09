import "@xyflow/react/dist/style.css";
import "./base.css";
import "./v4.css";
import { PipelineConnections } from './integrations';
import { NodeTaskPanel } from './workspace';
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  ConnectionLineType,
  Controls,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from "react";
import { pluginStorage, pluginPrompt, pluginConfirm, pluginToast } from "./host";
import type {
  BugStatus,
  Demand,
  NodeOverride,
  NodeStatus,
  PipelineFlow,
  PipelineLocalState,
  PipelineNode,
  PipelinePoint,
  PipelineStation,
  StationOverride,
} from "./models/schema";
import { BUG_STATUSES, NODE_STATUSES } from "./models/schema";
import {
  createDemand,
  demandNodes,
  demandStations,
  demandTransitions,
  getPipelineFlow,
  loadPipelineState,
  PIPELINE_STORAGE_KEY,
  sanitizePipelineState,
} from "./models/templates";
import {
  loadPipelineComments,
  savePipelineComments,
  type PipelineComment,
  type PipelineCommentTargetType,
} from "./models/comments";

const COMPACT_ZOOM = 0.58;
const NODE_WIDTH = 214;
const NODE_HEIGHT = 86;
const STATION_MIN_WIDTH = 286;
const STATION_EMPTY_HEIGHT = 152;
const STATION_COMPACT_HEIGHT = 170;
const STATION_HEADER_HEIGHT = 112;
const STATION_PADDING = 24;
const STATION_NODE_GAP = 108;
const FREE_NODE_GAP = 44;
const SIDEBAR_WIDTHS_STORAGE_KEY = "beings:star-map:sidebar-widths:v1";
const DEFAULT_SIDEBAR_WIDTHS = { left: 180, right: 230 };
const SIDEBAR_WIDTH_LIMITS = { left: { min: 180, max: 420 }, right: { min: 220, max: 520 } };
const STATION_ANCHOR_EDGE_PREFIX = "station-anchor-";
const COLLISION_TOLERANCE = 8;
const COLLISION_VERTICAL_GAP = 24;

const statusLabels: Record<NodeStatus, string> = {
  pending: "待开始", ready: "可开始", running: "运行中", waiting_human: "等待审核",
  blocked: "已阻塞", failed: "失败", done: "已完成", skipped: "已跳过",
};
const demandStatusLabels: Record<Demand["status"], string> = {
  "demand.drafting": "待撰写", "demand.pending_review": "待评审", "demand.reviewed": "已评审",
  "demand.scheduled": "已排期", "demand.developing": "开发中", "demand.validating": "测试验收",
  "demand.released": "已上线", "demand.paused": "已暂停", "demand.cancelled": "已取消",
};
const nextNodeActions: Record<NodeStatus, { label: string; status: NodeStatus }> = {
  pending: { label: "标记为可开始", status: "ready" },
  ready: { label: "开始执行", status: "running" },
  running: { label: "标记完成", status: "done" },
  waiting_human: { label: "审核通过", status: "done" },
  blocked: { label: "解除阻塞并重试", status: "ready" },
  failed: { label: "重新开始", status: "ready" },
  done: { label: "重新打开", status: "ready" },
  skipped: { label: "恢复处理", status: "ready" },
};
const isDefined = (value?: string) => Boolean(value?.trim() && value.trim() !== "待补充");
const demandStatusLabel = (demand: Demand) => demand.bug?.status || demandStatusLabels[demand.status];
const demandDisplayTitle = (demand: Demand) => demand.title;
const NODE_EVIDENCE_SEPARATOR = "\n\n完成证据：";

function nodeDescriptionValue(node: PipelineNode) {
  if (!isDefined(node.evidence) || node.description.includes(NODE_EVIDENCE_SEPARATOR)) return node.description;
  return node.description.trim()
    ? `${node.description}${NODE_EVIDENCE_SEPARATOR}${node.evidence}`
    : `${NODE_EVIDENCE_SEPARATOR.trimStart()}${node.evidence}`;
}

function splitNodeDescription(value: string) {
  const separator = value.indexOf(NODE_EVIDENCE_SEPARATOR);
  if (separator < 0) return { description: value, evidence: value };
  return {
    description: value.slice(0, separator).trim(),
    evidence: value.slice(separator + NODE_EVIDENCE_SEPARATOR.length).trim(),
  };
}

function loadSidebarWidths() {
  try {
    const value = JSON.parse(pluginStorage.getItem(SIDEBAR_WIDTHS_STORAGE_KEY) || "null") as unknown;
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      const left = typeof record.left === "number" && Number.isFinite(record.left) ? record.left : DEFAULT_SIDEBAR_WIDTHS.left;
      const right = typeof record.right === "number" && Number.isFinite(record.right) ? record.right : DEFAULT_SIDEBAR_WIDTHS.right;
      return {
        left: Math.min(SIDEBAR_WIDTH_LIMITS.left.max, Math.max(SIDEBAR_WIDTH_LIMITS.left.min, left)),
        right: Math.min(SIDEBAR_WIDTH_LIMITS.right.max, Math.max(SIDEBAR_WIDTH_LIMITS.right.min, right)),
      };
    }
  } catch { /* 损坏的视图偏好回落默认宽度。 */ }
  return DEFAULT_SIDEBAR_WIDTHS;
}

type StationSize = { width: number; height: number };
type StationAnchorSide = "start" | "end";
type CollisionRect = PipelinePoint & { width: number; height: number };

function parseStationAnchorEdgeId(id: string): { stationId: string; side: StationAnchorSide } | null {
  const match = id.match(/^station-anchor-(.+)-(start|end)$/);
  return match ? { stationId: match[1], side: match[2] as StationAnchorSide } : null;
}

function overlapsWithTolerance(a: CollisionRect, b: CollisionRect) {
  return a.x - COLLISION_TOLERANCE < b.x + b.width + COLLISION_TOLERANCE &&
    a.x + a.width + COLLISION_TOLERANCE > b.x - COLLISION_TOLERANCE &&
    a.y - COLLISION_TOLERANCE < b.y + b.height + COLLISION_TOLERANCE &&
    a.y + a.height + COLLISION_TOLERANCE > b.y - COLLISION_TOLERANCE;
}

function resolveCollision(position: PipelinePoint, obstacles: CollisionRect[], maxIterations: number): PipelinePoint {
  let next = position;
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const candidate: CollisionRect = { ...next, width: NODE_WIDTH, height: NODE_HEIGHT };
    const obstacle = obstacles.find((item) => overlapsWithTolerance(candidate, item));
    if (!obstacle) return next;
    const candidateCenterY = next.y + NODE_HEIGHT / 2;
    const obstacleCenterY = obstacle.y + obstacle.height / 2;
    next = {
      x: next.x,
      y: candidateCenterY < obstacleCenterY
        ? obstacle.y - NODE_HEIGHT - COLLISION_VERTICAL_GAP
        : obstacle.y + obstacle.height + COLLISION_VERTICAL_GAP,
    };
  }
  return next;
}

function visibleNodePosition(node: PipelineNode, positions: Record<string, PipelinePoint>, stationPositions: Map<string, PipelinePoint>) {
  const raw = positions[node.id] || { x: 80, y: 120 };
  if (!node.stationId) return raw;
  const station = stationPositions.get(node.stationId);
  if (!station) return raw;
  return {
    x: Math.max(raw.x, station.x + STATION_PADDING),
    y: Math.max(raw.y, station.y + STATION_HEADER_HEIGHT),
  };
}

function stationSizeFor(stationId: string, stationNodes: PipelineNode[], positions: Record<string, PipelinePoint>, compact: boolean): StationSize {
  if (compact) return { width: STATION_MIN_WIDTH, height: STATION_COMPACT_HEIGHT };
  const stationPosition = positions[stationId] || { x: 80, y: 120 };
  const stationPositions = new Map([[stationId, stationPosition]]);
  let width = STATION_MIN_WIDTH;
  let height = STATION_EMPTY_HEIGHT;
  stationNodes.forEach((node) => {
    const position = visibleNodePosition(node, positions, stationPositions);
    width = Math.max(width, position.x - stationPosition.x + NODE_WIDTH + STATION_PADDING);
    height = Math.max(height, position.y - stationPosition.y + NODE_HEIGHT + STATION_PADDING);
  });
  return { width, height };
}

function serialOrder(ids: string[], transitions: ReturnType<typeof demandTransitions>, stableIds: string[]) {
  const selected = new Set(ids);
  const successors = new Map<string, string[]>();
  const indegree = new Map(ids.map((id) => [id, 0]));
  transitions.forEach((transition) => {
    if (!transition.toNode || !selected.has(transition.fromNode) || !selected.has(transition.toNode)) return;
    successors.set(transition.fromNode, [...(successors.get(transition.fromNode) || []), transition.toNode]);
    indegree.set(transition.toNode, (indegree.get(transition.toNode) || 0) + 1);
  });
  const stable = (values: string[]) => values.sort((a, b) => stableIds.indexOf(a) - stableIds.indexOf(b));
  const queue = stable(ids.filter((id) => indegree.get(id) === 0));
  const result: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    if (result.includes(id)) continue;
    result.push(id);
    stable(successors.get(id) || []).forEach((next) => {
      indegree.set(next, (indegree.get(next) || 1) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    });
  }
  return [...result, ...stable(ids.filter((id) => !result.includes(id)))];
}

type Attention = "action" | "update" | null;
type StationData = {
  item: PipelineStation;
  compact: boolean;
  summary: string;
  count: number;
  stationLinked: boolean;
  stationChainBroken: boolean;
};
type ItemData = { item: PipelineNode; detailed: boolean; attention: Attention; statusLabel?: string };
type FlowNode = Node<StationData | ItemData>;

function isStationNode(node: FlowNode): node is Node<StationData> {
  return node.type === "station";
}

function RailToggleIcon({ direction, testId }: { direction: "left" | "right"; testId?: string }) {
  return <span className={`pipeline-square-icon is-${direction}`} data-testid={testId} aria-hidden="true" />;
}

function StationNode({ data }: NodeProps<Node<StationData>>) {
  return <div className={`star-map-station${data.compact ? " is-compact" : ""}${data.stationLinked ? " is-station-linked" : ""}${data.stationChainBroken ? " is-station-chain-broken" : ""}`}>
    <Handle id="input" type="target" position={Position.Left} className="star-map-port is-input" title="连接输入" aria-label={`${data.item.title} 连接输入`} data-testid={`connect-target-${data.item.id}`}><span>●</span></Handle>
    <Handle id="output" type="source" position={Position.Right} className="star-map-port is-output" title="拖动以连接" aria-label={`从 ${data.item.title} 开始连接`} data-testid={`connect-source-${data.item.id}`}><span>＋</span></Handle>
    <Handle id="anchor-input" type="target" position={Position.Right} className="star-map-anchor-port is-anchor-input" style={{ top: "66%" }} title="调整站尾锚定" aria-label={`${data.item.title} 站尾锚定目标`} />
    <Handle id="anchor-output" type="source" position={Position.Left} className="star-map-anchor-port is-anchor-output" style={{ top: "34%" }} title="调整站首锚定" aria-label={`从 ${data.item.title} 调整站首锚定`} />
    <div className="star-map-station-heading"><span>{data.item.id}</span><strong>{data.item.title}</strong></div>
    <p>{data.compact ? data.summary : data.item.subtitle}</p>
    {!data.compact && <span className="star-map-station-caption">站 · {data.count} 个节点</span>}
  </div>;
}

function ItemNode({ data }: NodeProps<Node<ItemData>>) {
  const item = data.item;
  return <div className={`star-map-item status-${item.status}${item.kind === "gate" ? " is-review" : ""}${data.detailed ? " is-detailed" : ""}`}>
    <Handle id="input" type="target" position={Position.Left} className="star-map-port is-input" title="连接输入" aria-label={`${item.title} 连接输入`} data-testid={`connect-target-${item.id}`}><span>●</span></Handle>
    <Handle id="output" type="source" position={Position.Right} className="star-map-port is-output" title="拖动以连接" aria-label={`从 ${item.title} 开始连接`} data-testid={`connect-source-${item.id}`}><span>＋</span></Handle>
    <Handle id="anchor-input" type="target" position={Position.Left} className="star-map-anchor-port is-anchor-input" style={{ top: "35%" }} title="作为站首节点" aria-label={`${item.title} 作为站首锚定节点`} />
    <Handle id="anchor-output" type="source" position={Position.Right} className="star-map-anchor-port is-anchor-output" style={{ top: "65%" }} title="作为站尾节点" aria-label={`${item.title} 作为站尾锚定节点`} />
    {data.attention && <span className={`star-map-attention-dot is-${data.attention}`} title={data.attention === "action" ? "需要你操作" : "有更新"} aria-label={data.attention === "action" ? "需要你操作" : "有更新"} />}
    <div className="star-map-item-topline"><code>{item.reviewCode || item.id}</code><i /><b>{item.kind === "gate" ? "闸口" : data.statusLabel || statusLabels[item.status]}</b></div>
    <strong>{item.title}</strong>
    <small title={data.detailed ? `${item.owner || "待补充"} · ${item.description || "待补充"}` : item.owner || "待补充"}>{data.detailed ? `${item.owner || "待补充"} · ${item.description || "待补充"}` : item.owner || "待补充"}</small>
  </div>;
}

function CommentSection({ comments, currentUserId, onSubmit }: {
  comments: PipelineComment[];
  currentUserId: string;
  onSubmit(content: string): void;
}) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(comments.length > 0);
  const send = () => {
    const content = draft.trim();
    if (!content) return;
    onSubmit(content);
    setDraft("");
  };
  return <details className="pipeline-comments" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary><span>评论</span><small>{comments.length ? `${comments.length} 条` : "添加评论"}</small></summary>
    <div className="pipeline-comments-body">
      {comments.length > 0 && <div className="pipeline-comment-list">
        {comments.map((comment) => <article key={comment.id}>
          <header><strong>{comment.author === currentUserId ? "当前用户" : comment.author}</strong><time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleString()}</time></header>
          <p>{comment.content}</p>
        </article>)}
      </div>}
      <label><span>留言建议</span><textarea rows={3} value={draft} placeholder="只留言建议，不修改站或节点内容" onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); send(); }
      }} /></label>
      <button type="button" className="secondary pipeline-comment-send" disabled={!draft.trim()} onClick={send}>发送评论</button>
    </div>
  </details>;
}

const nodeTypes = { station: StationNode, item: ItemNode };
type CanvasMenu = { x: number; y: number; kind: "pane" | "node" | "station" | "selection" | "edge"; ids: string[] };

function PipelineCanvas({
  demand, flow, stations, nodes, positions, currentUserId, selectedItemIds,
  onDemandChange, onSelectionChange, onCreateItem, onDeleteItems, onDuplicateItems, onToast,
  onConvertNode, onMarkNodeUpdated, onRenameStation, onAutoArrange, onCreateStationFromSelection,
}: {
  demand?: Demand;
  flow: PipelineFlow;
  stations: PipelineStation[];
  nodes: PipelineNode[];
  positions: Record<string, PipelinePoint>;
  currentUserId: string;
  selectedItemIds: string[];
  onDemandChange(change: (current: PipelineLocalState) => PipelineLocalState): void;
  onSelectionChange(ids: string[]): void;
  onToast(message: string): void;
  onCreateItem(kind: "station" | "node" | "gate", position: PipelinePoint): void;
  onDeleteItems(ids: string[]): void;
  onDuplicateItems(ids: string[], options?: { offset?: number; select?: boolean }): void;
  onConvertNode(id: string): void;
  onMarkNodeUpdated(ids: string[]): void;
  onRenameStation(id: string): void;
  onAutoArrange(ids: string[]): void;
  onCreateStationFromSelection(ids: string[]): void;
}) {
  const wrapper = useRef<HTMLDivElement>(null);
  const altDragIds = useRef<string[]>([]);
  const [zoom, setZoom] = useState(0.72);
  const [contextMenu, setContextMenu] = useState<CanvasMenu | null>(null);
  const [connectingFromId, setConnectingFromId] = useState("");
  const [lastConnection, setLastConnection] = useState("");
  const [flowNodes, setFlowNodes] = useNodesState<FlowNode>([]);
  const [flowEdges, setFlowEdges] = useEdgesState<Edge>([]);
  const { fitView, zoomIn, zoomOut, getViewport, setViewport, screenToFlowPosition, getNodes, getEdges } = useReactFlow<FlowNode, Edge>();
  const compact = zoom < COMPACT_ZOOM;
  const detailed = zoom >= 0.9;
  const stationById = useMemo(() => new Map(stations.map((item) => [item.id, item])), [stations]);
  const nodeById = useMemo(() => new Map(nodes.map((item) => [item.id, item])), [nodes]);
  const stationPositionById = useMemo(() => new Map(stations.map((station) => [station.id, positions[station.id] || { x: 80, y: 120 }])), [stations, positions]);
  const stationSizeById = useMemo(() => new Map(stations.map((station) => [station.id, stationSizeFor(station.id, nodes.filter((node) => node.stationId === station.id), positions, false)])), [stations, nodes, positions]);

  const orderedStationNodes = (stationId: string) => {
    const order = stationById.get(stationId)?.nodeIds || [];
    const members = nodes.filter((node) => node.stationId === stationId);
    return [...members].sort((a, b) => {
      const ai = order.indexOf(a.id), bi = order.indexOf(b.id);
      return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) - (bi < 0 ? Number.MAX_SAFE_INTEGER : bi);
    });
  };

  const attentionFor = (item: PipelineNode): Attention => {
    const needsMe = Boolean(item.requires_human_review || item.kind === "gate") && item.status === "waiting_human" && item.assigned_user === currentUserId;
    if (needsMe) return "action";
    return (item.update_seq || 0) > (item.last_seen_seq || 0) ? "update" : null;
  };

  const buildNodes = () => {
    const linkedStationIds = new Set<string>();
    demand?.stationLinks.forEach((link) => { linkedStationIds.add(link.fromStationId); linkedStationIds.add(link.toStationId); });
    const transitionKeys = new Set<string>();
    const outgoingTargets = new Map<string, Set<string>>();
    const incomingSources = new Map<string, Set<string>>();
    (demand ? demandTransitions(flow, demand) : []).forEach((transition) => {
      const targets = [...new Set([
        transition.toNode,
        ...(transition.toNodes || []),
      ].filter((target): target is string => Boolean(target)))];
      targets.forEach((target) => {
        transitionKeys.add(`${transition.fromNode}->${target}`);
        outgoingTargets.set(transition.fromNode, new Set([...(outgoingTargets.get(transition.fromNode) || []), target]));
        incomingSources.set(target, new Set([...(incomingSources.get(target) || []), transition.fromNode]));
      });
    });
    const result: FlowNode[] = stations.map((station) => {
      const stationNodes = nodes.filter((node) => node.stationId === station.id);
      const done = stationNodes.filter((node) => node.status === "done").length;
      const size = stationSizeFor(station.id, stationNodes, positions, compact);
      const stationLinked = linkedStationIds.has(station.id);
      const orderedNodes = orderedStationNodes(station.id);
      const stationChainBroken = stationLinked && orderedNodes.some((node, index) => {
        const next = orderedNodes[index + 1];
        if (!next || transitionKeys.has(`${node.id}->${next.id}`)) return false;
        const hasDetourOut = [...(outgoingTargets.get(node.id) || [])].some((target) => target !== next.id);
        const hasDetourIn = [...(incomingSources.get(next.id) || [])].some((source) => source !== node.id);
        return hasDetourOut || hasDetourIn;
      });
      return {
        id: station.id, type: "station", position: stationPositionById.get(station.id)!, selected: selectedItemIds.includes(station.id),
        data: { item: station, compact, count: stationNodes.length, summary: `${done}/${stationNodes.length} 已完成`, stationLinked, stationChainBroken },
        style: { width: size.width, height: size.height }, zIndex: 0,
      } satisfies FlowNode;
    });
    nodes.forEach((item) => {
      const hiddenInCompactStation = compact && Boolean(item.stationId);
      result.push({
        id: item.id, type: "item", position: visibleNodePosition(item, positions, stationPositionById), selected: selectedItemIds.includes(item.id),
        data: {
          item, detailed, attention: attentionFor(item),
          statusLabel: demand?.workflowId === "bug-fix" && item.id === "B04" && item.status === "done" ? "已关闭" : undefined,
        }, selectable: !hiddenInCompactStation,
        style: { width: NODE_WIDTH, height: NODE_HEIGHT, opacity: hiddenInCompactStation ? 0 : 1, pointerEvents: hiddenInCompactStation ? "none" : "auto", transition: "opacity 160ms ease" },
        zIndex: 2,
      } satisfies FlowNode);
    });
    return result;
  };

  const buildEdges = () => {
    if (!demand) return [];
    const edgeKeys = new Set<string>();
    const edges: Edge[] = [];
    demand.stationLinks.forEach((link) => {
      const sourceNodes = orderedStationNodes(link.fromStationId);
      const targetNodes = orderedStationNodes(link.toStationId);
      // 站间连接始终落在站容器的 handles 上，避免展开态被误读为“站内首尾节点相连”。
      // 先注册 stationLink，使收起态的站对边不会被跨站节点投影线吞掉。
      const source = link.fromStationId;
      const target = link.toStationId;
      if (!stationById.has(link.fromStationId) || !stationById.has(link.toStationId)) return;
      const key = `${source}->${target}`;
      if (edgeKeys.has(key)) return;
      edgeKeys.add(key);
      edges.push({ id: link.id, source, target, type: "default", selectable: true, deletable: true,
        markerEnd: { type: MarkerType.ArrowClosed }, label: detailed ? "站间串联" : undefined,
        zIndex: 1,
        className: `pipeline-edge-station${!sourceNodes.length || !targetNodes.length ? " is-pending-station-link" : ""}` });
    });
    if (!compact) {
      stations.forEach((station) => {
        const orderedNodes = orderedStationNodes(station.id);
        const override = demand.stationAnchors?.[station.id];
        const defaultFirstNode = orderedNodes[0];
        const defaultLastNode = orderedNodes.at(-1);
        const firstOverrideNode = override?.start ? orderedNodes.find((node) => node.id === override.start) : undefined;
        const lastOverrideNode = override?.end ? orderedNodes.find((node) => node.id === override.end) : undefined;
        const firstNode = firstOverrideNode || defaultFirstNode;
        const lastNode = lastOverrideNode || defaultLastNode;
        if (!firstNode || !lastNode) return;
        const addAnchorEdge = (side: StationAnchorSide, source: string, sourceHandle: string, target: string, targetHandle: string, editable: boolean) => {
          edges.push({
            id: `${STATION_ANCHOR_EDGE_PREFIX}${station.id}-${side}`, source, sourceHandle, target, targetHandle,
            type: "default", selectable: editable, deletable: editable, focusable: editable, zIndex: 1,
            className: `pipeline-edge-station-anchor${editable ? " is-editable" : ""}`,
          });
        };
        const startEditable = Boolean(firstOverrideNode);
        const endEditable = Boolean(lastOverrideNode);
        if (orderedNodes.length === 1 && endEditable && !startEditable) {
          addAnchorEdge("end", lastNode.id, "anchor-output", station.id, "anchor-input", true);
        } else {
          addAnchorEdge("start", station.id, "anchor-output", firstNode.id, "anchor-input", startEditable);
        }
        if (orderedNodes.length > 1) {
          edges.push({
            id: `${STATION_ANCHOR_EDGE_PREFIX}${station.id}-end`, source: lastNode.id, sourceHandle: "anchor-output",
            target: station.id, targetHandle: "anchor-input", type: "default", selectable: endEditable, deletable: endEditable,
            focusable: endEditable, zIndex: 1, className: `pipeline-edge-station-anchor${endEditable ? " is-editable" : ""}`,
          });
        }
      });
    }
    demandTransitions(flow, demand).forEach((transition, index) => {
      if (!transition.toNode || !nodeById.has(transition.fromNode) || !nodeById.has(transition.toNode)) return;
      const sourceNode = nodeById.get(transition.fromNode)!;
      const targetNode = nodeById.get(transition.toNode)!;
      const sameStation = Boolean(sourceNode.stationId) && sourceNode.stationId === targetNode.stationId;
      if (compact && sameStation) return;
      const source = compact && sourceNode.stationId && sourceNode.stationId !== targetNode.stationId ? sourceNode.stationId : sourceNode.id;
      const target = compact && targetNode.stationId && sourceNode.stationId !== targetNode.stationId ? targetNode.stationId : targetNode.id;
      const key = `${source}->${target}`;
      if (edgeKeys.has(key)) return;
      edgeKeys.add(key);
      edges.push({
        id: transition.id || `E${index}`, source, target, type: "default", selectable: true, deletable: true,
        markerEnd: { type: MarkerType.ArrowClosed }, label: detailed ? transition.event : undefined,
        labelStyle: { fontSize: 10 }, zIndex: 1,
        className: `pipeline-edge-node${sameStation ? " is-internal" : ""}${["失败", "不通过", "重新打开"].some((keyword) => transition.event.includes(keyword)) ? " is-return" : ""}`,
      });
    });
    return edges;
  };

  const renderedNodes = useMemo(() => buildNodes(), [demand, flow, stations, nodes, positions, compact, detailed, selectedItemIds, currentUserId]);
  const renderedEdges = useMemo(() => buildEdges(), [demand, flow, stations, nodes, positions, compact, detailed]);
  useEffect(() => { setFlowNodes(renderedNodes); setFlowEdges(renderedEdges); }, [renderedNodes, renderedEdges]);
  useEffect(() => {
    const dismiss = () => setContextMenu(null);
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);

  const updateStationAndChildren = (stationId: string, nextPosition: PipelinePoint) => {
    if (!demand) return;
    const previous = positions[stationId] || { x: 80, y: 120 };
    const delta = { x: nextPosition.x - previous.x, y: nextPosition.y - previous.y };
    const changes: Record<string, PipelinePoint> = { [stationId]: nextPosition };
    nodes.filter((node) => node.stationId === stationId).forEach((node) => {
      const position = positions[node.id] || { x: previous.x + STATION_PADDING, y: previous.y + STATION_HEADER_HEIGHT };
      changes[node.id] = { x: position.x + delta.x, y: position.y + delta.y };
    });
    onDemandChange((current) => ({ ...current, demands: current.demands.map((item) => item.id === demand.id ? { ...item, positions: { ...item.positions, ...changes } } : item) }));
  };

  const persistDraggedNodes = (dragged: FlowNode) => {
    if (!demand) return;
    if (isStationNode(dragged)) { updateStationAndChildren(dragged.id, dragged.position); return; }
    const currentNodes = getNodes();
    const latestById = new Map(currentNodes.map((node) => [node.id, node]));
    latestById.set(dragged.id, dragged);
    const moving = currentNodes.filter((node) => node.type === "item" && node.selected);
    if (!moving.some((node) => node.id === dragged.id)) moving.splice(0, moving.length, dragged);
    // P15：先算落点归属。同站拖动不得改变 nodeIds 顺序——否则站内拖一下首/尾节点就会跳到队尾，锚定虚线跟着跳变（2026-09-24 醇青反馈）。
    const targetByMovingId = new Map<string, PipelineStation | null>();
    moving.forEach((movingNode) => {
      const latest = latestById.get(movingNode.id) || movingNode;
      const center = { x: latest.position.x + NODE_WIDTH / 2, y: latest.position.y + NODE_HEIGHT / 2 };
      const target = stations.find((station) => {
        const origin = stationPositionById.get(station.id) || { x: 80, y: 120 };
        const size = stationSizeById.get(station.id) || { width: STATION_MIN_WIDTH, height: STATION_EMPTY_HEIGHT };
        return center.x >= origin.x && center.x <= origin.x + size.width && center.y >= origin.y && center.y <= origin.y + size.height;
      }) || null;
      targetByMovingId.set(movingNode.id, target);
    });
    const proposedPositions = new Map<string, PipelinePoint>();
    nodes.forEach((item) => proposedPositions.set(item.id, visibleNodePosition(item, positions, stationPositionById)));
    moving.forEach((movingNode) => {
      const latest = latestById.get(movingNode.id) || movingNode;
      const target = targetByMovingId.get(movingNode.id);
      proposedPositions.set(movingNode.id, target ? {
        x: Math.max(latest.position.x, (stationPositionById.get(target.id)?.x || 80) + STATION_PADDING),
        y: Math.max(latest.position.y, (stationPositionById.get(target.id)?.y || 120) + STATION_HEADER_HEIGHT),
      } : latest.position);
    });
    moving.forEach((movingNode) => {
      const candidate = proposedPositions.get(movingNode.id);
      if (!candidate) return;
      const obstacles = nodes.filter((item) => item.id !== movingNode.id).map((item) => ({
        ...(proposedPositions.get(item.id) || visibleNodePosition(item, positions, stationPositionById)),
        width: NODE_WIDTH, height: NODE_HEIGHT,
      }));
      proposedPositions.set(movingNode.id, resolveCollision(candidate, obstacles, Math.max(1, nodes.length)));
    });
    onDemandChange((current) => ({ ...current, demands: current.demands.map((entry) => {
      if (entry.id !== demand.id) return entry;
      const stationOverrides = { ...entry.stationOverrides };
      const nodeOverrides = { ...entry.nodeOverrides };
      const nextPositions = { ...entry.positions };
      const previousStationIdOf = (nodeId: string) => (nodeId in nodeOverrides ? nodeOverrides[nodeId]?.stationId ?? null : nodeById.get(nodeId)?.stationId ?? null);
      stations.forEach((station) => {
        const leavingIds = moving.filter((movingNode) => previousStationIdOf(movingNode.id) === station.id && targetByMovingId.get(movingNode.id)?.id !== station.id).map((movingNode) => movingNode.id);
        if (!leavingIds.length) return;
        stationOverrides[station.id] = { ...stationOverrides[station.id], nodeIds: (stationOverrides[station.id]?.nodeIds || station.nodeIds).filter((id) => !leavingIds.includes(id)) };
      });
      moving.forEach((movingNode) => {
        const latest = latestById.get(movingNode.id) || movingNode;
        const target = targetByMovingId.get(movingNode.id);
        const previousStationId = previousStationIdOf(movingNode.id);
        const position = proposedPositions.get(movingNode.id) || latest.position;
        nextPositions[movingNode.id] = position;
        nodeOverrides[movingNode.id] = { ...nodeOverrides[movingNode.id], stationId: target?.id || null };
        if (target && previousStationId !== target.id) {
          stationOverrides[target.id] = { ...stationOverrides[target.id], nodeIds: [...(stationOverrides[target.id]?.nodeIds || target.nodeIds), movingNode.id] };
        }
      });
      return { ...entry, positions: nextPositions, nodeOverrides, stationOverrides };
    }) }));
  };

  const removeEdges = (ids: string[]) => {
    if (!demand || !ids.length) return;
    const anchorIds = ids.map(parseStationAnchorEdgeId).filter((item): item is { stationId: string; side: StationAnchorSide } => Boolean(item));
    const persistedIds = ids.filter((id) => !id.startsWith(STATION_ANCHOR_EDGE_PREFIX));
    if (!anchorIds.length && !persistedIds.length) return;
    onDemandChange((current) => ({ ...current, demands: current.demands.map((item) => item.id === demand.id ? {
      ...item, stationAnchors: (() => {
        const stationAnchors = { ...(item.stationAnchors || {}) };
        anchorIds.forEach(({ stationId, side }) => {
          const next = { ...(stationAnchors[stationId] || {}) };
          delete next[side];
          if (next.start || next.end) stationAnchors[stationId] = next;
          else delete stationAnchors[stationId];
        });
        return stationAnchors;
      })(),
      stationLinks: item.stationLinks.filter((link) => !persistedIds.includes(link.id)),
      deletedTransitionIds: [...new Set([...item.deletedTransitionIds, ...persistedIds])],
    } : item) }));
  };

  const onNodesChange = (changes: NodeChange<FlowNode>[]) => {
    if (!changes.length) return;
    setFlowNodes((current) => applyNodeChanges(changes, current));
  };
  const onEdgesChange = (changes: EdgeChange[]) => {
    setFlowEdges((current) => applyEdgeChanges(changes, current));
    removeEdges(changes.filter((change): change is EdgeChange & { type: "remove" } => change.type === "remove").map((change) => change.id));
  };

  const onConnect = (connection: Connection) => {
    if (!demand || !connection.source || !connection.target || connection.source === connection.target) return;
    const sourceHandle = connection.sourceHandle || "";
    const targetHandle = connection.targetHandle || "";
    if (sourceHandle.startsWith("anchor-") || targetHandle.startsWith("anchor-")) {
      const isStartAnchor = sourceHandle === "anchor-output" && targetHandle === "anchor-input" && stationById.has(connection.source) && nodeById.has(connection.target);
      const isEndAnchor = sourceHandle === "anchor-output" && targetHandle === "anchor-input" && nodeById.has(connection.source) && stationById.has(connection.target);
      const stationId = isStartAnchor ? connection.source : isEndAnchor ? connection.target : "";
      const nodeId = isStartAnchor ? connection.target : isEndAnchor ? connection.source : "";
      const side: StationAnchorSide = isStartAnchor ? "start" : "end";
      const node = nodeById.get(nodeId);
      if (!stationId || !node || node.stationId !== stationId) {
        onToast("锚定节点须在本站内");
        setLastConnection("锚定节点须在本站内"); setConnectingFromId("");
        return;
      }
      onDemandChange((current) => ({ ...current, demands: current.demands.map((item) => item.id === demand.id ? {
        ...item,
        stationAnchors: { ...(item.stationAnchors || {}), [stationId]: { ...(item.stationAnchors?.[stationId] || {}), [side]: nodeId } },
      } : item) }));
      setLastConnection(`${stationId} ${side === "start" ? "首" : "尾"}锚定 ${nodeId}`); setConnectingFromId("");
      return;
    }
    if (stationById.has(connection.source) && stationById.has(connection.target)) {
      const id = `station-link-${crypto.randomUUID()}`;
      onDemandChange((current) => ({ ...current, demands: current.demands.map((item) => item.id === demand.id ? {
        ...item, stationLinks: [...item.stationLinks, { id, fromStationId: connection.source!, toStationId: connection.target! }],
      } : item) }));
      setLastConnection(`${connection.source} → ${connection.target}`); setConnectingFromId(""); return;
    }
    const source = stationById.has(connection.source) ? orderedStationNodes(connection.source).at(-1)?.id : connection.source;
    const target = stationById.has(connection.target) ? orderedStationNodes(connection.target)[0]?.id : connection.target;
    if (!source || !target || !nodeById.has(source) || !nodeById.has(target)) { setLastConnection("空站会先保留站间连接，节点加入后自动串联"); return; }
    const id = `custom-edge-${crypto.randomUUID()}`;
    onDemandChange((current) => ({ ...current, demands: current.demands.map((item) => item.id === demand.id ? {
      ...item, customTransitions: [...item.customTransitions, { id, fromNode: source, toNode: target, event: "手动连接" }],
    } : item) }));
    setLastConnection(`${source} → ${target}`); setConnectingFromId("");
  };

  const createAtViewportCenter = (kind: "station" | "node" | "gate") => {
    const bounds = wrapper.current?.getBoundingClientRect();
    if (!bounds) return;
    const center = screenToFlowPosition({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 });
    const width = kind === "station" ? STATION_MIN_WIDTH : NODE_WIDTH;
    const height = kind === "station" ? STATION_EMPTY_HEIGHT : NODE_HEIGHT;
    onCreateItem(kind, { x: center.x - width / 2, y: center.y - height / 2 });
  };

  const selectedCanvasIds = () => getNodes().filter((node) => node.selected).map((node) => node.id);
  const openNodeMenu = (event: ReactMouseEvent, node: FlowNode) => {
    event.preventDefault(); event.stopPropagation();
    const selection = selectedCanvasIds();
    const ids = selection.includes(node.id) && selection.length > 1 ? selection : [node.id];
    onSelectionChange(ids);
    setContextMenu({ x: event.clientX, y: event.clientY, kind: ids.length > 1 ? "selection" : isStationNode(node) ? "station" : "node", ids });
  };

  const restoreStationAnchor = (edgeId: string) => {
    const anchor = parseStationAnchorEdgeId(edgeId);
    if (!anchor || !demand) return;
    onDemandChange((current) => ({ ...current, demands: current.demands.map((item) => {
      if (item.id !== demand.id) return item;
      const stationAnchors = { ...(item.stationAnchors || {}) };
      const next = { ...(stationAnchors[anchor.stationId] || {}) };
      delete next[anchor.side];
      if (next.start || next.end) stationAnchors[anchor.stationId] = next;
      else delete stationAnchors[anchor.stationId];
      return { ...item, stationAnchors };
    }) }));
    setContextMenu(null);
  };

  const openEdgeMenu = (event: ReactMouseEvent, edge: Edge) => {
    event.preventDefault(); event.stopPropagation();
    const anchor = parseStationAnchorEdgeId(edge.id);
    const isEditableAnchor = Boolean(anchor && edge.selectable && edge.deletable);
    const isStationLink = demand?.stationLinks.some((link) => link.id === edge.id) || false;
    if (!isEditableAnchor && !isStationLink) return;
    setContextMenu({ x: event.clientX, y: event.clientY, kind: "edge", ids: [edge.id] });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || (event.target instanceof HTMLElement && event.target.isContentEditable)) return;
      const ids = selectedCanvasIds();
      if (ids.length) { event.preventDefault(); onDeleteItems(ids); return; }
      const edgeIds = getEdges().filter((edge) => edge.selected).map((edge) => edge.id);
      if (edgeIds.length) { event.preventDefault(); removeEdges(edgeIds); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [demand, stations, nodes]);

  const onWheelCapture = (event: WheelEvent<HTMLDivElement>) => {
    if (!event.shiftKey) return;
    event.preventDefault(); event.stopPropagation();
    const viewport = getViewport();
    setViewport({ ...viewport, x: viewport.x - event.deltaY - event.deltaX }, { duration: 0 });
  };

  const handleSelectionChange = useCallback(({ nodes: selected }: { nodes: FlowNode[] }) => {
    onSelectionChange(selected.map((node) => node.id));
  }, [onSelectionChange]);

  const menuNodeIds = contextMenu?.ids.filter((id) => nodeById.has(id)) || [];
  const menuEdgeId = contextMenu?.kind === "edge" ? contextMenu.ids[0] : "";
  const menuEdgeAnchor = menuEdgeId ? parseStationAnchorEdgeId(menuEdgeId) : null;
  const menuEdgeIsStationLink = Boolean(menuEdgeId && demand?.stationLinks.some((link) => link.id === menuEdgeId));
  return <div ref={wrapper} className="star-map-canvas" style={{ "--star-map-zoom": zoom } as CSSProperties} onWheelCapture={onWheelCapture} onContextMenuCapture={(event) => event.preventDefault()}>
    <ReactFlow
      nodes={flowNodes} edges={flowEdges} nodeTypes={nodeTypes}
      onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
      onConnectStart={(_event, params) => { setConnectingFromId(params.nodeId || "当前节点"); setLastConnection(""); }}
      onConnectEnd={() => setConnectingFromId("")}
      onNodeClick={(_event, node) => { onSelectionChange([node.id]); setContextMenu(null); }}
      onNodeContextMenu={openNodeMenu}
      onEdgeContextMenu={openEdgeMenu}
      onNodeDragStart={(event, node) => {
        altDragIds.current = [];
        if (!("altKey" in event) || !event.altKey || isStationNode(node)) return;
        const selection = selectedCanvasIds();
        altDragIds.current = selection.includes(node.id) ? selection.filter((id) => nodeById.has(id)) : [node.id];
      }}
      onNodeDragStop={(_event, node) => {
        if (altDragIds.current.length) onDuplicateItems(altDragIds.current, { offset: 0, select: false });
        altDragIds.current = [];
        persistDraggedNodes(node);
      }}
      onSelectionChange={handleSelectionChange}
      onPaneClick={() => { onSelectionChange([]); setContextMenu(null); }}
      onPaneContextMenu={(event) => {
        event.preventDefault();
        const ids = selectedCanvasIds();
        setContextMenu({ x: event.clientX, y: event.clientY, kind: ids.length ? "selection" : "pane", ids });
      }}
      onMove={(_event, viewport) => setZoom(viewport.zoom)}
      defaultViewport={{ x: 24, y: 64, zoom: 0.72 }} minZoom={0.28} maxZoom={1.6}
      connectionRadius={48} connectionLineType={ConnectionLineType.Bezier}
      connectionLineStyle={{ stroke: "#6d7cff", strokeWidth: 2, strokeDasharray: "6 4" }} connectionDragThreshold={2}
      isValidConnection={(connection) => Boolean(connection.source && connection.target && connection.source !== connection.target)}
      zoomOnScroll zoomOnPinch panOnDrag={[1, 2]} panOnScroll={false} selectionOnDrag selectionMode={SelectionMode.Partial}
      elevateNodesOnSelect={false} deleteKeyCode={null} fitViewOptions={{ padding: 0.12 }} proOptions={{ hideAttribution: true }}
    >
      <Background gap={28} size={1} color="var(--line)" />
      <Controls showInteractive={false} position="bottom-right" />
      <Panel position="top-left" className={`star-map-canvas-hint${connectingFromId ? " is-connecting" : ""}`}><span aria-live="polite">{connectingFromId ? `正在从 ${connectingFromId} 连线：拖到目标左侧 ●` : lastConnection ? `已连接 ${lastConnection}` : "左键框选 · 中键平移 · 从右侧 ＋ 拖出连线"}</span><small>滚轮缩放 · Alt 拖拽复制 · Delete 删除 · Ctrl+Z 撤销</small></Panel>
      <Panel position="top-right" className="star-map-toolbar">
        <button type="button" onClick={() => zoomOut()} aria-label="缩小">−</button><output>{Math.round(zoom * 100)}%</output><button type="button" onClick={() => zoomIn()} aria-label="放大">+</button>
        <button type="button" className="star-map-fit" onClick={() => fitView({ padding: 0.12 })}>适配</button>
        <span className="star-map-create-group" aria-label="新建画布内容">
          <button type="button" className="star-map-create-button" onClick={() => createAtViewportCenter("node")}>+ 节点</button>
          <button type="button" className="star-map-create-button" onClick={() => createAtViewportCenter("gate")}>+ 闸口</button>
          <button type="button" className="star-map-create-button" onClick={() => createAtViewportCenter("station")}>+ 站</button>
        </span>
      </Panel>
    </ReactFlow>
    {contextMenu && <div className="star-map-context-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
      {contextMenu.kind === "pane" && <><button type="button" onClick={() => { createAtViewportCenter("node"); setContextMenu(null); }}>新建节点</button><button type="button" onClick={() => { createAtViewportCenter("gate"); setContextMenu(null); }}>新建闸口</button><button type="button" onClick={() => { createAtViewportCenter("station"); setContextMenu(null); }}>新建站</button></>}
      {contextMenu.kind === "node" && <><button type="button" onClick={() => { onDuplicateItems(contextMenu.ids); setContextMenu(null); }}>复制节点</button><button type="button" onClick={() => { onConvertNode(contextMenu.ids[0]); setContextMenu(null); }}>转为闸口</button><button type="button" onClick={() => { onMarkNodeUpdated(contextMenu.ids); setContextMenu(null); }}>标记有更新</button><div role="separator" /><button type="button" className="is-danger" onClick={() => { onDeleteItems(contextMenu.ids); setContextMenu(null); }}>删除节点</button></>}
      {contextMenu.kind === "station" && <><button type="button" onClick={() => { onRenameStation(contextMenu.ids[0]); setContextMenu(null); }}>重命名站</button><button type="button" className="is-danger" onClick={() => { onDeleteItems(contextMenu.ids); setContextMenu(null); }}>删除站</button></>}
      {contextMenu.kind === "edge" && menuEdgeAnchor && <button type="button" onClick={() => restoreStationAnchor(menuEdgeId)}>恢复默认锚定</button>}
      {contextMenu.kind === "edge" && menuEdgeIsStationLink && <button type="button" className="is-danger" onClick={() => { removeEdges([menuEdgeId]); setContextMenu(null); }}>删除站间连线</button>}
      {contextMenu.kind === "selection" && <><button type="button" disabled={!menuNodeIds.length} onClick={() => { onDuplicateItems(menuNodeIds); setContextMenu(null); }}>复制选中节点</button><button type="button" disabled={!menuNodeIds.length} onClick={() => { onAutoArrange(menuNodeIds); setContextMenu(null); }}>自动排序</button><button type="button" disabled={!menuNodeIds.length} onClick={() => { onCreateStationFromSelection(menuNodeIds); setContextMenu(null); }}>创建站</button><button type="button" disabled={!menuNodeIds.length} onClick={() => { onMarkNodeUpdated(menuNodeIds); setContextMenu(null); }}>标记有更新</button><div role="separator" /><button type="button" className="is-danger" onClick={() => { onDeleteItems(contextMenu.ids); setContextMenu(null); }}>删除选中项</button></>}
    </div>}
  </div>;
}

function PipelineContent() {
  const [state, setState] = useState<PipelineLocalState>(() => loadPipelineState());
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(true);
  const [sidebarWidths, setSidebarWidths] = useState(loadSidebarWidths);
  const sidebarResizeRef = useRef<{ side: "left" | "right"; startX: number; startWidth: number } | null>(null);
  const historyRef = useRef<{ past: PipelineLocalState[]; future: PipelineLocalState[]; restoring: boolean }>({ past: [], future: [], restoring: false });
  const [focusMode, setFocusMode] = useState(false);
  const focusSidebarState = useRef({ left: false, right: true });
  const [demandQuery, setDemandQuery] = useState("");
  const [demandFilter, setDemandFilter] = useState<"all" | Demand["status"]>("all");
  const [demandGroupBy, setDemandGroupBy] = useState<"group" | "status">("group");
  const [selectedDemandIds, setSelectedDemandIds] = useState<string[]>([]);
  const [draggedDemandId, setDraggedDemandId] = useState("");
  const [demandContextMenu, setDemandContextMenu] = useState<{ x: number; y: number; ids: string[] } | null>(null);
  const demand = state.demands.find((item) => item.id === state.selectedDemandId) || state.demands[0];
  const [commentState, setCommentState] = useState<{ demandId: string; items: PipelineComment[] }>(() => ({
    demandId: demand?.id || "",
    items: demand ? loadPipelineComments(demand.id) : [],
  }));
  const flow = useMemo(() => getPipelineFlow(demand?.workflowId), [demand?.workflowId]);
  const stations = useMemo(() => demand ? demandStations(flow, demand) : [], [demand, flow]);
  const nodes = useMemo(() => demand ? demandNodes(flow, demand) : [], [demand, flow]);
  const positions = useMemo(() => {
    const result: Record<string, PipelinePoint> = {};
    [...stations, ...nodes].forEach((item) => { result[item.id] = demand?.positions[item.id] || flow.layout[item.id] || { x: 80, y: 120 }; });
    return result;
  }, [demand, flow, stations, nodes]);
  const selectedNodes = nodes.filter((item) => selectedItemIds.includes(item.id));
  const selectedNode = selectedItemIds.length === 1 ? selectedNodes[0] : undefined;
  const selectedStation = selectedItemIds.length === 1 ? stations.find((item) => item.id === selectedItemIds[0]) : undefined;
  const visibleDemands = useMemo(() => state.demands.filter((item) => {
    const query = demandQuery.trim().toLowerCase();
    const matchesQuery = !query || [item.title, item.summary, item.owner_group, item.groupName, item.bug?.assignee].some((value) => value?.toLowerCase().includes(query));
    return matchesQuery && (demandFilter === "all" || item.status === demandFilter);
  }).sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || a.sortOrder - b.sortOrder), [state.demands, demandFilter, demandQuery]);
  const groupedDemands = useMemo(() => {
    const groups = new Map<string, Demand[]>();
    visibleDemands.forEach((item) => {
      const key = demandGroupBy === "status" ? demandStatusLabel(item) : (item.groupName || getPipelineFlow(item.workflowId).groupName || "未分组");
      groups.set(key, [...(groups.get(key) || []), item]);
    });
    return [...groups.entries()];
  }, [visibleDemands, demandGroupBy]);

  useEffect(() => { try { pluginStorage.setItem(PIPELINE_STORAGE_KEY, JSON.stringify(sanitizePipelineState(state))); } catch { /* 本地缓存失败不阻塞星图。 */ } }, [state]);
  useEffect(() => {
    try { pluginStorage.setItem(SIDEBAR_WIDTHS_STORAGE_KEY, JSON.stringify(sidebarWidths)); } catch { /* 宽度偏好失败不阻塞星图。 */ }
  }, [sidebarWidths]);
  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const resize = sidebarResizeRef.current;
      if (!resize) return;
      const limits = SIDEBAR_WIDTH_LIMITS[resize.side];
      const delta = resize.side === "left" ? event.clientX - resize.startX : resize.startX - event.clientX;
      const width = Math.min(limits.max, Math.max(limits.min, resize.startWidth + delta));
      setSidebarWidths((current) => current[resize.side] === width ? current : { ...current, [resize.side]: width });
    };
    const onPointerUp = () => { sidebarResizeRef.current = null; document.body.style.removeProperty("user-select"); };
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    return () => { document.removeEventListener("pointermove", onPointerMove); document.removeEventListener("pointerup", onPointerUp); };
  }, []);
  useEffect(() => {
    const demandId = demand?.id || "";
    setCommentState((current) => current.demandId === demandId
      ? current
      : { demandId, items: demandId ? loadPipelineComments(demandId) : [] });
  }, [demand?.id]);
  useEffect(() => {
    const dismiss = () => setDemandContextMenu(null);
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);

  const changeState = (change: (current: PipelineLocalState) => PipelineLocalState, options: { history?: boolean } = {}) => setState((current) => {
    const next = change(current);
    if (next === current) return current;
    if (options.history !== false && !historyRef.current.restoring) {
      historyRef.current.past = [...historyRef.current.past, structuredClone(current)].slice(-30);
      historyRef.current.future = [];
    }
    return sanitizePipelineState({ ...next, board: { ...next.board, revision: next.board.revision + 1 } });
  });
  const restoreHistory = (direction: "undo" | "redo") => {
    const history = historyRef.current;
    const source = direction === "undo" ? history.past : history.future;
    if (!source.length) return;
    const target = source[source.length - 1];
    const current = state;
    if (direction === "undo") {
      history.past = source.slice(0, -1);
      history.future = [structuredClone(current), ...history.future].slice(0, 30);
    } else {
      history.future = source.slice(1);
      history.past = [...history.past, structuredClone(current)].slice(-30);
    }
    history.restoring = true;
    setState(sanitizePipelineState(structuredClone(target)));
    history.restoring = false;
    setSelectedItemIds([]);
    setSelectedDemandIds([target.selectedDemandId]);
    setRightCollapsed(false);
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || (event.target instanceof HTMLInputElement) || (event.target instanceof HTMLTextAreaElement) || (event.target instanceof HTMLSelectElement) || (event.target instanceof HTMLElement && event.target.isContentEditable)) return;
      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        restoreHistory(event.shiftKey ? "redo" : "undo");
      } else if (event.key.toLowerCase() === "y") {
        event.preventDefault();
        restoreHistory("redo");
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [state]);
  const updateDemand = (patch: Partial<Demand>) => { if (demand) changeState((current) => ({ ...current, demands: current.demands.map((item) => item.id === demand.id ? { ...item, ...patch } : item) })); };

  const handleCanvasSelectionChange = useCallback((ids: string[]) => {
    setSelectedItemIds((current) => current.length === ids.length && current.every((id, index) => id === ids[index]) ? current : ids);
    if (ids.length) setRightCollapsed(false);
  }, []);

  const enterFocus = () => {
    if (focusMode) return;
    focusSidebarState.current = { left: leftCollapsed, right: rightCollapsed };
    setLeftCollapsed(true); setRightCollapsed(true); setFocusMode(true);
  };
  const exitFocus = () => {
    setFocusMode(false);
    setLeftCollapsed(focusSidebarState.current.left); setRightCollapsed(focusSidebarState.current.right);
  };
  useEffect(() => {
    if (!focusMode) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") exitFocus(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusMode]);
  useEffect(() => {
    if (!focusMode) return;
    const onPipelineExitFocus = () => exitFocus();
    document.addEventListener("pipeline:exit-focus", onPipelineExitFocus);
    return () => document.removeEventListener("pipeline:exit-focus", onPipelineExitFocus);
  }, [focusMode]);


  const updateNode = <K extends keyof NodeOverride>(field: K, value: NodeOverride[K]) => {
    if (!selectedNode || !demand) return;
    const nodeOverrides = { ...demand.nodeOverrides, [selectedNode.id]: { ...demand.nodeOverrides[selectedNode.id], [field]: value } };
    if (field !== "stationId") { updateDemand({ nodeOverrides }); return; }
    const stationId = typeof value === "string" && value ? value : null;
    const stationOverrides = { ...demand.stationOverrides };
    stations.forEach((station) => {
      const ids = (stationOverrides[station.id]?.nodeIds || station.nodeIds).filter((id) => id !== selectedNode.id);
      stationOverrides[station.id] = { ...stationOverrides[station.id], nodeIds: station.id === stationId ? [...ids, selectedNode.id] : ids };
    });
    const target = stationId ? positions[stationId] : undefined;
    const nextPosition = target ? { x: target.x + STATION_PADDING, y: target.y + STATION_HEADER_HEIGHT + (stations.find((station) => station.id === stationId)?.nodeIds.length || 0) * STATION_NODE_GAP } : positions[selectedNode.id];
    updateDemand({ nodeOverrides: { ...nodeOverrides, [selectedNode.id]: { ...nodeOverrides[selectedNode.id], stationId } }, stationOverrides,
      positions: nextPosition ? { ...demand.positions, [selectedNode.id]: nextPosition } : demand.positions });
  };
  const updateNodeDescription = (value: string) => {
    if (!selectedNode || !demand) return;
    const parsed = splitNodeDescription(value);
    const nodeOverrides = {
      ...demand.nodeOverrides,
      [selectedNode.id]: {
        ...demand.nodeOverrides[selectedNode.id],
        description: parsed.description,
        evidence: parsed.evidence,
      },
    };
    updateDemand({ nodeOverrides });
  };
  const updateStation = <K extends keyof StationOverride>(field: K, value: StationOverride[K]) => { if (selectedStation && demand) updateDemand({ stationOverrides: { ...demand.stationOverrides, [selectedStation.id]: { ...demand.stationOverrides[selectedStation.id], [field]: value } } }); };

  const validateNodeStatus = (node: PipelineNode, status: NodeStatus) => {
    if (!demand) return false;
    if (!["pending", "waiting_human"].includes(status)) {
      const blocker = demandTransitions(flow, demand).filter((transition) => transition.toNode === node.id)
        .map((transition) => nodes.find((candidate) => candidate.id === transition.fromNode))
        .find((candidate) => candidate?.kind === "gate" && (candidate.status !== "done" || !isDefined(candidate.approver) || !isDefined(candidate.evidence)));
      if (blocker) { pluginToast(`下游节点必须等待闸口「${blocker.title}」通过。`); return false; }
    }
    if (status === "done" && !isDefined(node.evidence) && !isDefined(node.description)) { pluginToast(`节点「${node.title}」完成前必须填写描述。`); return false; }
    if (status === "done" && node.kind === "gate" && !isDefined(node.approver)) { pluginToast(`闸口「${node.title}」通过前必须填写拍板人。`); return false; }
    return true;
  };
  const updateNodeStatus = (status: NodeStatus) => {
    if (demand && selectedNode && validateNodeStatus(selectedNode, status)) {
      const patch: Partial<Demand> = { nodeStates: { ...demand.nodeStates, [selectedNode.id]: status } };
      if (demand.workflowId === "bug-fix" && selectedNode.id === "B04" && demand.bug) {
        const bugStatus: BugStatus = status === "done" ? "已关闭" : (status === "failed" || demand.bug.status === "已关闭") ? "重新打开" : demand.bug.status;
        if (bugStatus !== demand.bug.status) patch.bug = {
          ...demand.bug, status: bugStatus,
          history: [...demand.bug.history, { status: bugStatus, at: new Date().toISOString(), content: status === "done" ? "测试验证通过，问题已关闭。" : "测试验证未通过，退回开发。" }],
        };
      }
      updateDemand(patch);
    }
  };
  const updateBulkNodes = (patch: { status?: NodeStatus; owner?: string; description?: string }) => {
    if (!demand || selectedNodes.length < 2) return;
    if (patch.status && selectedNodes.some((node) => !validateNodeStatus(node, patch.status!))) return;
    const nodeOverrides = { ...demand.nodeOverrides };
    selectedNodes.forEach((node) => { nodeOverrides[node.id] = { ...nodeOverrides[node.id], ...(patch.owner !== undefined ? { owner: patch.owner } : {}), ...(patch.description !== undefined ? { description: patch.description } : {}) }; });
    updateDemand({ nodeOverrides, nodeStates: patch.status ? { ...demand.nodeStates, ...Object.fromEntries(selectedNodes.map((node) => [node.id, patch.status])) } : demand.nodeStates });
  };

  const updateBugStatus = async (status: BugStatus) => {
    if (!demand?.bug || demand.bug.status === status) return;
    const content = (await pluginPrompt("填写本次状态改动内容", `状态改为${status}`))?.trim();
    if (content) updateDemand({ bug: { ...demand.bug, status, history: [...demand.bug.history, { status, at: new Date().toISOString(), content }] } });
  };
  const updateBug = <K extends keyof NonNullable<Demand["bug"]>>(field: K, value: NonNullable<Demand["bug"]>[K]) => { if (demand?.bug) updateDemand({ bug: { ...demand.bug, [field]: value } }); };

  const addComment = (targetType: PipelineCommentTargetType, targetId: string, content: string) => {
    if (!demand) return;
    setCommentState((current) => {
      const existing = current.demandId === demand.id ? current.items : loadPipelineComments(demand.id);
      const next = [...existing, {
        id: `comment-${crypto.randomUUID()}`,
        targetType,
        targetId,
        author: state.board.currentUserId,
        content,
        createdAt: new Date().toISOString(),
      } satisfies PipelineComment];
      savePipelineComments(demand.id, next);
      return { demandId: demand.id, items: next };
    });
  };

  const selectDemand = (id: string, event?: ReactMouseEvent<HTMLButtonElement>) => {
    const additive = Boolean(event?.metaKey || event?.ctrlKey);
    setSelectedDemandIds((current) => additive ? (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]) : [id]);
    changeState((current) => ({ ...current, selectedDemandId: id }), { history: false }); setSelectedItemIds([]); setRightCollapsed(false); setDemandContextMenu(null);
  };
  const addDemand = () => {
    const next = { ...createDemand("新建星轨", state.board.ownerGroup), sortOrder: Math.max(-1, ...state.demands.map((item) => item.sortOrder)) + 1 };
    changeState((current) => ({ ...current, selectedDemandId: next.id, demands: [...current.demands, next] }));
    setSelectedItemIds([]); setSelectedDemandIds([next.id]); setRightCollapsed(false);
  };

  const addItem = (kind: "station" | "node" | "gate", position: PipelinePoint) => {
    if (!demand) return;
    if (kind === "station") {
      const id = `station-${crypto.randomUUID()}`;
      const station: PipelineStation = { id, kind: "station", title: "新建站", subtitle: "待补充", description: "待补充", nodeIds: [] };
      updateDemand({ customStations: [...demand.customStations, station], positions: { ...demand.positions, [id]: position } });
      setSelectedItemIds([id]); setRightCollapsed(false); return;
    }
    const id = `node-${crypto.randomUUID()}`;
    const isGate = kind === "gate";
    const node: PipelineNode = {
      id, kind: isGate ? "gate" : "node", stationId: null, title: isGate ? "新建闸口" : "新建节点",
      status: isGate ? "waiting_human" : "pending", owner: "", owner_group: demand.owner_group,
      description: "待补充", trigger: [isGate ? "人工" : "事件"], execution: isGate ? "being+人" : "being",
      gateRole: isGate ? "custom" : undefined, options: isGate ? ["通过", "退回"] : undefined,
      defaultOption: isGate ? "待补充" : undefined, requires_human_review: isGate,
      assigned_user: isGate ? state.board.currentUserId : undefined,
    };
    updateDemand({ customNodes: [...demand.customNodes, node], positions: { ...demand.positions, [id]: position } });
    setSelectedItemIds([id]); setRightCollapsed(false);
  };

  const deleteItems = (ids: string[]) => {
    if (!demand || !ids.length) return;
    const locked = [...nodes, ...stations].filter((item) => ids.includes(item.id) && item.locked);
    const deletable = ids.filter((id) => !locked.some((item) => item.id === id));
    if (locked.length) pluginToast(`已跳过 ${locked.length} 个结构锁定项。`);
    if (!deletable.length) return;
    const deletingStations = new Set(stations.filter((station) => deletable.includes(station.id)).map((station) => station.id));
    const deletingNodes = new Set(nodes.filter((node) => deletable.includes(node.id)).map((node) => node.id));
    const nodeOverrides = { ...demand.nodeOverrides };
    nodes.filter((node) => node.stationId && deletingStations.has(node.stationId)).forEach((node) => { nodeOverrides[node.id] = { ...nodeOverrides[node.id], stationId: null }; });
    const stationOverrides = { ...demand.stationOverrides };
    stations.forEach((station) => { stationOverrides[station.id] = { ...stationOverrides[station.id], nodeIds: (stationOverrides[station.id]?.nodeIds || station.nodeIds).filter((id) => !deletingNodes.has(id)) }; });
    updateDemand({
      nodeOverrides, stationOverrides,
      customNodes: demand.customNodes.filter((item) => !deletingNodes.has(item.id)),
      customStations: demand.customStations.filter((item) => !deletingStations.has(item.id)),
      deletedNodeIds: [...new Set([...demand.deletedNodeIds, ...deletingNodes])],
      deletedStationIds: [...new Set([...demand.deletedStationIds, ...deletingStations])],
      stationLinks: demand.stationLinks.filter((link) => !deletingStations.has(link.fromStationId) && !deletingStations.has(link.toStationId)),
    });
    setSelectedItemIds([]); setRightCollapsed(true);
  };

  const duplicateItems = (ids: string[], options: { offset?: number; select?: boolean } = {}) => {
    if (!demand) return;
    const sourceNodes = nodes.filter((node) => ids.includes(node.id));
    if (!sourceNodes.length) return;
    const mapping = new Map(sourceNodes.map((node) => [node.id, `node-${crypto.randomUUID()}`]));
    const offset = options.offset ?? 24;
    const copies = sourceNodes.map((node) => ({ ...structuredClone(node), id: mapping.get(node.id)!, title: `${node.title} 副本`, locked: false, reviewCode: undefined }));
    const nextPositions = { ...demand.positions };
    copies.forEach((copy, index) => {
      const source = positions[sourceNodes[index].id] || { x: 80, y: 120 };
      nextPositions[copy.id] = { x: source.x + offset, y: source.y + offset };
    });
    const stationOverrides = { ...demand.stationOverrides };
    stations.forEach((station) => {
      const appended = sourceNodes.filter((node) => node.stationId === station.id).map((node) => mapping.get(node.id)!);
      stationOverrides[station.id] = { ...stationOverrides[station.id], nodeIds: [...(stationOverrides[station.id]?.nodeIds || station.nodeIds), ...appended] };
    });
    const copiedTransitions = demandTransitions(flow, demand).flatMap((transition) => transition.toNode && mapping.has(transition.fromNode) && mapping.has(transition.toNode) ? [{ ...transition, id: `custom-edge-${crypto.randomUUID()}`, fromNode: mapping.get(transition.fromNode)!, toNode: mapping.get(transition.toNode)! }] : []);
    updateDemand({ customNodes: [...demand.customNodes, ...copies], positions: nextPositions, stationOverrides, customTransitions: [...demand.customTransitions, ...copiedTransitions] });
    if (options.select !== false) { setSelectedItemIds(copies.map((item) => item.id)); setRightCollapsed(false); }
  };

  const convertNode = (id: string) => {
    const node = nodes.find((item) => item.id === id);
    if (!demand || !node || node.locked || node.kind === "gate") return;
    updateDemand({ nodeOverrides: { ...demand.nodeOverrides, [id]: { ...demand.nodeOverrides[id], kind: "gate", gateRole: "custom", requires_human_review: true, assigned_user: state.board.currentUserId } }, nodeStates: { ...demand.nodeStates, [id]: "waiting_human" } });
  };
  const markNodesUpdated = (ids: string[]) => {
    if (!demand) return;
    const nodeOverrides = { ...demand.nodeOverrides };
    nodes.filter((node) => ids.includes(node.id)).forEach((node) => { nodeOverrides[node.id] = { ...nodeOverrides[node.id], update_seq: (node.update_seq || 0) + 1 } ; });
    updateDemand({ nodeOverrides });
  };
  const renameStation = async (id: string) => {
    const station = stations.find((item) => item.id === id);
    if (!station || !demand) return;
    const title = (await pluginPrompt("站名称", station.title))?.trim();
    if (title) updateDemand({ stationOverrides: { ...demand.stationOverrides, [id]: { ...demand.stationOverrides[id], title } } });
  };

  const autoArrange = (ids: string[]) => {
    if (!demand) return;
    const selected = nodes.filter((node) => ids.includes(node.id));
    const nextPositions = { ...demand.positions };
    const transitions = demandTransitions(flow, demand);
    const stationGroups = new Map<string, PipelineNode[]>();
    selected.filter((node) => node.stationId).forEach((node) => stationGroups.set(node.stationId!, [...(stationGroups.get(node.stationId!) || []), node]));
    stationGroups.forEach((members, stationId) => {
      const order = serialOrder(members.map((node) => node.id), transitions, nodes.map((node) => node.id));
      const origin = positions[stationId] || { x: 80, y: 120 };
      order.forEach((id, index) => { nextPositions[id] = { x: origin.x + STATION_PADDING, y: origin.y + STATION_HEADER_HEIGHT + index * STATION_NODE_GAP }; });
    });
    const free = selected.filter((node) => !node.stationId);
    const freeOrder = serialOrder(free.map((node) => node.id), transitions, nodes.map((node) => node.id));
    const startX = free.length ? Math.min(...free.map((node) => positions[node.id]?.x || 80)) : 80;
    const startY = free.length ? Math.min(...free.map((node) => positions[node.id]?.y || 120)) : 120;
    freeOrder.forEach((id, index) => { nextPositions[id] = { x: startX + index * (NODE_WIDTH + FREE_NODE_GAP), y: startY }; });
    updateDemand({ positions: nextPositions });
  };

  const createStationFromSelection = (ids: string[]) => {
    if (!demand) return;
    const members = nodes.filter((node) => ids.includes(node.id));
    if (!members.length) return;
    const id = `station-${crypto.randomUUID()}`;
    const minX = Math.min(...members.map((node) => positions[node.id]?.x || 80));
    const minY = Math.min(...members.map((node) => positions[node.id]?.y || 120));
    const stationPosition = { x: minX - STATION_PADDING, y: minY - STATION_HEADER_HEIGHT };
    const station: PipelineStation = { id, kind: "station", title: "新建站", subtitle: "由选中节点创建", nodeIds: members.map((node) => node.id) };
    const stationOverrides = { ...demand.stationOverrides };
    stations.forEach((current) => { stationOverrides[current.id] = { ...stationOverrides[current.id], nodeIds: (stationOverrides[current.id]?.nodeIds || current.nodeIds).filter((nodeId) => !ids.includes(nodeId)) }; });
    const nodeOverrides = { ...demand.nodeOverrides };
    members.forEach((node) => { nodeOverrides[node.id] = { ...nodeOverrides[node.id], stationId: id }; });
    updateDemand({ customStations: [...demand.customStations, station], positions: { ...demand.positions, [id]: stationPosition }, stationOverrides, nodeOverrides });
    setSelectedItemIds([id]); setRightCollapsed(false);
  };

  const groupSelectedDemands = async () => {
    if (selectedDemandIds.length < 2) return;
    const name = (await pluginPrompt("分组名称", "新分组"))?.trim();
    if (name) changeState((current) => ({ ...current, demands: current.demands.map((item) => selectedDemandIds.includes(item.id) ? { ...item, groupName: name } : item) }));
    setDemandContextMenu(null);
  };
  const renameDemand = async (id: string) => {
    const item = state.demands.find((entry) => entry.id === id);
    const title = item && (await pluginPrompt("星轨名称", item.title))?.trim();
    if (title) changeState((current) => ({ ...current, demands: current.demands.map((entry) => entry.id === id ? { ...entry, title } : entry) }));
    setDemandContextMenu(null);
  };
  const duplicateDemand = (id: string) => {
    const source = state.demands.find((item) => item.id === id);
    if (!source) return;
    const copy = { ...structuredClone(source), id: `star-track-${crypto.randomUUID()}`, title: `${source.title} 副本`, pinned: false, unread: true, sortOrder: Math.max(-1, ...state.demands.map((item) => item.sortOrder)) + 1 };
    changeState((current) => ({ ...current, demands: [...current.demands, copy], selectedDemandId: copy.id }));
    setSelectedDemandIds([copy.id]); setSelectedItemIds([]); setDemandContextMenu(null);
  };
  const togglePinnedDemand = (id: string) => { changeState((current) => ({ ...current, demands: current.demands.map((item) => item.id === id ? { ...item, pinned: !item.pinned } : item) })); setDemandContextMenu(null); };
  const markDemandUnread = (id: string) => { changeState((current) => ({ ...current, demands: current.demands.map((item) => item.id === id ? { ...item, unread: true } : item) })); setDemandContextMenu(null); };
  const deleteSelectedDemands = async () => {
    if (!selectedDemandIds.length || selectedDemandIds.length >= state.demands.length || !await pluginConfirm(`删除选中的 ${selectedDemandIds.length} 条星轨？`)) return;
    const remaining = state.demands.filter((item) => !selectedDemandIds.includes(item.id));
    changeState((current) => ({ ...current, demands: remaining, selectedDemandId: remaining[0].id }));
    setSelectedDemandIds([remaining[0].id]); setSelectedItemIds([]); setRightCollapsed(false); setDemandContextMenu(null);
  };

  const moveDemand = (targetId: string | undefined, targetGroup: string) => {
    if (!draggedDemandId) return;
    changeState((current) => {
      const moving = current.demands.find((item) => item.id === draggedDemandId);
      if (!moving) return current;
      const remaining = current.demands.filter((item) => item.id !== draggedDemandId);
      const index = targetId ? remaining.findIndex((item) => item.id === targetId) : remaining.length;
      remaining.splice(index < 0 ? remaining.length : index, 0, { ...moving, groupName: targetGroup });
      return { ...current, demands: remaining.map((item, order) => ({ ...item, sortOrder: order })) };
    });
    setDraggedDemandId("");
  };
  const demandDragOver = (event: ReactDragEvent) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; };
  const startSidebarResize = (side: "left" | "right", event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    sidebarResizeRef.current = { side, startX: event.clientX, startWidth: sidebarWidths[side] };
    document.body.style.userSelect = "none";
  };

  const bulkOwner = selectedNodes.length && selectedNodes.every((node) => node.owner === selectedNodes[0].owner) ? selectedNodes[0].owner : "";
  const bulkDescription = selectedNodes.length && selectedNodes.every((node) => node.description === selectedNodes[0].description) ? selectedNodes[0].description : "";
  const contextDemand = demandContextMenu ? state.demands.find((item) => item.id === demandContextMenu.ids[0]) : undefined;
  const selectedStationNodes = selectedStation ? nodes.filter((node) => node.stationId === selectedStation.id) : [];
  const selectedStationDone = selectedStationNodes.filter((node) => node.status === "done").length;
  const selectedTarget = selectedNode
    ? { type: "node" as const, id: selectedNode.id }
    : selectedStation
      ? { type: "station" as const, id: selectedStation.id }
      : null;
  const targetComments = selectedTarget && commentState.demandId === demand?.id
    ? commentState.items.filter((comment) => comment.targetType === selectedTarget.type && comment.targetId === selectedTarget.id)
    : [];
  const nextNodeAction = selectedNode
    ? demand?.workflowId === "bug-fix" && selectedNode.id === "B04"
      ? selectedNode.status === "running"
        ? { label: "测试通过并关闭", status: "done" as NodeStatus }
        : selectedNode.status === "failed"
          ? { label: "退回开发", status: "ready" as NodeStatus }
          : nextNodeActions[selectedNode.status]
      : nextNodeActions[selectedNode.status]
    : null;

  return <section id="pipeline-view" className={`view${focusMode ? " pipeline-focus-mode" : ""}`} aria-label="星图" onContextMenuCapture={(event) => event.preventDefault()}>
    <header className="pipeline-page-toolbar" aria-label="星图常驻功能栏">
      <button type="button" className="pipeline-rail-toggle pipeline-rail-toggle-left" onClick={() => setLeftCollapsed((value) => !value)} aria-label={leftCollapsed ? "展开左侧星轨栏" : "收起左侧星轨栏"} aria-expanded={!leftCollapsed} title={leftCollapsed ? "展开星轨" : "收起星轨"}>
        <RailToggleIcon direction={leftCollapsed ? "right" : "left"} testId="pipeline-left-rail-icon" />
      </button>
      <input className="pipeline-toolbar-search" type="search" value={demandQuery} onChange={(event) => setDemandQuery(event.target.value)} placeholder="搜索星轨…" aria-label="搜索星轨" />
      <div className="pipeline-toolbar-filters" aria-label="筛选星轨">
        <select value={demandFilter} onChange={(event) => setDemandFilter(event.target.value as typeof demandFilter)} aria-label="按状态筛选"><option value="all">全部状态</option>{Object.entries(demandStatusLabels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}</select>
        <select value={demandGroupBy} onChange={(event) => setDemandGroupBy(event.target.value as typeof demandGroupBy)} aria-label="星轨分组方式"><option value="group">按分组</option><option value="status">按状态</option></select>
      </div>
      <div className="pipeline-toolbar-actions">
        <PipelineConnections context={`星轨：${demand ? demandDisplayTitle(demand) : '未选择'}\n${selectedNode ? `节点：${selectedNode.title}\n状态：${selectedNode.status}\n说明：${selectedNode.description}` : '未选择节点'}`} />
        <button type="button" className="pipeline-toolbar-button pipeline-focus-button" onClick={focusMode ? exitFocus : enterFocus} aria-pressed={focusMode}>{focusMode ? "退出专注" : "专注"}</button>
      </div>
      <button type="button" className="pipeline-rail-toggle pipeline-rail-toggle-right" onClick={() => setRightCollapsed((value) => !value)} aria-label={rightCollapsed ? "展开右侧详情栏" : "收起右侧详情栏"} aria-expanded={!rightCollapsed} title={rightCollapsed ? "展开详情" : "收起详情"}>
        <RailToggleIcon direction={rightCollapsed ? "left" : "right"} testId="pipeline-right-rail-icon" />
      </button>
    </header>
    <div className={`pipeline-shell star-map-shell${leftCollapsed ? " left-collapsed" : ""}${rightCollapsed ? " right-collapsed" : ""}${focusMode ? " is-focus-mode" : ""}`} style={{ "--pipeline-left": `${leftCollapsed ? 0 : sidebarWidths.left}px`, "--pipeline-right": `${rightCollapsed ? 0 : sidebarWidths.right}px` } as CSSProperties}>
      <aside className={`pipeline-demands${leftCollapsed ? " is-collapsed" : ""}`} aria-label="星轨">
        {!leftCollapsed && <div className="pipeline-sidebar-resize-handle pipeline-sidebar-resize-handle-left" role="separator" aria-orientation="vertical" aria-label="调整左侧星轨栏宽度" onPointerDown={(event) => startSidebarResize("left", event)} />}
        {!leftCollapsed && <>
          <div className="pipeline-sidebar-heading"><div><span className="pipeline-kicker">STAR TRACKS</span><h2>星轨</h2></div><span className="pipeline-count">{state.demands.length}</span></div>
          <button type="button" className="pipeline-demand-create-button" onClick={addDemand}>+ 新建星轨</button>
          <div className="pipeline-demand-list">{groupedDemands.map(([group, items]) => <div className="pipeline-demand-group" key={group} onDragOver={demandDragOver} onDrop={() => demandGroupBy === "group" && moveDemand(undefined, group)}><span className="pipeline-demand-group-title">{group} <small>{items.length}</small></span>{items.map((item) => <button type="button" draggable key={item.id} className={`pipeline-demand-item${item.id === demand?.id ? " selected" : ""}${selectedDemandIds.includes(item.id) ? " multi-selected" : ""}${item.pinned ? " is-pinned" : ""}`} aria-pressed={selectedDemandIds.includes(item.id)} onDragStart={(event) => { setDraggedDemandId(item.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", item.id); }} onDragEnd={() => setDraggedDemandId("")} onDragOver={demandDragOver} onDrop={(event) => { event.stopPropagation(); moveDemand(item.id, item.groupName || group); }} onClick={(event) => selectDemand(item.id, event)} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); const ids = selectedDemandIds.includes(item.id) ? selectedDemandIds : [item.id]; setSelectedDemandIds(ids); setDemandContextMenu({ x: event.clientX, y: event.clientY, ids }); }}><span className="pipeline-demand-dot" data-status={item.status} />{item.unread && <span className="pipeline-demand-unread" title="未读" />}<span className="pipeline-demand-copy"><strong>{item.pinned && <span aria-label="已置顶">⌃ </span>}{demandDisplayTitle(item)}</strong><small>{item.groupName || "未分组"} · {item.owner_group}</small></span></button>)}</div>)}</div>
          {demandContextMenu && <div className="pipeline-demand-context-menu" role="menu" style={{ left: demandContextMenu.x, top: demandContextMenu.y }} onPointerDown={(event) => event.stopPropagation()}><button type="button" onClick={() => renameDemand(demandContextMenu.ids[0])}>重命名</button><button type="button" onClick={() => duplicateDemand(demandContextMenu.ids[0])}>复制项目</button><button type="button" onClick={() => togglePinnedDemand(demandContextMenu.ids[0])}>{contextDemand?.pinned ? "取消置顶" : "置顶"}</button><button type="button" onClick={() => markDemandUnread(demandContextMenu.ids[0])}>标记为未读</button><div role="separator" /><button type="button" onClick={groupSelectedDemands} disabled={demandContextMenu.ids.length < 2}>成组</button><button type="button" className="is-danger" onClick={deleteSelectedDemands} disabled={demandContextMenu.ids.length >= state.demands.length}>删除星轨</button></div>}
        </>}
      </aside>
      <section className="pipeline-main" aria-label="星图画布">
        <ReactFlowProvider><PipelineCanvas demand={demand} flow={flow} stations={stations} nodes={nodes} positions={positions} currentUserId={state.board.currentUserId} selectedItemIds={selectedItemIds} onDemandChange={changeState} onSelectionChange={handleCanvasSelectionChange} onCreateItem={addItem} onDeleteItems={deleteItems} onDuplicateItems={duplicateItems} onToast={pluginToast} onConvertNode={convertNode} onMarkNodeUpdated={markNodesUpdated} onRenameStation={renameStation} onAutoArrange={autoArrange} onCreateStationFromSelection={createStationFromSelection} /></ReactFlowProvider>
      </section>
      <aside className={`pipeline-inspector${rightCollapsed ? " is-collapsed" : ""}`} aria-label="节点详情">
        {!rightCollapsed && <div className="pipeline-sidebar-resize-handle pipeline-sidebar-resize-handle-right" role="separator" aria-orientation="vertical" aria-label="调整右侧详情栏宽度" onPointerDown={(event) => startSidebarResize("right", event)} />}
        {!rightCollapsed && <>
          <div className="pipeline-inspector-heading"><div><span className="pipeline-kicker">DETAILS</span><h2>详情</h2></div>{selectedItemIds.length > 0 && <code>{selectedItemIds.length > 1 ? `${selectedItemIds.length} 项` : selectedItemIds[0]}</code>}</div>
          <div className="pipeline-inspector-body">
            {selectedNodes.length > 1 && <>
              <section className="pipeline-detail-core">
                <div className="pipeline-detail-identity"><span>批量选择</span><strong>{selectedNodes.length} 个节点</strong></div>
                <label className="pipeline-detail-description">描述<textarea rows={6} value={bulkDescription} placeholder="多值 / 待补充" onChange={(event) => updateBulkNodes({ description: event.target.value })} /></label>
                <div className="pipeline-detail-meta">
                  <label>状态<select defaultValue="" onChange={(event) => { if (event.target.value) updateBulkNodes({ status: event.target.value as NodeStatus }); event.currentTarget.value = ""; }}><option value="">批量修改</option>{NODE_STATUSES.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></label>
                  <label>负责人<input value={bulkOwner} placeholder="多值 / 待补充" onChange={(event) => updateBulkNodes({ owner: event.target.value })} /></label>
                </div>
                <div className="pipeline-next-actions"><span>下一步</span><button type="button" className="secondary" onClick={() => autoArrange(selectedNodes.map((node) => node.id))}>自动排序</button><button type="button" className="secondary" onClick={() => createStationFromSelection(selectedNodes.map((node) => node.id))}>创建站</button></div>
                <button type="button" className="pipeline-delete" onClick={() => deleteItems(selectedItemIds)}>删除选中项</button>
              </section>
            </>}
            {selectedNodes.length <= 1 && !selectedNode && !selectedStation && demand && <>
              <section className="pipeline-detail-core">
                <div className="pipeline-detail-identity"><span>星轨</span><label>任务名称<input value={demand.title} onChange={(event) => updateDemand({ title: event.target.value })} /></label></div>
                <label className="pipeline-detail-description">描述<textarea rows={7} value={demand.bug ? demand.bug.details : demand.summary} placeholder="待补充" onChange={(event) => demand.bug ? updateBug("details", event.target.value) : updateDemand({ summary: event.target.value })} /></label>
                <div className="pipeline-detail-meta"><span><b>状态</b>{demandStatusLabel(demand)}</span><span><b>负责人</b>{demand.owner_group || "待补充"}</span></div>
                <div className="pipeline-next-actions"><span>下一步</span><button type="button" className="secondary" onClick={enterFocus}>专注处理此星轨</button></div>
              </section>
              <details className="pipeline-more-info"><summary>更多信息</summary><div>
                <label>分组<input value={demand.groupName || ""} placeholder="未分组" onChange={(event) => updateDemand({ groupName: event.target.value || undefined })} /></label>
                {demand.bug && <><label>优先级<select value={demand.bug.priority} onChange={(event) => updateBug("priority", event.target.value as NonNullable<Demand["bug"]>["priority"])}>{["P0", "P1", "P2", "P3"].map((priority) => <option key={priority} value={priority}>{priority}</option>)}</select></label><label>经办人<input value={demand.bug.assignee} placeholder="待补充" onChange={(event) => updateBug("assignee", event.target.value)} /></label><label>附件<input value={demand.bug.attachments.join(", ")} placeholder="多个附件用逗号分隔" onChange={(event) => updateBug("attachments", event.target.value.split(",").map((item) => item.trim()).filter(Boolean))} /></label><label>Bug 状态<select value={demand.bug.status} onChange={(event) => updateBugStatus(event.target.value as BugStatus)}>{BUG_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}</select></label><div className="pipeline-history"><strong>状态变更记录</strong>{demand.bug.history.slice().reverse().map((entry, index) => <div key={`${entry.at}-${index}`}><b>{entry.status}</b><time>{entry.at ? new Date(entry.at).toLocaleString() : "待记录"}</time><span>{entry.content}</span></div>)}</div></>}
              </div></details>
            </>}
            {selectedStation && <>
              <section className="pipeline-detail-core">
                <div className="pipeline-detail-identity"><span>站</span><label>名称<input value={selectedStation.title} onChange={(event) => updateStation("title", event.target.value)} /></label></div>
                <label className="pipeline-detail-description">描述<textarea rows={7} value={selectedStation.description || selectedStation.subtitle} placeholder="待补充" onChange={(event) => updateStation("description", event.target.value)} /></label>
                <div className="pipeline-detail-meta"><span><b>状态</b>{selectedStationNodes.length ? `${selectedStationDone}/${selectedStationNodes.length} 已完成` : "空站"}</span><span><b>负责人</b>由站内节点分别负责</span></div>
                <div className="pipeline-next-actions"><span>下一步</span><button type="button" className="secondary" disabled={!selectedStationNodes.length} onClick={() => autoArrange(selectedStationNodes.map((node) => node.id))}>{selectedStationNodes.length ? "整理站内节点" : "站内暂无节点"}</button></div>
              </section>
              <details className="pipeline-more-info"><summary>更多信息</summary><div><label>副标题<input value={selectedStation.subtitle} onChange={(event) => updateStation("subtitle", event.target.value)} /></label><button type="button" className="pipeline-delete" disabled={Boolean(selectedStation.locked)} onClick={() => deleteItems(selectedItemIds)}>{selectedStation.locked ? "结构规则锁定，不可删除" : "删除当前站"}</button></div></details>
              <CommentSection key={`station:${selectedStation.id}`} comments={targetComments} currentUserId={state.board.currentUserId} onSubmit={(content) => addComment("station", selectedStation.id, content)} />
            </>}
            {selectedNode && <>
              {demand && <NodeTaskPanel key={`${demand.id}:${selectedNode.id}`} nodeKey={`${demand.id}:${selectedNode.id}`} onApply={updateNodeStatus} />}
              <section className="pipeline-detail-core">
                <div className="pipeline-detail-identity"><span>{selectedNode.kind === "gate" ? "闸口" : "普通节点"}</span><label>名称<input value={selectedNode.title} onChange={(event) => updateNode("title", event.target.value)} /></label></div>
                <label className="pipeline-detail-description">描述<textarea rows={8} value={nodeDescriptionValue(selectedNode)} placeholder="填写节点说明与完成证据" onChange={(event) => updateNodeDescription(event.target.value)} /></label>
                <div className="pipeline-detail-meta"><label>状态<select value={selectedNode.status} onChange={(event) => updateNodeStatus(event.target.value as NodeStatus)}>{NODE_STATUSES.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></label><label>负责人<input value={selectedNode.owner} placeholder="待补充" onChange={(event) => updateNode("owner", event.target.value)} /></label></div>
                {nextNodeAction && <div className="pipeline-next-actions"><span>下一步</span><button type="button" className="secondary" onClick={() => updateNodeStatus(nextNodeAction.status)}>{nextNodeAction.label}</button></div>}
              </section>
              <details className="pipeline-more-info"><summary>更多信息</summary><div>
                <label>类型<select value={selectedNode.kind} disabled={Boolean(selectedNode.locked)} onChange={(event) => updateNode("kind", event.target.value as NodeOverride["kind"])}><option value="node">普通节点</option><option value="gate">闸口</option></select></label>
                <label>审核/操作分配给<input value={selectedNode.assigned_user || ""} placeholder="未分配" onChange={(event) => updateNode("assigned_user", event.target.value)} /></label>
                {selectedNode.kind === "gate" && <label>拍板人<input value={selectedNode.approver || ""} placeholder="待补充" onChange={(event) => updateNode("approver", event.target.value)} /></label>}
                <dl className="pipeline-facts"><div><dt>执行主体</dt><dd>{selectedNode.execution || "待补充"}</dd></div><div><dt>触发</dt><dd>{selectedNode.trigger.join(" / ") || "待补充"}</dd></div><div><dt>退出证据</dt><dd>{selectedNode.evidenceLevel || "待补充"}</dd></div></dl>
                <button type="button" className="secondary" onClick={() => markNodesUpdated([selectedNode.id])}>标记有更新</button>
                <button type="button" className="pipeline-delete" disabled={Boolean(selectedNode.locked)} onClick={() => deleteItems(selectedItemIds)}>{selectedNode.locked ? "结构规则锁定，不可删除" : "删除当前节点"}</button>
              </div></details>
              <CommentSection key={`node:${selectedNode.id}`} comments={targetComments} currentUserId={state.board.currentUserId} onSubmit={(content) => addComment("node", selectedNode.id, content)} />
            </>}
          </div>
        </>}
      </aside>
    </div>
  </section>;
}

export function Pipeline() { return <PipelineContent />; }

export { NODE_STATUSES };
