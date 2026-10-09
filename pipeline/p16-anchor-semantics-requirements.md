# P16 站间直连 + 锚定可手动调 v2（2026-09-24 16:17 醇青拍板，取代 15:5x 初版）

## 背景（用户原话）
> 现在不是有个默认模板吗，你给默认默认模板流程就改成站与站之间直接连接，不用让上一个站的最后节点去连下一个站的第一个节点。站的左侧连站内第一个节点，站内最后一个节点连站的右侧（也就是站的节点和小节点支持连接并且支持手动调）

## 目标语义（改动后的默认视图）
```
S01左 ⇢ N01 → H1 ⇢ S01右 ⟶ S02左 ⇢ N02 → H2 ⇢ S02右 ⟶ … ⟶ S06
```
- ⇢ = 站↔节点锚定虚线（P14 已有，默认取站内第一/最后一个节点）
- ⟶ = 站间紫色连线（P9 已有）
- 跨站节点实线边（H1→N02 等 5 条）从默认模板消失

## 改动点

### 1. 模板数据（models/beings-development.ts + models/schema.ts）
- 删除跨站转移：E02 (H1→N02)、E04 (H2→N03)、E05 (N03→N04)、E08 (H3→N06)、E12 (H4→N08)
- 保留全部站内转移：E01/E03/E06/E07/E09/E10/E11/E13/E14
- schema.ts `PipelineFlow` 增加可选 `stationLinks?: { fromStationId: string; toStationId: string }[]`（种子，无 id）
- 模板 stationLinks：S01→S02→S03→S04→S05→S06（5 条）
- version bump（如 v4-agent-team → v5-station-chain）

### 2. demand 种子 + 存量迁移（models/templates.ts）
- 新建 demand：从 flow.stationLinks 生成 demand.stationLinks（id 用现有 `station-link-${crypto.randomUUID()}` 格式）；blank-star-track 无种子自然为空
- 存量迁移（loadPipelineState/sanitizePipelineState）：`workflowId === "beings-development" && stationLinks.length === 0` → 种入 5 条链
- bug-fix 星轨不动（跨站转移保留）
- 已知取舍（记录在案）：用户手动删光 stationLinks 的存量 demand 会被重新种回

### 3. 锚定手动调整（page.tsx + schema.ts）
- `Demand` 增 `stationAnchors?: Record<string, { start?: string; end?: string }>`（stationId → 节点 id override）
- buildEdges（~397 行锚定边生成处）：目标节点 = override（若该节点仍在站内）?? 派生第一/最后
- 站/节点 anchor 端口去掉 `isConnectable={false}`（page.tsx 216-217、229-230）；anchor 端口加 hover 可见样式（.star-map-anchor-port 现为隐藏，容器 hover 时露出小圆点，别与 ●/＋ 主端口混淆——保持 34%/66% 偏移位）
- onConnect（526 行）：`sourceHandle/targetHandle` 含 `anchor-` 时走锚定分支：
  - station.anchor-output → node.anchor-input：`stationAnchors[station].start = node`（node 必须属于该站，否则 toast「锚定节点须在本站内」并不落库）
  - node.anchor-output → station.anchor-input：`stationAnchors[station].end = node`
  - 锚定连接不落 customTransitions
- 锚定边 deletable/selectable：仅当该站该方向存在 override；派生态维持不可选不可删
- 边删除交互（现状缺口：deleteKeyCode=null 且无边菜单，站间线今天也删不掉）：
  - CanvasMenu 增 kind `"edge"`：右键锚定边（有 override 时）→「恢复默认锚定」；右键站间线 →「删除站间连线」
  - onEdgeContextMenu 接入现有 contextMenu 状态
- removeEdges（507 行）：`station-anchor-` 前缀 id 现在直接丢弃——改为匹配 override 时清对应 override（配合上面的菜单路径）
- 节点被删除/移出站时：清掉指向它的 stationAnchors override（sanitize 或删除路径里做，别留悬空）

### 4. 不动的
- 站↔站 ●/＋ 主端口手动连线 → stationLink（现有 onConnect 逻辑）
- 节点↔节点 → transition（现有）
- 橙框/紫框健康判定（站内转移全保留、stationLinks 语义已对齐，无新增误橙风险；改完自查一遍 stationChainBroken 不误报）
- P9/P10/P11/P13/P15 的已验收行为

## 验收标准（隔离实例 9223，CDP 真输入）
1. fresh 实例默认视图：无跨站节点实线边；6 站紫线链 5 条；每站左虚线→首节点、末节点→右虚线（S03 单节点仅 start）
2. 拖 S02 左侧锚定端口 → H2：虚线改连 H2；右键该虚线 →「恢复默认锚定」→ 回 N02
3. 拖 N02 右侧锚定端口 → S02 右侧：end 锚定变 N02；恢复默认回 H2
4. 旧 localStorage（迁移前数据）加载后：自动出现紫线链、跨站实线边消失
5. P15 回归：站内拖动 nodeIds 顺序不变
6. compact 收起态：紫线链正常显示
7. tsc --noEmit + vite build 通过

## 实现提示
- 锚定边 id 规则保持 `station-anchor-<sid>-start/-end`，override 状态可从 demand.stationAnchors 查
- orderedStationNodes 是唯一的首/尾判定来源（P15 刚修过它不受拖动影响）
- 迁移写在 sanitize/load 层，别写在渲染层
