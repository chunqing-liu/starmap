# P3 交付说明：白板协作与稳态

## 范围与交付纪律

基于已验收 P2 181e0c5，全部工作在本地 feature/office-collab；未执行 origin 或 fork push。本文是开发自验记录，不替代人类独立验收。

实现 2–4 人白板讨论、持续会话、进出与动作收尾、可见性管理、减少动态与按需渲染。沿用程序化 Pixi Graphics 人物、工位、白板与房间；没有引入图片、网络资源或字体。授权素材替换、远端认证、安装包及大名册规模化不属于本期。

本地分阶段提交：
- e7f2fd6：main 持久化顺序分配及会议 IPC。
- f73e5c8：连续白板会话、资源收尾和可见性/渲染策略。
- 172e8ee：会议单测、P3 UI 验收与既有测试观察适配。
- 本文件随后单独提交；最终 commit 见本地 git log。

## 实现要点与五条判据

1. 无瞬移：复用 vendored 导航与移动执行器，到白板和回工位均走路径；没有直接改人物坐标完成到达。进入和返回串行调度，避免多移动者互相堵路。
2. 到场才开始：每位参与者独立 continuous Activity，直到当前所有参与者的最终驻留阶段 ready 才投影为 active；等待、到场、驻留、离开、返回及错误均有等价文字展示。
3. 任意阶段取消：排队命令取消和已启动 Activity 停止分别处理；等实际资源释放才继续下一动作。正常可见退出走回工位；隐藏退出只完成必要的安全收尾，不通过瞬移伪装已回座。旧 runtime 及场景销毁显式退订并释放计时器、ticker、观察器和 Pixi Application。
4. 不回写任务：MeetingController 仅维护场景投影/白板状态，没有任务 store 写入或节点推进调用。UI 自验比较讨论前后星图 localStorage 原文。receiver-confirm、reason/evidence、人工闸口语义保持 P2。
5. 隐藏无持续渲染：折叠或切视图立即停止 Pixi ticker。活跃讨论变为 paused，保留真实逻辑会话而非偷偷结束；后台仍接收业务状态。只有取消尚有安全收尾时使用单一有限 setTimeout，调用 settleCancelled，不绘制、不推进其他持续成员；完成即停，销毁可清理。

资源方面，每位参与者分别申请 body/speech 与白板 attendee1–4 槽。持续会话和临时交接各自申请、释放；同一 Being 的身体互斥仍保留，冲突展示 BUSY，不自动重试。离开工位途中仍保留原有座位安全预留，到白板驻留 ready 后才释放 home reservation；返回动作重新申请工位。没有删除原有寻路、座位或资源保护。

离线、取消、注销仅移除相应参与者，发起者没有自动结束全体的特殊地位；显式 meeting-end 才结束全体。成员不足两人时等待而非伪造讨论。单个成员进出不重建仍在活动的幸存者；必须换名册时等待现有 Activity 安全结束，安全重建保留非结束的逻辑会话与一个 Pixi 实例。

## IPC 协议与顺序

权威类型/校验：desktop/shared/office.ts。main 顺序：desktop/main/office/orders.ts；成员校验：desktop/main/office/registry.ts；入口：desktop/main/office/ipc.ts。场景控制器：office/meeting.ts。

window.beings.officeReport 接受 OfficeReport：沿用 P2 的 type/eventId/beingId/runId 和事件字段，但调用方不再负责 runOrder/eventOrder。main 为新 run 单调分配 runOrder，同一 Being/run 的 eventOrder 递增；客户端提交的顺序值不作为权威。eventId 重复且内容一致返回原分配事件；同 ID 不同内容拒绝。被退休的 run 不能靠旧重复事件复活。

顺序状态在当前 userData/office-orders.json 保存，以临时文件写入后 rename，再返回受理；重启恢复计数与有限去重/退休记录。持久化数据损坏拒绝初始化，不静默归零。事件/退休历史有 2048 条界限，不是无限历史存储；分配后的业务拒绝可能消耗序号，不回收复用。此文件仅保存排序账本，不保存会议或动画历史。

新增输入：
- meeting-start：sessionId、participantIds（2–4 个唯一且已注册身份，包含发送者）、summary（最多 160 字，默认白板讨论）。
- meeting-join：sessionId，发送者加入自己；上限四人。
- meeting-leave：sessionId，发送者仅退出自己。
- meeting-end：sessionId，当前成员可显式结束会议。
- cancel：沿用 P2 eventId 目标；取消自己的 meeting-start 或 meeting-join 仅退出自己，不撤掉全组。

