# P4 交付说明：打包与规模化

## 素材红线与提交纪律

不引入 PixOffice 原库 PNG、图片包、网络图片、字体或音频。办公室全部视觉继续程序化自产；现有应用品牌图等既有资源没有替换，不属于新增办公室素材。没有执行任何 origin/fork push，也没有发布、签名或上传产物；仅在 feature/office-collab 本地提交，等待人类统一验收。

起点为已验收的 9b6418d。分阶段代码提交：
- 0751a39：大名册独立视图、增量注册、导航校验性能与本地顺序账本边界。
- f76cf71：程序化纹理缓存、实际人物位置同步、离线许可资源与生产模式验收脚本。
- 本文单独作为交付文档提交；最终提交号以 git log 为准。

## 范围与默认决策

按 workspace/p4-task.md 的五项默认决策实现：资源生成接入、离线包、超过八人的独立办公室、尽量保持活动 runtime 的增量注册、许可声明、单 main 本地账本容量及过期收尾。不新增多人房间服务、远端认证、协作网络协议、真机安装流程或新素材资源。

超过八人的独立办公室复用同一 Pixi Application 和 canvas，在当前窗口显示大尺寸独立视图，并保留关闭、Esc 与键盘焦点约束；不是新 Electron 窗口，也不是多服务器房间。超过四人的会议仍沿用 P3 的容量拒绝和文字反馈，不绘制虚假的会议。

## 实现要点

### 程序化离线纹理与可见性

- textures.ts 将 pixel-art.ts 的状态/帧/颜色/坐姿组合绘制为本地 RenderTexture；首次用到该组合时预渲染，后续 Sprite 复用缓存，nearest 采样，未生成任何外部图片文件。
- scene.ts 将地板与家具 Graphics 缓存在纹理中；业务变化更新家具缓存，名册刷新重新建立当前场景缓存。临时 Graphics、人物纹理与场景缓存随所属场景释放；不建立全局无主缓存。
- AgentEntity 支持共享纹理提供者，未接入提供者时保留已有程序化 fallback。场景明确关闭原库图像帧资源路径。
- 生产截图核对发现原有 scene.sync 只更新人物数据、未同步 Container.position；本期补齐 setPosition，使人物画面与运行时到场/返座一致。P4 脚本额外断言 positionMismatches=0，不仅检查逻辑会话进入 active。
- 延续 P3：可见运动最多 30 FPS；空闲及减少动态的稳定状态停止 ticker；隐藏只做有限的取消收尾，不持续渲染或补播历史动作。
- 只读 DOM 诊断位于 .office-scene 的 data-office-diagnostics，记录 Application、ticker、runtime 监听数、场景订阅、ResizeObserver、缓存帧数与人物坐标一致性；无生产写入调试入口、无额外诊断定时器。

### 大名册与增量注册

- OfficeDock 以 identities.length > 8 自动切独立视图；关闭大名册办公室后折叠，重新展开仍是独立视图，不残留覆盖层。
- 新身份加入且原身份/绑定未变化、交接控制器已收尾时，OfficeHost 优先 appendOfficeIdentities。新增工位位于白板下方，保留已有工位和白板坐标。
- appendOfficeRoster 验证扩展世界，仅定义新实体的资源；保留原 actor 的运动/起坐状态、活动与资源占用，runtimeId 不变。人物 schema 不包含实时运动字段，因此验证后明确保留原运行中的 actor，而非用解析结果覆盖它。
- 身份移除、绑定变更、临时交接尚未收尾或增量失败，保留 P3 的安全重建回退；不强制打断现有活动。持续白板会话可在增量注册期间保留。
- 延续 main 已有最多 100 个身份的边界。自动化验证 13 人生产场景，以及 100 人模型扩展；没有承诺 100 人整帧/GPU 性能预算。
- 导航布局校验用四邻域可达集合一次验证必需入口，代替对每个目标反复全图 A*；互动区域也以受限可达搜索校验。实际移动仍使用原路径算法与时间语义。家具重叠、边界、座位入口及连通校验没有删除。

### 本地账本与 IPC 边界

