# P2 交付说明：真实活动与交接

2026-10-05 · 基于已验收 P1 a68f757 · 本地 feature/office-collab

## 交付纪律与范围

遵循 2026-10-05 21:21 的新纪律：所有 P2 commit 仅在本地，未执行任何 origin / fork push。9223 受保护实例未终止，最终检查仍为 PID 22632；验收均连接 9224，使用独立 userData。本文记录开发自验，不代替人类独立验收。

已实现 main presence 注册表与 IPC、动态身份绑定、真实确认交接、取消/去重/旧 run 保护、正式原因字段和 Being 来源节点状态上报。外部 Town/agent 会话桥接不在 P2 范围；P3 会议、P4 素材替换/安装包/大名册未实施。

## 素材与默认决策

沿用 P1 程序化自产素材：Pixi Graphics 绘制人物、工位与房间，不引入新图片、网络资源或字体。理由是授权边界清晰、离线可靠、颜色与状态表现可控，本期无需新增素材依赖。授权原素材替换仍留 P4。presence 使用 Electron main IPC，不增加服务器事件总线；P1 三位演示伙伴作为初始种子，真实身份通过注册/注销维护。

## 协议与接口

权威类型与校验：desktop/shared/office.ts。main 注册表：desktop/main/office/registry.ts；通道：desktop/main/office/ipc.ts；renderer 订阅客户端：office/presence.ts。

### IPC API

- window.beings.officeSnapshot(): Promise<OfficeSnapshot>：读取 main 当前快照。
- window.beings.onOfficeMessage(callback): disposer：订阅 beings:office-message；组件卸载显式退订。
- window.beings.officeReport(input): Promise<OfficeReceipt>：可信本地顶层 shell 上报。
- window.beings.officeTestInject(input): Promise<OfficeReceipt>：测试入口，只有未打包且 PORTAL_OFFICE_TEST=1 才开放；生产拒绝。

复用现有 mainFrame / webContents / shell URL 来源检查，没有放宽 CSP。此处的 beingId 是可信本地桥接提交的业务身份，不等同于已认证远端身份；后续真实源接入必须实现认证、身份授权与 run 序号分配。

OfficeSnapshot = { sequence, entries, reports }。entries 包含 identity、status、lastSeen、expired、disconnected、summary；reports 是每个 demandId/nodeId 最新节点上报。delta = { kind: 'delta', sequence, snapshot, input? }，携带当前完整业务快照与本次输入。快照没有交接动画历史。

renderer 先订阅、缓冲增量，再获取快照；仅应用比快照新的序号。发现序号缺口重新取快照，跳过缺失期间动画，不补播历史动作。销毁后忽略迟到回调。sequence 与星图 board revision 独立。

### 输入字段

每个输入必填 type、eventId、beingId、runId、runOrder、eventOrder。两个 order 为非负安全整数，调用方对每个 Being 维护单调顺序；runId 用于辨别同序号冲突，不通过字符串大小排序。

| type | 额外字段 | 语义 |
| --- | --- | --- |
| register | identity | 注册/更新唯一 Being |
| unregister | 无 | 注销名册；保留 run 顺序防旧事件复活 |
| presence | status、lastSeen、summary? | working / thinking / idle / offline 实况 |
| disconnect | 无 | 保留末状态和 lastSeen，标断线过期 |
| node | demandId、nodeId、status、reason? | 节点状态与正式原因上报 |
| handoff | toBeingId、handoffId、mode、summary?、durationMs? | visual / business 交接请求 |
| handoff-confirm | handoffId | 接收方独立确认 business 请求 |
| cancel | targetEventId | 撤销本 Being 原事件 |

identity = { id, name, owners, assignedUsers, color, demo }；id 必须与注册输入 beingId 一致。owners / assignedUsers 各最多 20 项，color 是 0..0xffffff。reason 最多 500 字符，summary 最多 160；交接 durationMs 默认 1000，允许 300..30000。

