# P18 拖出连线快速创建（2026-09-29 02:59 醇青经 loom 下达）

## 背景（用户原话）
> 噢给节点那个东西新增一个功能，如果手动拖出节点但松手截至的时候没有连接任何内容则自动弹出创建列表，列表里可选站/节点/闸口，选择其中一个则视为在当前位置新建且自动连上该内容。这个功能用于快速新建并连接，做好之后也要提交到远端（个人分支）。

## 需求语义
从任意可连接 handle 拖出连线，松手时若没有连上任何目标、且落点在空白画布上——在落点弹出创建菜单（站/节点/闸口三项）。选中某项即在落点位置新建对应元素，并自动把刚才拖出的连线接上（方向按拖出的 handle 侧决定）。

## 判定规则
1. **触发条件**（onConnectEnd 时三条全满足才弹菜单）：
   - 本次拖拽没有成功落边（onConnect 成功写边时置 ref 标记，onConnectEnd 查标记后复位；onConnect 的 toast 分支如"空站保留站间连接"没写边，不算成功）；
   - 落点在空白画布：`event.target instanceof Element && event.target.classList.contains("react-flow__pane")`（落在任何节点/站容器上都不弹，即使连接失败也保持现状什么都不发生）；
   - 拖拽源不是站锚定 handle（anchor-*：锚定是站内机制，新元素落在站外接不上锚，不弹菜单）。
2. **菜单**：落点处显示三项：站 / 节点 / 闸口（标签用这三个词，样式与现有 UI 一致）。点击某项 = 新建 + 连线；点击菜单外任意处或按 Esc = 取消，什么都不建。选中或取消后菜单立即关闭。
3. **新建位置**：新元素中心对齐落点（screenToFlowPosition 后减去半宽半高，参照 createAtViewportCenter 的写法）。新建不触发 P17 碰撞避让——落点是用户手指定的。
4. **自动连线方向**：按拖出的 handle 侧决定——
   - 从源 handle（输出侧）拖出：新元素作为 target，边 = 源 → 新元素；
   - 从目标 handle（输入侧）拖出：新元素作为 source，边 = 新元素 → 源。
5. **连线语义与现有 onConnect 完全一致**（复用同款写法，不要另起炉灶）：
   - 节点 → 新节点/闸口：customTransition（id `custom-edge-${uuid}`，event: "拖出创建"）；
   - 站 → 新站：stationLink（P16 语义，id `station-link-${uuid}`）；新站 → 站（反向拖出）同理；
   - 站 → 新节点/闸口：等价现有"站右侧连站内最后一个节点"语义——即 站内最后一个节点 → 新节点 的 customTransition；源站为空站时跳过连线，onToast 提示"空站暂无节点可连"；
   - 节点 → 新站：新站是空站，节点连线接不上（与现有 onConnect 对空站行为一致），跳过连线，onToast 提示；
   - 站锚定 handle（anchor-*）：不触发本功能（见判定规则 1）。
6. **新元素默认值**：完全复用 addItem 现有默认（新建站/新建节点/新建闸口、闸口 waiting_human、选中并打开右栏），不复制逻辑——把 addItem 改为返回新元素 id，PipelineCanvas 拿到 id 后再落边。

## 不做（本期边界）
- 不做菜单内配置名称/属性——建完 addItem 已自动选中并打开右栏，去右栏改。
- 不做拖拽过程中的落点预览（ghost）——松手才弹菜单。
- 不改 connectionDragThreshold、isValidConnection、connectionRadius 等既有连线行为。
- 落在已有节点/站上但连接失败的场景不弹菜单（见判定规则 1）。
- 新建不触发 P17 避让（见判定规则 3）。
- 不 commit、不推远端——验收由醇青侧做。

## 验收要点（隔离实例 CDP，验收方执行）
1. 从某节点输出 handle 拖到空白处松手：菜单出现在落点，三项可见。
2. 选"节点"：新节点中心在松手位置，customTransition 源→新存在，菜单关闭，右栏打开且选中新节点。
3. 选"闸口"：新闸口同上，status=waiting_human，边存在。
4. 拖出后按 Esc / 点菜单外：不新建任何元素，demand 无变化。
5. 从节点输出 handle 拖到空白处选"站"：新站在落点，无边（空站），toast 出现。
6. 从站输出 handle 拖到空白处选"站"：stationLink 源站→新站存在。
7. 从站输出 handle（站内有节点）拖到空白处选"节点"：边 = 站内最后节点 → 新节点。
8. 从节点输入 handle（左侧）拖到空白处选"节点"：边 = 新节点 → 原节点（方向正确）。
9. 拖到已有节点上松手（连接成功）：不弹菜单（回归）。
10. 拖到已有节点上但连接失败（如自环被 isValidConnection 拦）：不弹菜单，无新建。
11. P13/P15/P16/P17 回归：折叠按钮、站内拖动 nodeIds 顺序、锚定连线、碰撞避让不受影响。
12. `npx tsc --noEmit` 通过。

## 实现提示
- onConnectStart 的 params 已含 nodeId/handleType/handleId——记下 handleType（定方向）与 handleId（识别 anchor-*）。
- 落点坐标：MouseEvent 用 clientX/clientY；TouchEvent 用 changedTouches[0]，且 pane 判定改用 document.elementFromPoint（touch 的 target 是起点元素）。
- 菜单是 wrapper 内 DOM 覆盖层，用屏幕坐标定位，视口边缘 clamp 别让它溢出；z-index 高于画布。
- addItem 在 page.tsx:1025 目前返回 void——station 分支和 node 分支都 return id；onCreateItem 透传返回值。
- onConnect 在 page.tsx PipelineCanvas 内（约 602 行），customTransition/stationLink 落边写法照抄它。
