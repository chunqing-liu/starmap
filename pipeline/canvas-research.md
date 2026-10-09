# 星图 V7：开源画布工具借鉴研究

> 研究用途：为星图 V7 提供交互、信息架构和流程表达的可借鉴清单。本文件只新增研究文档，不修改产品代码。
>
> 现状基线：已先阅读 `desktop/renderer/pipeline/page.tsx`、`pipeline/v6-design.md`、`pipeline/v6-hotfix-requirements.md`。用户描述中的 V6 文档实际位于仓库根目录 `pipeline/`，不是 `desktop/renderer/pipeline/`；以下引用均以实际路径为准。

## 研究范围与资料快照

本次重点看三件事：连接的命中与修复体验、左侧任务/组管理、节点和组合语法。优先使用上游源码和官方文档，尽量不把 demo 的视觉效果误当成产品契约。参考仓库按 `git clone --depth 1` 放在 `C:\Users\chunqing.liu\heart-portal\workspace\.research\`，未加入产品仓库。

| 对象 | 快照 | 本次重点证据 |
| --- | --- | --- |
| React Flow / xyflow | `xyflow` @ `159995fe7af2` | `packages/react/src/types/component-props.ts`；`packages/system/src/xyhandle/XYHandle.ts`、`utils.ts`；`examples/react/src/examples/Validation`、`ReconnectEdge`、`EasyConnect`、`Layouting`、`Subflow` |
| Node-RED | `node-red` @ `1e85f1efbc88` | `packages/node_modules/@node-red/editor-client/src/js/ui/view.js`；`src/js/ui/workspaces.js` |
| tldraw | `tldraw` @ `38818faca63f` | `packages/editor/src/lib/editor/Editor.ts`；`options.ts`；SelectTool pointing/dragging states；`HistoryManager`；SnapManager |
| Rete.js | `rete` @ `2aae19950180` | `src/editor.ts`、`src/presets/classic.ts`；官方 history/area/selectable/connection 文档 |
| LiteGraph.js / ComfyUI | `litegraph` @ `0555a2f2a3df`、`comfyui-frontend` @ `590718b9caee` | `src/litegraph.js`；ComfyUI `rerouteNode.ts`、`groupNode.ts`；`docs/architecture/CANVAS-GESTURE-0029-pointer-gesture-state-machine.md` |
| n8n | `n8n` @ `9dfcef628bf1` | `WorkflowCard.vue`、`features/core/folders/FolderCard.vue`、`WorkflowsView.vue`、`features/collaboration/projects/ProjectNavigation.vue`、`features/core/folders/useFolders.ts`、`features/core/folders/folders.types.ts` |
| archify | `archify` @ `9e35d2b0b39b` | `README_ZH.md`、`archify/SKILL.md`、`archify/renderers/workflow/README.md`、`examples/*.workflow.json`、`examples/*.lifecycle.json` |

---

## 1. 画布节点连接

### 1.1 业界标准做法

#### A. 命中区不是“节点矩形”，而是可预测的端口区域

- **React Flow** 把 `connectionRadius` 定义为端口周围允许放下连线的半径，默认值是 20；`reconnectRadius` 是已有边端点附近的重连半径，默认值是 10。实现会在屏幕指针对应的 flow 坐标附近找最近 Handle，并优先处理指针下实际存在的 DOM Handle（`packages/system/src/xyhandle/utils.ts`、`XYHandle.ts`）。因此命中区应随缩放换算，且要把“可见端口”和“最近端口”两种判断统一起来。
- **LiteGraph** 用方向相关的矩形命中区，而不是要求指到一个像素：横向端口通常约为 `10×20`，纵向端口约为 `40×10`；输入端有现有连线时可以在拖动或按 Shift 时进入重连（`src/litegraph.js` 中 `isOverNodeInput`、`isOverNodeOutput` 和 `processMouseDown`）。
- **Node-RED** 对 junction/子流程端口做了额外扩大：触摸或鼠标落点会用约 `30×20` 的区域补偿精确命中困难，并且会把兼容的目标端口加高亮，而不是让整张节点都像目标（`editor-client/src/js/ui/view.js` 的 `portMouseUp`、`portMouseOver`）。
- **tldraw** 的 `hitTestMargin` 与 `coarseHitTestMargin` 是屏幕感知的命中余量，内部除以当前 zoom 后参与几何命中；这保证视觉上“端口/形状周边几像素”在不同缩放级别仍近似一致（`packages/editor/src/lib/editor/Editor.ts`、`options.ts`）。

#### B. 连线是有状态的手势，不是一次 `onConnect`

标准流程可抽象为：

1. **起手判定**：按下必须落在可连接端口，区分点击、拖拽和轻微抖动；React Flow 的 `connectionDragThreshold` 默认 1，ComfyUI 的手势 ADR 则把按下、拖动、抬起写成显式状态机。
2. **拖动预览**：展示从源端口到指针的临时线，并持续计算 `toHandle`、兼容性和方向。React Flow 的 `useConnection()` 可让自定义节点在 `inProgress`、有效目标/无效目标时改变边框与提示；Node-RED 的 `showDragLines` / `JOINING` 状态会将可兼容端口设为 hover。
3. **目标吸附**：先用实际 DOM 端口命中，再用半径寻找最近端口；在可滚动/可缩放画布中自动平移（React Flow `autoPanOnConnect` 默认开启），而不是要求用户把目标完整拖到视口中央。
4. **松手校验**：校验方向、端口类型、重复边、自环、环路、目标是否仍存在、业务是否允许。Node-RED 在 `portMouseUp`/提交连接处还校验输入输出方向、重复连接、junction loop，并处理旧 link 的替换。
5. **失败反馈**：抬起无目标或目标非法时，临时线消失但应留下“未连接/不兼容”的即时反馈；不能静默地让用户猜测是没命中、类型不对还是业务禁止。

#### C. 已连线的重连、删除、批量和撤销要同一套历史模型

- React Flow 原生提供 `onReconnectStart`、`onReconnect`、`onReconnectEnd`、`reconnectRadius`，典型做法是 `reconnectEdge(oldEdge, newConnection, edges)`；边还可以只允许拖源端、拖目标端或两端。
- Node-RED 的连线拖动可以把已有 link 从端口上 detach，再在抬起时提交新 link；删除节点时可选择把被删节点两侧重新接回，并把一次操作写成一个 history event。工作区切换/排序/删除也都有 dirty/history 记录。
- Rete 把历史作为可选插件：经典 preset 可追踪节点增删/移动与连接增删，支持键盘撤销/重做，并按约 200ms 的时间窗口合并连续动作。其 editor core 在真正改动前发出可 veto 的事件，连接插件、区域插件和选择插件可按产品需要组合。
- tldraw 的 HistoryManager 将一次用户操作作为批次，支持 `undo`/`redo`、中断点和拖动中的连续 diff；SelectTool、DraggingHandle 都在手势起止处建立 history stopping point。这个边界比“每一帧坐标都写一条记录”更适合节点编辑器。
- 多选删除、键盘配合通常包含 Delete/Backspace、Ctrl/Cmd+Z、Ctrl/Cmd+Shift+Z（或 Ctrl/Cmd+Y）、复制/粘贴和方向键微移；Rete selectable guide、tldraw SelectTool、Node-RED `deleteSelection` 都把多选作为一等操作，而非循环调用单节点删除。

可核对的上游入口：

- React Flow 属性定义：[`component-props.ts`](https://github.com/xyflow/xyflow/blob/159995fe7af2/packages/react/src/types/component-props.ts#L430-L682)；重连示例：[`ReconnectEdge`](https://github.com/xyflow/xyflow/blob/159995fe7af2/examples/react/src/examples/ReconnectEdge/index.tsx)；验证示例：[`Validation`](https://github.com/xyflow/xyflow/blob/159995fe7af2/examples/react/src/examples/Validation/index.tsx)；交互反馈：[`EasyConnect/CustomNode.tsx`](https://github.com/xyflow/xyflow/blob/159995fe7af2/examples/react/src/examples/EasyConnect/CustomNode.tsx)。
- Node-RED 端口交互：[`view.js`](https://github.com/node-red/node-red/blob/1e85f1efbc88/packages/node_modules/@node-red/editor-client/src/js/ui/view.js#L4099-L4579)；删除/历史：同文件 [`deleteSelection`](https://github.com/node-red/node-red/blob/1e85f1efbc88/packages/node_modules/@node-red/editor-client/src/js/ui/view.js#L3639-L3719)。
- tldraw 命中与历史：[`Editor.ts`](https://github.com/tldraw/tldraw/blob/38818faca63f/packages/editor/src/lib/editor/Editor.ts#L5843-L5921)、[`HistoryManager.ts`](https://github.com/tldraw/tldraw/blob/38818faca63f/packages/editor/src/lib/editor/managers/HistoryManager/HistoryManager.ts)。
- Rete 官方 API：[history plugin](https://retejs.org/docs/api/rete-history-plugin/)、[area plugin](https://retejs.org/docs/api/rete-area-plugin/)、[selectable guide](https://retejs.org/docs/guides/selectable/)。

### 1.2 星图现状差距（对照 `page.tsx` 实码）

| 观察 | 证据 | 判断 |
| --- | --- | --- |
| 端口命中有半径，但视觉端口没有独立的大命中层 | `page.tsx:147–166` 每种自定义节点各一个左右 `Handle`，`page.tsx:431–462` 设 `connectionRadius={48}` | 已有半径不是完整方案；半径以 Handle 中心为基准，短线/缩放/被遮挡节点仍可能难命中。 |
| 连接流程只有开始和结束文本 | `page.tsx:431–462` 的 `onConnectStart` 设连接中提示，`onConnectEnd` 仅清理提示 | 没有 `useConnection` 式有效/无效目标预览、自动平移、松手失败原因和目标吸附状态。 |
| 业务校验过于宽松 | `page.tsx:369–386` 的 `onConnect` 只拒绝同一节点，其余直接写 station link 或“手动连接” | 没有重复边、方向、环路、端口类型、站点关系约束；失败只能在数据层或后续运行时暴露。 |
| 重连 API 没有接入 | `page.tsx:431–462` 无 `onReconnect`/`onReconnectStart`/`onReconnectEnd` | 已有边无法拖端点改连，用户只能删除后重新连。 |
| 删除不能形成统一历史事务 | `page.tsx:351–367` 处理 `onEdgesChange` 的 remove，键盘监听 `page.tsx:406–416` 只处理 Delete；没有 undo/redo | 边删除可发生，但节点、边、列表移动、复制、重连之间没有可回退的命令批次；也没有 Backspace、Ctrl/Cmd+Z/Y。 |
| 连接线类型还有已知警告 | `page.tsx:458` 使用 `ConnectionLineType.Bezier`；`pipeline/v6-hotfix-requirements.md` 已记录 `bezier` 非内置类型警告 | V7 应先统一到 `default`/`straight`/`step`/`smoothstep` 或自定义线类型，避免把警告当成无害日志。 |
| 目标需完整进入视口才容易吸附 | 当前只通过 React Flow 原生命中和节点 Handle，未设置 `autoPanOnConnect`/目标态反馈；`page.tsx:431–462` 也未做视口边缘补偿 | 与用户反馈“目标节点必须完整进入视口”一致；机制上既有 Handle 可见性/DOM 命中问题，也有没有自动平移和目标态提示的问题，不能只继续放大一个常数。 |

### 1.3 可借鉴改动建议

1. 为每个输入/输出端口增加视觉端口之外的透明命中层，目标是约 44–64 CSS px 的可操作区域；随 zoom 做屏幕尺寸换算，保留 `connectionRadius` 作为第二层最近端口兜底。
2. 把连接写成显式状态：`idle → pressed → dragging → valid/invalid → committed/cancelled`，在 `onConnectStart`、`onConnect`、`onConnectEnd` 中只提交一次业务命令；节点用 `useConnection()` 或等价状态显示“可放置/不可放置”。
3. 开启并验证 `autoPanOnConnect`，目标靠近视口边缘时自动平移；不要把“完整露出节点”作为吸附前提。短距离约 100px 的回归用例应覆盖 25%、50%、100%、200% zoom 和目标部分出视口。
4. 接入 `onReconnect` + `reconnectEdge`，保留 edge id 和业务 transition id 的映射；根据边类型配置只允许拖源端、只允许拖目标端或两端。
5. 在 `isValidConnection` 中集中做同节点、重复边、输入/输出方向、站点类型、环路和已删除对象校验，并让 `onConnectEnd` 携带失败原因或可见 toast/节点提示。
6. 让边可选中、可右键删除，支持多边和节点混选后一次删除；把节点、边、列表排序/跨组移动、复制、重连纳入同一可撤销事务，至少实现 Ctrl/Cmd+Z 与 Ctrl/Cmd+Shift+Z。

---

## 2. 左侧列表项目管理

### 2.1 业界标准做法

#### A. 信息架构：资源层级、计数和状态必须同时可读

- **n8n** 把个人/共享项目、文件夹和 workflow 分开建模；文件夹卡片显示名称、只读标记、workflow 数和子文件夹数，并通过面包屑/父文件夹表达位置。工作流卡片把打开、分享、收藏、复制、移动到文件夹、归档/取消归档、删除等动作按权限与资源状态计算，而不是固定塞满菜单（`WorkflowCard.vue`、`FolderCard.vue`、`folders.types.ts`）。
- n8n 的拖拽不是“改一个 `groupName` 字符串”：`useFolders.ts` 维护被拖对象类型、当前 drop target、禁止自包含移动、文件夹/项目目标差异，并在资源层发出 move/duplicate/delete 事件；搜索、状态、归档、标签、项目也都是可组合过滤条件（`WorkflowsView.vue`）。
- **Node-RED** 的 workspace/tab 同时有默认命名、双击重命名、变更徽标、启用/禁用、锁定、导出、移动到开头/末尾、隐藏其他/全部显示、删除等上下文菜单。删除最后一个或锁定 workspace 时，菜单项会禁用；排序/切换会同步 active workspace、URL hash、标题和 dirty/history。
- 常见列表标准因此是：组/项目有数量计数，任务有最近修改/未保存/收藏等状态，菜单按当前对象与权限裁剪；新建、命名、复制和删除都要能从行内按钮、右键菜单或快捷键到达，但不能让每个入口产生不同数据语义。

可核对的上游入口：

- n8n [`WorkflowCard.vue`](https://github.com/n8n-io/n8n/blob/9dfcef628bf1/packages/frontend/editor-ui/src/app/components/WorkflowCard.vue)、[`FolderCard.vue`](https://github.com/n8n-io/n8n/blob/9dfcef628bf1/packages/frontend/editor-ui/src/features/core/folders/components/FolderCard.vue)、[`useFolders.ts`](https://github.com/n8n-io/n8n/blob/9dfcef628bf1/packages/frontend/editor-ui/src/features/core/folders/composables/useFolders.ts)、[`folders.types.ts`](https://github.com/n8n-io/n8n/blob/9dfcef628bf1/packages/frontend/editor-ui/src/features/core/folders/folders.types.ts)、[`WorkflowsView.vue`](https://github.com/n8n-io/n8n/blob/9dfcef628bf1/packages/frontend/editor-ui/src/app/views/WorkflowsView.vue)、[`ProjectNavigation.vue`](https://github.com/n8n-io/n8n/blob/9dfcef628bf1/packages/frontend/editor-ui/src/features/collaboration/projects/components/ProjectNavigation.vue)。
- Node-RED [`workspaces.js`](https://github.com/node-red/node-red/blob/1e85f1efbc88/packages/node_modules/@node-red/editor-client/src/js/ui/workspaces.js#L56-L485)。

### 2.2 星图现状差距（对照 `page.tsx` 实码）

- 当前 `Demand` 通过 `groupName` 表示所属组，列表没有 folder/project/workflow 的嵌套资源模型；`page.tsx:489–519` 只有查询、状态、分组开关、已选任务和上下文菜单状态。
- `addDemand` 在 `page.tsx:607–611` 直接以 `createDemand("新建任务", state.board.ownerGroup)` 添加并选中；它符合“默认新建到默认组”的方向，但没有命名框，也没有显式保证左侧只保留一条默认任务。产品反馈“新建旁边不需要出现任务名称”应落实为按钮只显示“新建”，默认任务名在创建后可从重命名入口修改，而不是把名称放进按钮文案。
- 列表行在 `page.tsx:781–789` 有拖动、搜索、状态筛选、分组显示、选择、收藏/未读视觉、右键菜单；但 `moveDemand`（`page.tsx:763–774`）本质是重排数组并改 `groupName`，没有 n8n 式显式 drop target、跨层级约束、自包含防护或拖拽中的目标高亮。
- 右键菜单已有重命名、复制、置顶、未读、分组、删除；缺少归档/恢复、导出、权限/锁定语义，且菜单动作没有统一 history/dirty 记录。列表操作会立即写 localStorage（`page.tsx:521–531`），所以目前没有可感知的“未保存态/保存中/保存失败”状态。
- `selectDemand` 支持 Ctrl/Meta 多选并清除画布选中（`page.tsx:602–606`），画布点击又能更新外部选择；这是联动基础，但没有键盘上下移动、列表与画布双向聚焦、从列表打开选中节点或多任务批量操作。

### 2.3 可借鉴改动建议

1. 先收敛 V7 的最小信息架构：`默认组 → 任务` 两层即可；新建按钮只显示“新建”，无额外任务名，自动落到默认组；仍允许从行内/右键重命名。
2. 把拖拽目标建模为明确的 `folder | task`，拖入组显示高亮和落点，禁止拖进自身/子孙；移动、排序和跨组移动统一生成一条可撤销操作。
3. 保留当前搜索与状态筛选，再补充组范围、置顶和未读过滤；搜索无结果时给出清除筛选和新建入口，不改变当前选中任务。
4. 统一右键菜单集合：打开/重命名/复制/移动到组/置顶/标记已读/归档（若启用）/删除；根据锁定、默认任务、未保存和选中数量动态禁用危险项。
5. 加入列表与画布的焦点联动：列表行 Enter 打开/聚焦画布，画布选中任务回显列表，多选删除和复制在两侧有一致反馈。
6. 如果 V7 仍使用 localStorage，至少区分“本地草稿已写入”和“当前视图有未提交变更”；若不需要显式保存，则在产品文案中明确是自动保存，避免伪造一个永远不可靠的保存按钮。

---

## 3. 流程节点形式与组合形式

### 3.1 业界标准做法

#### A. 节点种类是语义类型，不只是不同颜色的卡片

- **React Flow** 的 subflow example 用 `parentId`、`extent: 'parent'`、`expandParent` 将节点放入可折叠/可扩展容器；Layouting example 把 dagre 布局作为独立的节点位置计算步骤，而不是把每个节点手写偏移。节点类型、容器边界、自动布局和连接校验彼此解耦。
- **Rete.js** 将 editor core、area、connection、selection、history、自动布局/插件拆分。节点和 socket 是语义对象，`Input.multipleConnections` 默认 false、`Output.multipleConnections` 默认 true；这类端口容量约束在数据模型层表达，而非只依靠视觉。
- **LiteGraph/ComfyUI** 有可复用的 group、subgraph、reroute。ComfyUI 的 reroute node 可沿链路传播类型并在不兼容时断开；group 可“按节点适配尺寸”、选中组内节点或改变组模式。它们都是降低长边、重叠和复杂分支认知负担的组合原语。
- 节点状态通常通过徽标/颜色/图标表达：运行中、成功、等待人工、失败、重试、禁用等；状态不应取代节点类型，而应作为第二个视觉维度。

#### B. 分支、并行和异常路径要有结构

- 业界画布普遍把条件分支画成网关/条件节点，把并行路径放进组或 lane，用边标签表达条件；异常、重试、人工等待等路径要与主路径有稳定的视觉区别，而不是让所有边只显示一条同样的曲线。
- 自动布局常见 dagre/ELK：布局输入是节点大小、边和层级约束，输出位置；用户手动微调后应能保留位置，重新布局最好只作用于选中子图或明确的布局命令。
- 模板/复用一般分三层：复制当前图、复制为可再次插入的模板、把一组节点封装成子流程；三者要区分“复制数据”与“引用同一模板”的语义。

可核对的上游入口：

- React Flow [`Subflow`](https://github.com/xyflow/xyflow/blob/159995fe7af2/examples/react/src/examples/Subflow/index.tsx)、[`Layouting`](https://github.com/xyflow/xyflow/blob/159995fe7af2/examples/react/src/examples/Layouting/index.tsx)。
- Rete 官方概念与基础指南：[editor](https://retejs.org/docs/concepts/editor/)、[basic](https://retejs.org/docs/guides/basic/)、[selectable connections example](https://retejs.org/examples/selectable-connections/)。
- LiteGraph [`src/litegraph.js`](https://github.com/jagenjo/litegraph.js/blob/0555a2f2a3df/src/litegraph.js)；ComfyUI [`rerouteNode.ts`](https://github.com/Comfy-Org/ComfyUI_frontend/blob/590718b9caee/src/extensions/core/rerouteNode.ts)、[`groupNode.ts`](https://github.com/Comfy-Org/ComfyUI_frontend/blob/590718b9caee/src/extensions/core/groupNode.ts)。

### 3.2 星图现状差距（对照 `page.tsx` 实码）

- 当前主要是 item/station 两种自定义节点；station 是独立数组和矩形容器，并非 React Flow `parentId` 子图。`page.tsx:256–295` 会把 station link 动态映射到站内首/尾节点，折叠更多是视图投影，不是有输入/输出边界的真正子流程。
- `page.tsx:369–386` 的 transition 主要携带 `event: "手动连接"` 或模型事件，缺少条件分支、并行 join/split、等待/重试/失败等一等语义；视觉上也没有 gateway、异常 lane 或边标签规范。
- 节点上已有注意点/未读等徽标（`page.tsx:157–166`、`803` 附近），但状态与节点类别、生命周期没有统一类型字典或图例；用户很难仅靠颜色判断“类型”和“当前状态”的区别。
- `autoArrange`（`page.tsx:698–716`）是基于稳定拓扑顺序的轻量排布，不是 dagre/ELK：没有节点尺寸、边交叉、组边界、并行分支、异常回路的布局约束，也没有“只整理选中子图”的模式。
- 目前有复制节点/任务和从选择创建 station（`page.tsx:658–733`），但没有模板、子流程复用、reroute、注释/说明节点；大型图会继续依赖长边和站点矩形来承载语义。

### 3.3 可借鉴改动建议

1. 建立最小类型字典：`task`、`subflow`、`group`、`annotation`、`gateway`（与现有 `kind: 'gate'` 的“人工审核”语义分开），另以 `status` 表示 running/success/waiting/retry/failure/disabled；先让数据模型能区分，再决定视觉。
2. 将 station 演进为可折叠 subflow：拥有输入/输出边界端口，折叠时隐藏内部节点但保留边界和数量/状态摘要，展开时恢复内部布局与选择。
3. 为条件分支、并行 split/join、人工等待和异常/重试路径定义结构化字段与边标签；主路径、分支、异常边使用稳定但克制的视觉编码。
4. 用 dagre 或 ELK 替换/并列现有稳定拓扑排布，先支持“整理选中子图 + fit view”，保留手动位置作为覆盖值；不要一上来强制全图自动布局。
5. 增加 comment/annotation 和 reroute 原语：注释承载解释，reroute 负责把长边拆成可读链；二者不参与业务执行，避免把辅助视觉误当成任务。
6. 在复制之外增加“保存为模板/从模板插入”，模板插入时重映射节点与 transition id；仅复制数据的动作继续保持一次性副本语义。

---

## 4. archify 专节

### 4.1 它是什么

archify（[`tt-a1i/archify`](https://github.com/tt-a1i/archify/tree/9e35d2b0b39b)）不是一个面向终端用户的自由绘图编辑器，而是一个“把技术意图编译成可沟通图”的 agent skill/渲染器：输入带 schema 的 Typed JSON IR，按 architecture、workflow、sequence、data-flow、lifecycle 路由到对应渲染器，经过 schema/语义/布局检查后输出可独立打开的 HTML。它强调源证据、可验证的中间表示、语义交互和交付收据，目标是让架构/流程图可阅读、可分享、可追溯，而不是提供 n8n 式实时编排。

主要入口：[`README_ZH.md`](https://github.com/tt-a1i/archify/blob/9e35d2b0b39b/README_ZH.md)、[`SKILL.md`](https://github.com/tt-a1i/archify/blob/9e35d2b0b39b/archify/SKILL.md)、[`workflow renderer README`](https://github.com/tt-a1i/archify/blob/9e35d2b0b39b/archify/renderers/workflow/README.md)。

### 4.2 流程节点形式和组合形式的亮点

1. **类型路由清晰**：不同问题选择不同图型，workflow 不承载 sequence 的时间轴，也不把 data-flow 的边界语义硬塞进普通拓扑图。
2. **workflow 的组合语法比“节点+边”丰富**：
   - `lanes` 表达责任人、运行时或系统边界；
   - `phases` 表达故事阶段；
   - `groups` 表达并行/分支/异常动作的边界；
   - `mainPath` 明确 happy path；
   - exception lane 承载人工等待、拒绝、重试、fallback、失败。
3. **节点类型和视觉编码分离**：示例中可见 `frontend/backend/database/cloud/security/messagebus/external` 等 component type，再用 `default/emphasis/security/dashed` 等 variant 和 tags/sublabels 做第二层编码；生命周期示例把 `start/active/decision/success/waiting/failure` 与 `entry/pause/retryable/terminal` 分开。
4. **边是有语义的路由对象**：边有 label、variant、`fromSide/toSide` 和 `route` preset（drop、outside-right、return-left、bottom-channel、up-channel），不是把所有关系交给几何算法随机穿过节点。
5. **布局合同可验证**：节点用 lane+column 而非裸坐标；同 lane 间距、边与文字间距、端点 stub、转弯内距都有下限；`mainPath`、悬空端点、非法引用等可在渲染前发现。工作流约束还建议控制主节点数量和主路径复杂度，保证一张图能读完。

### 4.3 值得搬到星图的部分

- **语义层/视图层分离**：星图可保留当前 React Flow 的节点坐标和交互状态，但把 `kind/status/role/branch/exception/mainPath` 放入稳定的 flow model；画布只是该模型的一个投影。
- **用 lane/group/mainPath 表达工作流结构**：站点之外，引入责任/阶段泳道、并行组、异常组和主路径标记，能显著减少仅靠颜色与长边猜流程的成本。
- **边和节点的视觉字典**：事件名、条件、重试和人工等待统一成标签/variant/status；提供小型图例，避免每个节点组件自行发明颜色。
- **布局前的轻量语义校验**：检查悬空端口、主路径断裂、条件分支没有出口、并行 join 不完整、循环边缺少 retry/loop 语义；把能直接解释给用户的错误在布局前显示。
- **路由 preset 和自动端口分布**：保留 React Flow 交互，但对返回边、底部通道边、上下游跨 lane 边使用稳定路由 preset，并按端点顺序自动分散端口，减少短边重叠。

### 4.4 不适用的部分

- archify 的固定 schema、布局合同和“渲染前验证”服务于一次性可读 artifact；星图需要持续拖拽、重连、撤销和本地草稿，不能直接把 archify 的 HTML/SVG 坐标当作编辑模型。
- `mainPath`、lane、route preset 可以作为辅助字段，但不应限制用户自由搭建的每一条中间状态；编辑态允许暂时悬空或未完成分支，提交/运行前再做业务校验。
- archify 的示例规模与“保持一张图可读”的约束不适合作为星图硬上限；星图应通过子流程折叠、局部布局和过滤解决大图，而不是简单拒绝更多节点。
- 它没有左侧任务资源管理、权限、实时协作和执行时数据模型；不能替代 n8n/Node-RED 的列表、历史和连接交互。
- 其来源证据/交付检查是 agent artifact 的可信性机制，不应未经具体失败场景就搬成星图的 hash/frozen contract/baseline gate；星图 V7 先复用可读的语义字段和视觉编码即可。

---

## 5. V7 建议清单

> 级别按“先消除当前连接失败和不可恢复操作，再补结构化表达与管理能力”排序；改动面为对 `page.tsx`、节点/边模型、样式和测试的粗估，不是排期承诺。

| 级别 | 建议（一句话） | 预估改动面 |
| --- | --- | --- |
| P0 | 把连接实现成有状态手势，显示有效/无效目标与松手失败原因，并覆盖拖动预览、目标吸附和自动平移。 | 中：`page.tsx` 连接回调、节点状态样式、连接回归用例 |
| P0 | 增大并屏幕化端口命中区，结合 `connectionRadius`/DOM Handle 兜底，解决约 100px 短线和目标部分出视口的失败。 | 中：Handle 结构/CSS、zoom 命中计算、视口边缘测试 |
| P0 | 接入 `onReconnect`/`reconnectEdge`，让已有边可拖源端或目标端改连并保持业务 transition id。 | 中：edge 映射、重连校验、撤销记录 |
| P0 | 为节点/边/列表操作建立事务化历史，至少支持 Delete/Backspace、Ctrl/Cmd+Z、Ctrl/Cmd+Shift+Z 和批量删除。 | 大：状态快照或命令栈、键盘层、所有 mutation 入口 |
| P1 | 把重复边、自环、方向/端口类型、环路、站点关系和已删除对象校验集中到 `isValidConnection`，并返回可理解原因。 | 中：连接域校验、错误提示、模型测试 |
| P1 | 允许边选中、右键删除和多边混选，统一节点/边删除的确认与历史语义。 | 小到中：edge props、上下文菜单、选择状态 |
| P1 | 收敛左侧为“默认组 → 任务”两层，新建按钮只显示“新建”、默认落默认组，并保证默认任务规则明确。 | 小：`addDemand`、列表文案、默认数据迁移 |
| P1 | 将拖拽移动改为显式 `folder/task` drop target，提供跨组高亮、自包含防护和可撤销排序。 | 中：列表拖拽状态、Demand 关系、history |
| P1 | 为任务/站点增加 `task/subflow/group/annotation/gateway` 类型与独立 status 字典，先完成数据和图例再扩展视觉。 | 中到大：schema、节点注册、迁移、图例 |
| P1 | 将 station 演进为带边界端口的可折叠 subflow，折叠显示输入/输出与状态摘要，展开恢复内部选择和布局。 | 大：父子关系、折叠投影、边映射、选择/保存 |
| P1 | 引入条件分支、并行 split/join、人工等待、重试/异常边的结构化字段和稳定标签/variant。 | 中到大：transition model、节点/边渲染、校验 |
| P2 | 用 dagre/ELK 支持“只整理选中子图 + fit view”，保留手动坐标覆盖，不强制全图重排。 | 中：布局适配器、选区投影、位置持久化 |
| P2 | 增加 comment/annotation、reroute 和边标签，降低长边、交叉和解释文本对主流程的干扰。 | 中：新节点类型、边路由、非执行元素存储 |
| P2 | 在复制之外支持保存为模板/从模板插入，插入时重映射节点与 transition id，并保留一次性副本语义。 | 中到大：模板存储、导入映射、列表入口 |
| P2 | 补充列表/画布键盘焦点联动、状态图例和自动保存/本地草稿状态文案，降低“选中了但不知道改没改”的不确定性。 | 中：焦点管理、a11y、draft 状态与恢复提示 |

### 最先落地的三条

1. **P0 连接状态 + 有效/无效反馈 + 自动平移**：直接针对“短距离偶发失败”和“目标必须完整入视口”两条已知痛点，且不要求先重做数据模型。
2. **P0 端口屏幕命中区**：把命中从 Handle 中心的隐式常数变成可测量、可回归的交互契约，优先覆盖不同 zoom 和部分出视口目标。
3. **P0 重连 + 历史事务**：让改错线和撤销成为低成本动作，否则用户会继续通过删除重建，放大当前连接校验不足的风险。

## 研究边界与未完成项

- 未启动 Electron、未执行 npm install、未修改现有产品文件、未提交或推送 Git；`.research` 目录位于工作区上层，作为只读研究快照。
- 本文是源码/官方文档对照，不等同于对每个工具的完整可用性测试；React Flow/Node-RED/Rete 的 API 语义可直接借鉴，n8n/tldraw/LiteGraph/ComfyUI 的部分行为仍需在星图自身模型上做小型原型验证。
- “目标完整进入视口”在现有源码中没有单独的失败事件记录，本文按 React Flow 的 DOM Handle 优先命中、`connectionRadius` 和未启用自动平移的机制解释为高概率原因；V7 应用回归用例确认，而不是继续凭感觉调大半径。
