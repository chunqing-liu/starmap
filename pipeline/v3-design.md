# 星图 V3 设计决策

日期：2026-09-23  
适用端：`portal-desktop` Electron + React + Vite  
基准：`pipeline/v3-requirements.md`

## 1. 选型

V3 用 `@xyflow/react@12.11.6` 替换 V2 自研 SVG 画布。React Flow 已提供节点拖拽、边缘 Handle 连线、框选、Delete 删除、viewport 缩放/平移、Controls 和 MiniMap；V3 只把业务状态映射到自定义 React 节点，不再维护一套坐标命中、连线绘制和手势实现。

- 滚轮由 React Flow `zoomOnScroll` 处理，缩放锚点跟随光标；触控板 pinch 使用 `zoomOnPinch`。
- 空白左键拖拽由 `panOnDrag` 处理；`selectionOnDrag` 提供框选；Shift+滚轮在画布捕获事件后横向平移。
- 节点和站都提供左右 Handle；React Flow 的 `onConnect` 写入一条本地可删除的自定义连接。
- 全屏继续使用已有主进程 `beings:fullscreen` IPC；外置浏览器新增受控 `beings:open-external` IPC，主进程只接受无凭据的 `http/https` 地址并调用 `shell.openExternal`。生产 `beings://` 页面不显示外置按钮，避免没有可用 Vite 地址时留下半残入口。

## 2. 数据模型

星图只挂一条 `beingsDevelopmentWorkflow`，不再暴露流程选择器或多流程模板概念。数据分为四层：

| 层 | 类型 | 责任 |
| --- | --- | --- |
| 星图 | `PipelineBoardMetadata` | 本地版本、负责人组和 revision |
| 星轨 | `Demand` | 一次交付实例的状态、覆盖项、坐标和自定义连接 |
| 站 | `PipelineStation` | React Flow group 父节点，提供站名、说明和成员节点集合 |
| 节点/审核点 | `PipelineNode` | 具体执行步骤或 H1-H4 人工审核点 |

`Demand.customTransitions` 保存用户新建的连接，`deletedTransitionIds` 保存被删除的默认连接；因此 Delete 删除边不会修改流程定义真源，只影响当前星轨本地实例。V2 旧数据迁移时回到通用默认星轨，避免旧的专用流程继续出现在默认界面。

## 3. 站与节点层级、折叠机制

- 站是 React Flow 的 `parentId` 容器；节点是站的子节点，节点坐标保存为星图世界坐标，渲染时换算成相对父坐标。
- 站卡片固定显示站名和节点完成摘要，例如 `1/3 已完成`。
- `zoom < 0.58` 时站进入 compact 样式，子节点透明且不可交互，跨站边保留；内部边隐藏，视图只呈现一排站卡片。
- `zoom >= 0.58` 时子节点渐显；`zoom >= 0.90` 追加节点说明和连接标签。CSS opacity transition 保证阈值附近不闪跳。
- 跨站连接改用站 ID 作为 React Flow edge 的 source/target；站内连接仍使用节点 ID，且只在展开状态呈现。

## 4. 交互与详情

- 左侧默认只有一个「默认星轨」，「新建星轨」保留；新建星轨使用同一 beings 开发流程。
- 右侧详情初始收起；点击站或节点才滑出，点击空白处收回。
- 工具栏和空白处右键菜单都可以新建节点/站。节点拖入另一站时，在 `onNodeDragStop` 中检测站边界并更新 `stationId`。
- H1-H4 保留为独立 `gateRole=agent_review` 节点；节点状态完成仍要求证据，审核点通过还要求人工拍板人。

## 5. 被替换的 V2 代码

- `desktop/renderer/pipeline/page.tsx`：删除 `CanvasDrag`、SVG path、手写 zoom/pan 命中、卡片 pointer capture 和自研边/父子线渲染，改为 React Flow `ReactFlow`、`Handle`、`onNodesChange`、`onEdgesChange`、`onConnect`。
- `desktop/renderer/pipeline/models/ai-product-workflow.ts`：不再承载反馈/信号专用流程，仅保留兼容导出；实际流程集中到 `beings-development.ts`。
- `desktop/renderer/pipeline/models/templates.ts`：删除模板字典和多流程选择，改为单一默认流程、单一默认星轨和 V2 数据收敛迁移。
- `desktop/renderer/app/styles.css`：新增 `star-map-*` 和 React Flow 覆盖样式；旧 `.pipeline-card`/`.pipeline-canvas-world` 规则保留作为无害兼容样式，不再被 V3 DOM 使用。
- `desktop/renderer/shared/models/scene.ts`、`shared/lib/navigation.ts`、`app/components/navigation.tsx`、`chat/components/navigation.tsx`：入口、页面标题和聊天工具入口统一更名为「星图」。

## 6. 未扩展范围

本版仍是本地可编辑原型；Town/BL 持久化、SSE 同步、多人冲突和服务端权限不在需求包范围内。未引入 hash、冻结 contract 或额外 baseline/gate。