- office-orders.json 仍由单 main 实例写入，临时文件 + rename 后才返回分配结果；全局 nextRunOrder 不重置，已有去重、退休 run 拒绝、溢出与损坏拒绝保留。
- 活跃账本身份最多 1024 个；新身份超限返回 ORDER_CAPACITY，不逐出仍在保留期的身份，不偷偷归零。IPC 透传该错误。
- run 增加内部 lastSeen。每次新的事件分配时，惰性清除其他超过 30 天未产生新事件的身份及其缓存事件；当前发送身份保留，旧格式缺少 lastSeen 时从本次加载时间起保留。没有新增清理后台计时器。
- 事件缓存和退休 run 历史继续有 2048 条上限。过期清理不是永久历史/永久防重放承诺，30 天外已清理身份可作为新的本地顺序记录进入；这不是远端认证能力。
- OfficeReport、meeting/handoff 与节点上报协议不改；内部持久化增加时间字段、受理错误增加 ORDER_CAPACITY。生产 officeTestInject 仍禁用，生产测试只使用正常 officeReport/snapshot IPC。

### 许可与分发

THIRD_PARTY_NOTICES 保留 PixOffice 完整 MIT 与逐类素材来源：本地人物像素算法、场景几何、MIT DeskEntity fallback、白板几何及宿主系统字体；明确不使用原库素材。另包含实际打入办公室运行代码的 PixiJS、Zod、PathFinding.js MIT 与 heap 的上游 PSF 声明。打包 renderer 不包含 node_modules，不能以 node_modules 内许可证代替分发声明。

Vite 将 THIRD_PARTY_NOTICES、PIXOFFICE-LICENSE.txt 放入生产 renderer；Forge 同时将公告及 vendored LICENSE 放到 resources，保留原 HEART-PORTAL-LICENSE 与其他既有依赖公告。最终 ASAR 公告已读回，与仓库公告一致；办公室路径未发现 PNG/JPEG/WebP/字体/音频分发文件。

## 构建与产物

本机没有可用 Rust/cargo。已按仓库指定版本初始化 heart-portal submodule（2bb23210599012cc46cec954e53a101a94c0e8ac），未改其 Git 指针；未假装从源码编译引擎。

为产出本地离线验收包，复用本机已安装的 heart-portal 0.9.2 引擎二进制：AppData/Roaming/portal-desktop/portal-service/de72ff5b-53e9-421f-b74b-82363dd3b0ae/heart-portal.exe，复制到 Git 忽略的 resources/heart-portal.exe。原引擎进程未停止。npm run prepare:desktop 成功准备现有资源/运行时元信息；Forge 的引擎存在检查、macOS 签名安全规则未改。

执行命令：

~~~powershell
npm run prepare:desktop
$env:PORTAL_DESKTOP_PACKAGE_OUT='out/office-p4'
npx electron-forge make --targets=@electron-forge/maker-zip
~~~

make 成功生成 Windows x64 未签名便携 ZIP 和可运行目录，代码来自 f76cf71：
- out/office-p4/Portal Desktop-win32-x64/portal-desktop.exe
- out/office-p4/make/zip/win32/x64/Portal Desktop-win32-x64-0.1.5.zip（167109632 bytes）
- resources/app.asar（5266925 bytes）内含生产 renderer 与许可资源。

沿用项目 0.1.5 版本，仅本地验收产物，不是正式 release；没有生成/验收 NSIS 安装器。此目录/ZIP 满足任务书的至少可运行目录默认，安装、升级、卸载等人工流程未验证。引擎是复用的已安装 0.9.2，不是本次 submodule 源码编译产物，正式分发前需确认版本配套。

## 自验结果

所有 UI/回归均使用 9224，dev userData 为临时目录 portal-office-p4-dev-9224，生产为 portal-office-p4-prod-9224。9223 的受保护实例 PID 22632 从未终止。只清理本次已核对执行路径/调试端口的验收进程，不操作共享引擎。

