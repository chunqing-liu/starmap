# 星图 × PixOffice P1 交付说明

日期：2026-10-05。唯一实施指令源：p1-task.md；设计参考：final-proposal.md。
基线：feature/pipeline / ee3f69f；交付分支：feature/office-collab。

## 实现范围

- vendored PixOffice Runtime、人物/家具/气泡绘制、动作过渡、A* 与资源预约；宿主 OfficeHost / OfficeBridge 管理生命周期，没有迁入 HTTP 演示网关、全局 store、演示 dispatcher、聊天或地图编辑器。
- 底部协作舱与 React Flow 同级。默认 260px，可调 220–360px，按可用空间收缩以保留至少 360px 画布；空间不足时提供同一个场景的独立对话框，不创建第二个 Pixi 实例。专注模式收起并恢复此前开合状态。
- 全部星轨单向投影，100ms 合并并去重；坐标、缩放、选中变化不发人物动作。ready 不工作，blocked 不思考；只有 running 对应 working。隐藏/页面不可见时停止 ticker，销毁时取消 timer、订阅和观察器。
- 3 个显式标记演示身份，精确匹配产品 Agent / 开发 Agent / 测试 Agent。空负责人、无法解析、重名、人类执行者都不自动造人。节点高亮工位、人物查看任务、任务跳星轨、审核直达闸口；不在协作舱审批。
- IdentityRegistry 支持注册/注销，createStarmapWorld 接受动态 identities。预留 BeingNodeReport 与 local/being 来源、reportedAt 和 reason；P1 不连接真实 presence，不推断断线，不改变星图 store。

## 素材决策与授权

采用程序化自产人物和背景，不复制原库 PNG。pixel-art.ts 用可审阅的像素矩阵/矩形绘制，包含 idle、seated、walking、working、thinking 帧族；办公室使用等效 tile 背景。桌椅使用 vendored MIT 绘制内核的程序化 fallback，因此不能把全部家具绘制代码宣称为原创。

选择理由：离线零图片依赖、清晰的帧族与色彩身份、缩放一致、容易适配 reduced-motion，没有原素材的路径与授权记录依赖。这是工程可控性和一致性的选择，不宣称已经证明视觉质量优于原库；美术精修留待后续验收。

源码来自本地 PixOffice，参考提交 0b8357d123fb170b3fef453d1db8bab332550d4a，MIT / copyright 2026 teejoo。保留 vendor/LICENSE，构建产物附带 PIXOFFICE-LICENSE.txt。原素材授权由产品负责人于 2026-10-05 确认作者自媒体平台声明允许全开源使用，但本次没有使用原图片素材。

## 方案差异及边界

1. 同一人多任务采用 failed > blocked > waiting_human > running > ready > pending > done > skipped 的保守呈现优先级，所有任务仍列出。这避免异常/审核被另一项 running 掩盖，但会让同时有阻塞和运行的伙伴呈现 idle；应在 P2 明确是否更换为复合状态。
2. 当前节点 schema 没有独立的阻塞/跳过原因字段。明确显示“阻塞原因未上报”“跳过原因未上报”，不把前置条件或失败路由冒充实际原因；BeingNodeReport.reason 仅预留接口。
3. 动态身份接口已实现，P1 挂演示名册；运行中真实加入/离开、名册协调、上报入库和权限校验属于 P2/P4，没有假装已完成。
4. 原仓库没有 npm run build，新增脚本执行现有 Vite renderer 构建，不等同于 Rust engine 或安装包构建。
5. Pixi WebGL 默认检测 eval 与现有 CSP 不兼容；引入 pixi.js/unsafe-eval 的非 eval 同步 polyfill（本地源码已核对），没有修改或放宽 CSP。名称不表示本应用启用了 unsafe-eval。
6. 独立视图是空间不足时的受控模态视图，不是另一个 OS 窗口。初始空间不足 620px 时不能同时保持 260px 协作舱与 360px 画布，按约束收缩或转独立视图。

## 自验结果

| 项目 | 结果与范围 |
| --- | --- |
| npx tsc --noEmit | PASS |
| npm run build | PASS，生产 renderer 相对资源路径；附带 MIT license |
| npx vitest run tests/office-projection.test.ts tests/office-runtime.test.ts | 9/9 PASS：8 状态映射、跨星轨、未绑定/重名、审核归属、聚合优先级、100ms 去重/取消、动态身份、程序化帧、动作链/资源释放/重复/BUSY/取消 |
| node tests/office-ui.mjs | 15/15 PASS，隔离 Electron 9224 / Vite 5174；真实状态更新约 120ms，非 P95 性能结论 |
| p18_accept.py | 48/48 PASS；仅临时副本把端口改为 9224，原脚本未改，关闭协作舱并使用 1266×880 视口满足脚本固定拖拽坐标 |
| node tests/office-production.mjs | PASS；本地 unpacked Electron 生产夹具，真实主进程、beings://desktop/ 协议与原 CSP，阻断全部 HTTP/HTTPS/WS/WSS 后单一 Pixi canvas 正常、无页面异常、无原库图片请求、license 可读 |

UI 覆盖：画布最小高度、原闸口解锁、ready/running/blocked、工位高亮、画布人物点击、人物任务跳转、待审核导航、Delete/Ctrl+Z 隔离、pan/zoom 不发命令、隐藏零 tick、专注恢复、小窗口独立视图、20 次开合单 canvas、刷新投影恢复。既有脚本 K1 实际是 P17 同类节点碰撞；闸口另由 UI 用例覆盖。

生产截图与结果由脚本写入被忽略的 test-results/office/production.png、production.json。生产夹具位于临时目录，不打进仓库。9223 原实例始终保留，所有验收 CDP 只用 9224。

未做正式安装包、跨机器、真实 Being 连接或大规模 P95 性能测试。prepare:desktop 提示缺少 Portal binary，不能把 renderer/离线 UI 成功称为引擎或安装交付成功。构建有 chunk >500kB 与 Zod 注释处理警告；依赖安装报告 38 个安全告警，未做全仓依赖升级，告警归因与处理需另行审计。

## 需产品与接口负责人拍板（不阻塞本地 P1）

- Presence 使用主进程 IPC 转发还是服务协议？身份稳定 ID、场景/run 范围、进入/退出时机、工位复用与失联保留时间。
- Being 上报节点状态的认证、授权和冲突规则；“谁完成谁推进”与人工闸口的边界，不能让普通上报绕过审批。
- 阻塞、异常和跳过原因的正式字段与来源，复合多任务状态的呈现优先级。
- 演示角色绑定如何迁移为真实 owner → being 绑定；人工 reviewer 的稳定身份及头像来源。
- P4 美术质量验收、真实规模性能目标与安装包离线验收环境。