lastSeen 是毫秒时间戳；拒绝比当前记录更早或超过 main 当前时间 5 秒的时间。真实注册行在首次实况前标为等待实况/过期，不伪造在线。非 demo 心跳 30 秒未更新判过期，每秒检查一次；过期不擅自推断离线。断线/过期人物灰化，显示最后更新时间，重连保留快照业务状态。演示种子无真实心跳，不使用此超时规则。

相同 eventId 且载荷相同返回 duplicate，不再次发消息或播放；同 ID 不同载荷返回 EVENT_CONFLICT。旧 run、同 run 非递增事件返回 STALE_RUN。去重历史上限 2048，待交接 512，节点末快照 1000，真实名册上限 100。去重缓存是有界的，不能当跨进程永久事件日志。

Receipt.accepted 只说明 main 通道受理，不代表节点业务修改或闸口批准成功。renderer 会另行检查节点权限、证据和闸口，并在协作舱显示未应用原因。main 注册表在进程生命周期内持有，不新增磁盘 presence 日志。

### 身份关联

owner 或 assigned_user 别名唯一匹配到一个 Being 才绑定；空负责人、重名、多匹配和未注册负责人进入未绑定任务，不自动造人。人工执行节点不因 assigned_user 自动成为 Being 任务。一个业务 beingId 只有一个 actor。

真实注册若沿用演示种子相同别名，需要显式注销/更新种子；不会悄悄覆盖演示身份。名册变更合并到最新目标，当前活动停止并收尾后才重建 runtime；保留同 ID 的工位与世界坐标，新增身份使用空位。同一 Pixi Application 不重建。

## 活动与节点语义

- 长期 working/thinking/idle 仅修改 presentation，实况独立于任务派生状态。演示种子未上报时保持 P1 的状态投影；真实实况优先，不把“有任务”当作在线证据。
- starmap.handoff 依赖 office.visits，复用拜访的导航/资源占用和 520ms 起身坐下、120ms 对齐、480ms 格移动，没有新增定时器动作链。
- visual 交接不会生成接收方“收到”；business 请求先等待接收方 handoff-confirm，确认后才允许展示“收到 · 接收方已确认”。请求方不能替接收方确认，旧请求 run 被替代后确认无效。此确认不自动推进节点、通过闸口或证明交付物已验收。
- 排队命令走 command.cancel，已开始 Activity 走 activity.stop。命令在嵌套 pump 中由 queued 转 running 时重新取得 activityId，避免取消失效。下一项必须等待终态且资源释放；有收尾动作等待 activity.settled。
- 隐藏/离线停止相关交接，丢弃装饰性待播动作；恢复不重放。BUSY/NO_ROUTE 返回一次可见错误，不无限重试或瞬移。
- 状态投影保留 P1 100ms 合并窗口；隐藏停止 tick/绘制。Host 显式释放 runtime、bridge、订阅和 Pixi 资源，单一 tick 推进者。
- PipelineNode / NodeOverride 增加可选 stateReason、stateSource、stateReport，兼容旧数据。blocked / waiting_human 有 reason 就显示，没有仍显示“原因未上报”。来源标为 Being 上报。
- 上报者必须唯一绑定节点负责人；人工审核和闸口不允许 Being 自动 done/skipped。推进还校验前置闸口、approver 与证据；done 使用既有成果描述/证据要求。应用现有 demand 状态聚合，未改造 store。
- 本地修改状态清空 Being 来源与原因，但保留 stateReport 的去重记忆，防止后续 presence 快照把同一旧上报重新应用。

## 与终稿的偏差及源码事实

