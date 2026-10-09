# 星图 V2 设计（历史）

日期：2026-09-22  
适用端：`portal-desktop`（Electron + React + Vite）  
规则依据：`workspace/pipeline/structure-rules-v0.2.md`  
状态：客户端本地编辑原型已落地；多人协作、服务端存储、真实权限与通知协议尚未实现。

> 引用格式说明：本文用 `§B2.4` 表示规则文档 B2 节第 4 条；用户反馈所称“第 154 条”对应源文第 154 行，即 `§B2.4`。

## A. 协作架构

### A1. 当前通信事实

现有客户端不是 WebSocket/CRDT 协作客户端：

- renderer 只通过 `window.beings` 调用 preload 暴露的受控 IPC。
- `desktop/main/town/client.ts` 是固定路由白名单的 Town REST 客户端，负责查询与发言。
- `desktop/main/town/live.ts` 连接 `/api/client/stream` 的 SSE；它在主进程校验 Town 身份、去重事件，只向 renderer 发布身份和各频道变化计数，不转发消息正文。
- `desktop/main/town/ipc.ts` 在 Town 身份切换时用 generation 使旧请求失效；写操作要求 SSE 已确认 client 身份。
- 当前没有星图 CRUD、通用文档存储、WebSocket、围炉级星图 ACL 或冲突接口。因此 V2 客户端不能只靠复用现有消息接口获得真实协作能力。

### A2. 推荐方案

推荐采用“**Town/BL 服务端持久化 + REST 变更提交 + 现有 SSE 通知 + 定时对账**”，而不是把 `localStorage` 当多人真源。

1. **存储位置**
   - 流程定义、分支、Demand 实例、节点状态、Evidence/Decision 引用、版本和变更事件落在 Town 后端的 BL（Beings 台账）存储。
   - 每个 board 必带 `owner_group/fireside_id`，服务端以当前 Town 身份的围炉成员关系做 ACL。
   - 客户端只留离线缓存；MVP 可继续使用现有 `localStorage` 作单机草稿，但连接协作服务后，服务端 revision 才是协作版本依据。
   - Feishu FS/FD 与 BL 的双记仍遵守 `§D3`：Signal/Demand 产品字段以 Base 为准，Execution/证据/分支版本以 BL 为准；星图存储不改变该裁决边界。

2. **提交与同步**
   - 读取：`GET board/branch snapshot`，返回当前 `revision`、节点/边/任务和调用者权限。
   - 写入：字段级 `PATCH`，携带 `base_revision`、`client_event_id` 和被改字段的旧值；服务端幂等去重，规则与 `§D3.6` 的写前校验、未知响应和幂等一致。
   - 实时通知：沿用 Town SSE，新增只含 `board_id/branch_id/revision/change_kind` 的 `pipeline.changed` 事件；renderer 收到计数后再经 REST 拉增量/快照。敏感正文仍不直接穿过通用 live channel。
   - 对账：SSE 断线、应用恢复前台或固定间隔时按 revision 拉取；MVP 建议在线时 60 秒兜底一次，外部 Base 对账仍保持 `§D3.6` 的默认 5 分钟语义。
   - 高频拖动只在 pointer-up 提交最终坐标；拖动中的每帧只更新本地视图，避免把画布手势变成服务端写放大器。

3. **为何不首选纯轮询、WebSocket 或 Yjs**

| 方案 | 优点 | 主要问题 | 结论 |
|---|---|---|---|
| 纯轮询 | 实现最少，断线恢复直观 | 延迟与请求量互相制约；难以做到“状态实时可见” | 仅作 SSE 兜底 |
| WebSocket | 双向、适合在线成员/光标/高频临时态 | 仓库当前已稳定使用 SSE；为低频字段提交另建长连接会增加认证、重连和幂等路径 | Presence/多人光标成为刚需后再加 |
| CRDT（Yjs） | 并发 shared types 可自动合并，网络层可替换 | 自动合并语义与 `§B2.4/§D3.4` 的“同字段冲突由后提交者负责解决”不一致；还需 provider、持久化、schema migration 和 ACL | 不用于第一版业务状态；将来可只用于长文本协同编辑 |
| REST + SSE + revision | 复用现有安全边界；状态提交可审计、可做字段级 409；断线后能用快照恢复 | 需要 Town/BL 新增专用 API 与事件 | **推荐 MVP** |