main 验证成员关系和容量；非成员 leave/end 拒绝。会话表最多 512 项。IPC 受理不等于场景动作成功，资源冲突/不可达仍只在 UI 展示，不反向新增通知。现有 mainFrame/webContents/shell URL 信任检查与生产测试入口禁用规则保持。

officeTestInject 仍只在未打包且 PORTAL_OFFICE_TEST=1 开放，接受显式顺序供旧 run/去重测试；生产调用必须用 officeReport。30 秒 presence 超时、Being 实况优先、确认不推进任务、正式原因/证据字段均保持原决策。

## 性能与减少动态

- 单个 Pixi Application，ticker 上限 30 FPS；仅移动/收尾或未减少动态的工作装饰需要持续帧。
- 空闲、稳定白板驻留及减少动态下的稳定状态停止 ticker，业务变化按需绘制一次。
- 减少动态只抑制装饰帧，不缩短真实走路/起坐时间。
- 不再每 tick 重画整张选择覆盖；选择变化按需重画。正常心跳没有视觉变化时不触发绘制，离线/过期标签变化仍及时投影。
- React 只同步语义状态；不把逐帧 World 写入 React。

## 自验结果

所有 UI/回归连接隔离实例 9224，独立 userData 为临时目录 portal-office-p3-9224。9223 受保护实例 PID 22632 未终止。测试完成后仅清理本次 9224 实例。

| 验证 | 结果 |
| --- | --- |
| npm run typecheck | tsc --noEmit 通过 |
| npm run build | 通过，1345 modules；现有 outDir/PURE/chunk-size 警告不阻塞 |
| office 单测（8 个文件） | 36/36 通过 |
| node tests/office-ui.mjs | P1 15/15 通过 |
| node tests/office-p2-ui.mjs | P2 11/11 通过 |
| node tests/office-p3-ui.mjs | P3 8/8 通过，覆盖五条判据 |
| 原始 p18 回归的临时 9224 副本 | 48/48 通过，原脚本未改端口 |
| python ../p18_accept_9224.py | 50/50 通过（包括两项诊断观察） |
| git diff --check | 通过 |

单测命令：npx vitest run tests/office-orders.test.ts tests/office-meeting.test.ts tests/office-handoff.test.ts tests/office-runtime.test.ts tests/office-projection.test.ts tests/office-presence.test.ts tests/office-client.test.ts tests/office-reports.test.ts。

单测覆盖 2/3/4 人屏障、路径增量、进出/离线/加入后取消、排队/起身/移动/驻留/返回取消、隐藏只收尾不推进其他成员、名册安全更新与逻辑会话保留、BUSY 不替换当前会话、旧 runtime 退订、main 成员校验及顺序重启/损坏拒绝。

最终冷启动 P3 UI 观测：最大连续移动增量 5.2292 px，runtime.tick P95 0.2 ms、最大 11.8 ms，四个退休 runtime 的监听数量均为 0。这是该隔离场景的 runtime.tick 耗时，不是整帧/GPU 性能或大名册性能承诺。UI 观察采用实际加载模块，避免 Vite HMR 的重复类导致测试捕获错误；P2 测试在提交时捕获 runtime，以适配空闲 ticker 停止，原行为断言未削弱。

## 偏差与明确边界

没有改变任务书五项默认业务决策。为容纳白板扩展房间下方空走廊，原有工位的世界坐标保持，整体适配视口可能改变显示比例。隐藏状态是暂停投影而非结束业务；隐藏时显式退出可能停在安全合法站位，不假装完成不可见回座。

持续 Activity 保留 vendored 既有最长一小时保护，不移除安全上限。重启/刷新恢复排序，不补播动画；没有新增完整远端会话恢复协议。未运行全仓所有 test:all、安装包或远端真实源验证；本期采用 office 相关单测、三期 UI 与指定既有回归的最小充分覆盖。没有新增素材资源。

## P4 前待拍板问题

1. 真实源重连/renderer 刷新是否需要当前会议快照与参与者状态协议；仅恢复正在进行的状态，不回放历史动作。
2. 连续会话未结束时，新注册身份加入的名册更新策略：当前优先保护幸存者 Activity，新增 actor 等安全重建；是否需要不重建 runtime 的增量注册。
3. 超过四人是否降为文字列表、分会场或排队；一小时保护到期是否显式续会，避免默默无限驻留。
4. 远端认证/身份授权与 main 账本规模化：历史保留期限、多进程写入策略及同步磁盘开销；当前仅可信本地单 main IPC。
5. 授权素材替换、离线安装包与大名册性能预算；本期素材仍程序化自产，无外链依赖。

以上事项不在 P3 中预先扩展或替产品拍板。全部本地提交等待统一验收，push 仍需独立明确授权。