| 验证 | 结果 |
| --- | --- |
| npm run typecheck | tsc --noEmit PASS |
| npm run build | PASS，1347 modules；既有 outDir/PURE/chunk-size 警告不阻塞 |
| office 相关单测，11 文件 | 40/40 PASS |
| node tests/office-ui.mjs | P1 15/15 PASS |
| node tests/office-p2-ui.mjs | P2 11/11 PASS |
| node tests/office-p3-ui.mjs | P3 8/8 PASS |
| 既有原始 p18 脚本的临时 9224 副本 | 48/48 PASS；未修改原脚本端口 |
| python ../p18_accept_9224.py | 50/50 PASS，包含两项诊断观察 |
| forge make ZIP / 可运行目录 | PASS，实际启动该目录中的 exe |
| node tests/office-p4-ui.mjs | 生产模式 5/5 PASS，覆盖三条必需判据及动态白板/大名册 |
| git diff --check | PASS |

单测命令：

~~~powershell
npx vitest run tests/office-roster.test.ts tests/office-navigation.test.ts tests/office-orders-capacity.test.ts tests/office-orders.test.ts tests/office-meeting.test.ts tests/office-handoff.test.ts tests/office-runtime.test.ts tests/office-projection.test.ts tests/office-presence.test.ts tests/office-client.test.ts tests/office-reports.test.ts
~~~

P4 三判据证据：
1. 实际打包 exe 使用 beings://desktop 页面，在 renderer 离线状态下刷新，人物/家具/白板和本地许可加载；工作、思考、走路帧及白板真实到场/返座正常。截图 test-results/office-p4-production.png 已视觉检查，两名讨论者实际位于白板。
2. 打包页主 JS/CSS 使用 beings://desktop/assets/；离线 fetch 返回 200 且非空；未出现 5173/5174 请求依赖，生产测试注入入口拒绝调用。被保护实例的 5173 仍运行，不作为生产包的加载来源。
3. 20 轮折叠/展开/篝火与星图切换，Application=1、runtime listeners=4、ticker listeners=2（包含 Pixi 自身的渲染监听）、scene subscriptions=1、ResizeObservers=1 无增长。隐藏/稳定减少动态后 ticker=false、maintenance=false；所谓零残留是没有新增/退休实例泄漏，并非活跃场景没有必要监听。

生产扩展到 13 个身份时 runtimeId 保持，自动切独立视图；注销后使用安全回退，恢复 3 人及同样的基准计数、单 canvas。最终 positionMismatches=0、networkFailures=[]、pageerror=0。P3 复跑 runtime.tick P95 0.2ms、最大 5.9ms，连续移动最大增量约 5.229px；仅为本次小名册逻辑 tick 观测，非整体帧性能指标。

未运行全仓 test:all、macOS 产物、正式安装/升级/卸载、跨机器/远端身份真实服务验收；不把相关单测通过等同于上述环节通过。生产离线检查针对办公室 renderer 资源，不承诺整个应用的所有业务在断网时工作。

## 遗留给人类验收的事项

1. 将 ZIP 解压到无源码/node_modules/Vite 的另一台 Windows x64 机器，离线启动 exe；确认办公室三种状态、白板、独立大名册与许可可读。验收实例只用 9224；不要终止既有 9223 实例。
2. 真机目视确认 >8 人独立视图的空间、缩放可读性、人员列表/键盘焦点/关闭及减少动态体验；大名册极限性能预算、是否需要额外分页/分房间由产品另行决定。
3. 确认安装、更新、卸载、重启与旧用户数据保留的正式产品流程；本次是未签名便携 ZIP/目录，不是安装流程通过。正式版本号、Windows 签名与安装器目标需另行授权。
4. 确认复用 heart-portal 0.9.2 与正式客户端的版本配套，发布时按项目工具链重新编译/准备引擎；本地包不能代表已验证源码到引擎的可重复构建。
5. 确认 30 天/1024 身份有限账本策略是否适合正式使用；跨 main 进程写入、远端认证和永久历史不在 P4。损坏账本仍拒绝初始化，不能用清空账本假装修复。
6. 会议刷新/重连快照、超四人协作和一小时持续会话续期仍保留 P3 明确边界；不把本期大名册视图视为这些协议问题的解决方案。

所有产物仅本地保留。人类验收通过之前禁止任何 push；后续发布/推送仍需明确授权。