Yjs 官方将其定义为可自动同步、自动合并并发修改的 CRDT，而且与网络传输解耦：[Yjs Introduction](https://docs.yjs.dev/)。这些优点适合富文本或白板，但本星图的状态/闸口需要显式审计和人工冲突裁决。

### A3. 权限模型

- 可见范围：board 归属一个 `owner_group/fireside_id`；不在组内不可查询 board、分支、任务或事件。
- 组内成员：默认可创建 Demand、修改节点字段/位置/状态、创建个人分支和 fork；每次写入记录 `actor_town_id`、时间和 before/after。
- 主分支发布：流程维护者检查结构完整性；受影响阶段负责人确认本阶段；改闸口阈值/默认项再由醇青确认，遵守 `§B2.3`。
- 闸口拍板权与“能否编辑卡片”分离：组内编辑者可补材料，但只有配置的 decider/代理可提交 Decision；代理同时记录 `actor` 和 `decider`，遵守 `§C`。
- 负责人为空可保存，但触发前必须进入 `blocked/待分配`，遵守 `§B2.7`。

### A4. 冲突策略

采用字段级乐观并发，不做静默 last-write-wins：

1. 不同字段的并发修改自动合并。
2. 同一字段基于同一旧 revision 被两人修改时，后提交者收到 `409 field_conflict`，由后提交者在“保留对方 / 使用我的 / 手工合并”中解决。
3. 节点坐标视为单一 `position` 字段；拖动冲突同样由后提交者处理，但不影响标题、负责人等其他字段。
4. 冲突未解决前，该字段进入异常中心；已确认的 Evidence、Decision 和历史事件不覆盖。
5. 该策略直接对应 `§B2.4`（源文第 154 行）和 `§D3.4`，而不是简单按服务器到达时间覆盖。

### A5. 最小可行工作量

在已有 Town 身份、SSE 和 IPC 可复用的前提下，协作 MVP 预计 **8–12 人日**：

| 工作项 | 估算 |
|---|---:|
| Town/BL board、branch、task、node、event 存储与 REST API | 3–4 人日 |
| 围炉 ACL、字段级 revision/409、幂等事件 | 2–3 人日 |
| SSE `pipeline.changed`、Electron main/preload 桥接、断线对账 | 1.5–2 人日 |
| renderer 缓存、冲突 UI、同步状态与集成测试 | 1.5–3 人日 |

若服务端无法复用现有围炉成员查询或数据库迁移机制，需另加 **2–4 人日**。若同期把当前自研画布迁移到 React Flow，再加 **2–3 人日**。估算不包含 Feishu 双写、合并工具、Presence/多人光标与离线 CRDT。

## B. 分支协作

### B1. 第一版 fork 行为

- 醇青的 board 为 `main`；组内成员可点击 fork，系统对当前主分支的**流程定义快照**做深复制。
- fork 时必填分支名；默认建议 `<成员>-<目的>`，名称只作展示，不承担权限或唯一主键语义。
- fork 后组内可见、可共同编辑；它不会自动成为主流程，符合 `§B1`“个人分支不能直接设为主流程”。
- Demand 运行数据不随配置 fork 复制。多 DCC/平台交付仍用父 Demand 下的 Deliverable，不能拿个人流程分支表达交付进度，遵守 `§B2.6`。
- 第一版不提供 merge；成员可把分支链接给流程维护者评审。主分支合并工具后置。

### B2. 现在预留的数据

board/branch 至少保留：

```ts
interface PipelineBranch {
  boardId: string
  branchId: string
  branchName: string
  version: string
  sourceBoardId: string
  sourceVersion: string
  parentBranchId?: string
  forkedFromRevision: number
  headRevision: number
  ownerGroup: string
}
```

当前本地模型已保留 `id/name/version/sourceBoardId/sourceVersion/branchName/ownerGroup/revision`；`parentBranchId/forkedFromRevision/headRevision` 在服务端 fork API 落地时补齐。没有来源值时显示“待补充”，不猜测 ID。

### B3. 后续 merge 设计口

- merge 使用 `forkedFromRevision` 的共同祖先做三方比较；同字段双改才报冲突，其他字段自动合并，遵守 `§B2.4`。
- 合并前跑结构校验：5 个产品闸口语义、D 节锁定枚举、H 节转移可达性、14 项能力覆盖和失败出路，遵守 `§B1/§F4/§H3`。
- 主版本发布只默认作用于新实例；运行中实例继续固定 `flow_revision`。迁移时只允许迁移未开始节点，已完成节点与证据不重跑，遵守 `§B2.5`。

## C. 流程机制（待产品侧确认）

### C1. 推荐运行语义

1. **连接是软约束，不是自动执行器**：边只描述允许路径、依赖与建议顺序。系统可按 guard 计算 `ready`，但不会仅因上游完成就自动把下游置 `running/done`。
2. **谁完成谁更新**：执行 being/人显式提交状态、actor、时间和 Evidence/Artifact；普通节点没有达标证据不得 `done`，遵守 `§0.6-0.8/§A2`。
3. **人工闸口硬拦截**：闸口没有 Decision、decider 和达标证据不得标通过，遵守 `§E1-E2`。H1-H4 也采用相同最低机制，但它们的证据等级、超时、退回路径当前规则未定义，统一标“待补充”。
4. **可见异常**：`waiting_human/blocked/failed/timed_out`、阻塞原因、负责人和下一检查时间对组内可见；禁止静默停止，遵守 `§D1/§F`。
5. **就绪通知**：节点首次从 `pending/blocked` 进入 `ready` 时通知下一个 owner being；重复计算 ready 不重复通知。owner 为空则进入待分配并通知流程维护者。
6. **不改写规则真源**：软连接不表示 H 节可以丢弃。允许去向仍须通过发布时的结构校验；运行时由 being 主动提交该去向，而非系统自动推进。

### C2. 还需产品确认的机制问题

| 问题 | 推荐默认 | 原因/规则依据 |
|---|---|---|
| 两个 being 同时改同一节点字段 | 字段级 409；后提交者解决 | `§B2.4/§D3.4` |
| 外部执行的 being 如何回报 | 使用受认证的 Execution API，上报 `started/progress/output_ready/succeeded/failed` 与 evidence refs | 事件枚举见 `§F8`，不能只发自然语言“完成” |
| 节点卡住/超时谁捞 | 先 @节点 owner；owner 空或连续两次超期升级流程维护者 | `§A2/§F/F2` |
| 同一操作响应未知 | 有副作用操作不自动重试，先查回执/转人工 | `§D3.6/§F2` |
| 节点删除后在途实例怎么办 | 定义分支可删；已运行实例固定旧 revision，新版本只影响新实例 | `§B2.5` |
| 父节点与子节点如何聚合 | 子节点默认不自动改父状态；父节点退出条件显式声明必须完成的子节点 | 避免用 UI 层级发明第三套状态 |
| 证据链接失效/越权 | 节点转 `blocked`，异常中心生成“证据过期/不可访问”项 | `§G` 的派生异常口径 |
| 通知风暴 | 只在首次 ready、阻塞升级、闸口出卡、超时触发；按 event id 去重 | 与 `client_event_id` 幂等一致 |
| H3+H4 合并 | 默认仍独立展示；如合并为一次 MR approve，须明确一个 Decision 如何同时满足两点及谁是 decider | 第二版反馈允许合并，但 v0.2 `§0.4/§E1` 明确产品闸口不合卡；两类闸口不能混为一谈 |
| N09/N12 是否可同执行主体 | 默认禁止；确需同人由 G03 明确豁免并记 Decision | `§B2.8` |
| 状态和动作是否混用 | Demand/Node 状态与 Execution 分开存 | `§0.3/§D1` |

## D. 数据模型与无限画布

### D1. 模型

- 画布 item 只有三种：`station | gate | node`。
- `PipelineStation` 管站名、说明和成员节点；`PipelineNode` 管状态、负责人、证据、闸口字段；两者共享稳定 id 和画布 position。
- 普通/闸口节点用 `stationId` 表示站级归属，用可选 `parentNodeId` 表示任意深度父子关系；子节点可独立创建、拖动、改父节点和删除。
- Demand 自身持有流程 revision、custom items、删除集合、字段 overrides 与 positions，因此“星轨关联节点”不是额外弱引用：每个星轨就是一份固定 revision 的节点实例视图。
- 边只保存业务允许路径/依赖；位置与连线分离，拖动节点不会改变流程语义。
- Evidence/Decision 只保存引用与审计字段；没有定义的 owner、execution、evidence level、timeout、failure route 等在 UI 显示“待补充”。

### D2. 画布库比较与建议

| 选项 | 匹配度 | 结论 |
|---|---|---|
| `@xyflow/react`（React Flow） | 原生面向 node/edge；内建拖动、缩放、平移、选择、增删、Controls/Minimap；React 自定义节点直接映射站/闸口/普通节点；支持 sub flows/parentId | **推荐生产版** |
| tldraw | 无限画布、shape/store、父子关系、frame、binding 与多人 sync 很强；但要为业务卡片实现 ShapeUtil、几何、props/migration，并把 tldraw store 再映射到流程领域模型 | 需要通用白板/自由绘制时再选 |
| 当前轻量自研画布 | 无新增依赖，能快速验证长流程、拖动、zoom-to-cursor 和编辑器信息架构 | 仅用于 V2 本地原型；不继续自建选择框、吸附、自动布局、海量节点性能与协作光标 |

React Flow 官方说明其开箱提供节点拖动、缩放、平移、选择与增删，节点就是可自定义 React 组件，并展示 sub flows：[React Flow](https://reactflow.dev/)、[Feature overview](https://reactflow.dev/examples/overview)、[Custom nodes](https://reactflow.dev/examples/nodes/custom-node)。其设计工具交互配置也直接支持“滚轮平移、pinch/Cmd+滚轮缩放”：[Panning and Zooming](https://reactflow.dev/learn/concepts/the-viewport)。

tldraw 的 shape 是带位置、parent、props/meta 的 store record，支持自定义 ShapeUtil、frame-like 容器与拖动重挂父级：[Shapes](https://tldraw.dev/sdk-features/shapes)。它的 sync 客户端使用 WebSocket，且自定义 shapes/bindings 的 schema 与 migration 必须同时配置在客户端和服务端：[tldraw sync](https://tldraw.dev/docs/sync)。能力更广，但超出本星图以业务节点为中心的最小需求。

### D3. 默认模板重排

- 保留 v0.2 的 8 站与 5 个产品闸口；S06 改为“Agent Team 开发与测试”，加入 H1-H4 四张独立人工审核卡。
- 默认路径：`G03 → H1 → (N09 ∥ N10→N11) → H2/H3 汇合 → N12 → N14 → H4 → N15 → G04`。N13 保持失败回修支路。
- 除 v0.2 `§H3` 明确的 N09/N10 真并行外，站、步骤和闸口沿 x 轴串行展开；N13 作为回修支路另起一行。原则是“流程长而非高”。
- 产品闸口 G01-G05 与 H1-H4 都是独立卡片。H3+H4 合并没有默认启用；合并语义、证据和 decider 待产品侧确认。
- H1-H4 只使用任务明确给出的名称与责任 Agent。规则未定义的 input、timeout、failure route、minimum evidence 显示“待补充”。

### D4. 本轮客户端实现边界

已实现：入口更名与聊天输入框底部入口、星轨创建、左右栏折叠、Ctrl/⌘+滚轮及 pinch 的 zoom-to-cursor、Electron/页面两种全屏、站/闸口/普通节点创建、字段编辑、证据约束、删除、自由拖动、任意父子节点、V2 默认布局与分支元数据。

未实现：Town/BL 持久化与 ACL、SSE pipeline 事件、在线成员、服务端冲突、fork API、merge 工具、自动通知、自动 guard/exit 计算、React Flow 迁移。上述能力必须等服务端合同或产品拍板，不在本地 UI 中假装完成。