1. 上游 runtime 仅在需要异步收尾时发 activity.settled；无待收尾动作的终态不必额外发该事件。因此 Host 以“终态且无占用资源”作为已收尾条件，存在收尾动作时仍等待原事件，不制造新事件或等待死锁。
2. 名册重建保留世界坐标，不强制取消后的站立角色瞬移回工位；房间尺寸变化仍可能使相机适配比例变化，不承诺屏幕像素坐标固定。
3. 节点推进权限除了直接 transition，也核对现有 stationLinks 的前置闸口，避免跨站报告绕过审核；这不是办公室审核入口。
4. 为复用既有聚合逻辑，仅把 deriveDemandStatus 提取到 models/status.ts，没有重构存储层。正式 reason/source 是可选字段，未引入新 schema 迁移门槛。
5. 真实 business 确认前保留待请求但不播放拜访，采用保守语义；接收方确认后的拜访只表示确认后的视觉交接，不保证对外消息送达。外部适配器仍按任务书排除。

## 自验结果

| 项目 | 结果 | 运行方式/覆盖 |
| --- | --- | --- |
| TypeScript | PASS | npm run typecheck（tsc --noEmit） |
| renderer build | PASS | npm run build |
| 协作舱单测 | 22/22 PASS，6 文件 | vitest：projection 7、runtime 3、presence 3、handoff 5、client 2、reports 2 |
| P1 UI | 15/15 PASS | node tests/office-ui.mjs，9224 |
| P2 UI | 11/11 PASS | node tests/office-p2-ui.mjs，9224，真实 IPC 测试注入 |
| 既有星图回归 | 48/48 PASS | 原 p18_accept.py 的临时副本仅端口改为 9224；实际视口 1266×880 |
| diff 检查 | PASS | git diff --check |

新增验证包括两人独立实况、重复/旧 run、receiver-only 确认、未确认无假回执、断线灰化及最后更新、快照竞争与断序恢复无补播、动作中名册变更收尾、queued→running 取消、资源释放后续播、BUSY/NO_ROUTE 一次错误、隐藏零 tick、正式原因/来源持久化和禁止办公室过闸口。

回归第一次运行因物理窗口内高 823 导致脚本固定 y=740 落点撞到收起栏，未改产品坐标逻辑；用持续 CDP 视口覆盖为 1266×880 后完整 48/48。原回归脚本未修改。PowerShell 未展开 vitest 通配符的一次启动无测试文件，改为显式枚举文件后 22/22，不记作通过测试。

构建保留既有 outDir 提示、Zod PURE 注释提示和 >500kB chunk 提示，没有打包失败。不声称完成全仓所有测试、P95 性能测量、真实 Town 联调或安装包验证。

## 本地提交

- f2239d6 feat(office): add trusted presence IPC registry and ordered reports
- fd27a9f feat(office): bind real identities and coordinate confirmed handoffs
- 436e04a test(office): verify presence ordering and handoff lifecycle
- d0e0c36 fix(office): cancel handoffs promoted from queued commands
- 本交付说明另以 docs commit 保存；全部仅本地，等待验收后明确推送指令。

原有未跟踪 run-sim.bat 与 %SystemDrive% 目录未纳入交付提交、未删除。

## P3 前待拍板问题

1. 会议参与人进出、主持人/发起人权限，离线/取消时是否结束会议或仅移除参与者；持续会话如何与临时交接共享工位资源。
2. Town/agent 真实源如何认证 Being、分配单调 runOrder/eventOrder，以及进程重启后的顺序恢复；当前仅完成可信本地 IPC，不承诺远端认证。
3. 30 秒 presence 超时是否适用于实际源心跳频率；有任务等待审核但 Being 仍自报 working 时，是否继续采用实况优先（当前如此）。
4. receiver-confirm 的业务定义是接受请求、接收材料还是接管节点；当前只是接收方确认，不自动推进节点、不替代成果证据和人工闸口。
5. 正式 reason/evidence 由真实源提供哪些字段，接入后业务拒绝回执是否需要单独反向通知源（当前 main Receipt 是通道回执，业务拒绝在 UI 展示）。

以上不阻塞 P2 默认实现，P3/P4 仍需各阶段任务书，不自动扩大本次范围。

