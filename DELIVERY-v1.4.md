# 星图 v1.4 交付记录：S0 阻塞，未进入业务实现

日期：2026-10-13（Asia/Shanghai）。任务依据：v1.4-task.md，已完整读取。
工作区：E:\beingsspace\starmap-src；分支 main；HEAD b0ec750。
开始时仅用户提供的 v1.4-task.md 未跟踪，既有受跟踪文件干净。

## 结论

**没有验证出可用的插件网络通道，按 S0 要求停止，不实现同步、不提升版本、不发包。**

GitLab 无凭据 HTTP 端点可达，响应有跨域允许头。已有宿主提取文件明确对插件施加 connect-src 'none'，其 SDK 没有开放通用网络 API。但本轮没有成功在实际运行的 Portal 插件页面执行探针，隔离浏览器复现也因运行环境限制失败。

不能把静态检查或终端 HTTP 响应冒充实机插件验收，也不能声称已实测证明两条路线在当前宿主均不可用。S0 仍阻塞，无经验证可采用的路线。

## S0 证据

### 1. 无凭据 HTTP：可达，但不是插件页面 fetch

用 Node HTTP 对 http://newgit.d5techs.com.cn/api/v4/version 发起 GET，携带 Origin: null，不带 PAT、Cookie 或授权头。实测响应：

    HTTP 401
    Content-Type: application/json
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS
    Access-Control-Max-Age: 7200

401 表示未提供 GitLab 身份，不是主机不可达。本轮没有实测携带 PAT 的预检、私仓读取或 Commits API，也未向 project 724 写入任何数据。终端请求不受插件页面的 CSP/混合内容约束，所以此结果不证明插件直连可用。

### 2. 宿主策略：静态检查

只读检查 E:\beingsspace\asar-extract\.vite\build\main.js。提取文件时间为 2026-10-12 15:23:19，提取包 package.json 声明 Portal Desktop 0.1.8。第 825 行定义并附加到插件响应的 CSP 为：

    default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts

该策略不允许插件 fetch 访问任何地址。提取 renderer 的 assets/index-C3k9xIZG.js 第 129 行也将插件 iframe 设置为 sandbox="allow-scripts"。阻断因素不只有 CORS/混合内容，还有宿主 CSP。

**来源限制：**没有验证提取文件与当前运行安装包一致；读取安装目录 resources 遭到 Access denied。提取文件只作为静态证据，不作为当前运行版本证明。

### 3. SDK：未发现通用网络 API

- vendor/grove-plugin-sdk/index.d.ts 声明 SDK 1.3.0，README 说明运行时注入 window.grove，vendor 不包含运行实现。
- 宿主提取代码注入的 window.grove 声明 SDK 1.4.0，与本仓库类型快照不同；本轮未修改 vendor。
- 注入 API 包含 loadData/saveData/updateData、主题/卸载订阅、agent.snapshot/mutate/onChange、workspace/events、town.query、being context/history/compose/chat/delta/tasks、UI notice/navigate。
- 没有可访问任意 URL 的 fetch/request/network/proxy API。宿主方法白名单拒绝未知操作，错误为「插件请求了尚未开放的操作。」
- desktop.plugin.json 没有通用网络 capability；town.query 是结构化 Town 查询，不是 GitLab 代理。未滥用 Town 或 Being chat 发起网络请求。
- window.portal/window.heart 没有取得实际插件页面验证；不能假定宿主顶层对象会注入插件沙箱。

### 4. 页面实测尝试与阻塞

- Browser Use 无法绑定浏览器，报 Codex auth token is unavailable。这是工具认证问题，不是 GitLab PAT 问题。
- 原生 Computer Use 能发现 Portal Desktop 窗口，但读取被拒绝：Computer Use was not approved to use portal-desktop。没有绕过该限制。
- 新增 scripts/s0-network-probe.html：仅无凭据 GET，记录 CSP violation 和 SDK API 名称/类型；不读取存储/凭据、不改业务数据。
- 新增 scripts/s0-network-probe.mjs：独立浏览器 profile，受限组使用提取宿主 CSP 与 allow-scripts iframe，对照组不附加 CSP。**这是隔离复现，不是 Portal 实机测试。**没有关闭安全机制或新增代理。
- Chrome 和 Edge 隔离启动均未完成页面探测，退出码 2147483651。Edge 诊断包含 network service crash、GPU process launch failure / access denied，最终报 GPU process isn't usable。不能用启动失败推断 GitLab 页面 fetch 的结果。
- 没有成功生成页面报告 s0-network-results.json；不得将探针启动尝试标成通过。

复现命令（需可正常启动 Chromium 的环境）：

    $env:STARMAP_S0_HOST_MAIN = 'E:\beingsspace\asar-extract\.vite\build\main.js'
    $env:STARMAP_BROWSER_PATH = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
    node scripts/s0-network-probe.mjs

后续仍须在获准控制的真实 Portal 插件页面载入探针，核对实际 CSP、SDK 和 fetch 结果，不能凭隔离对照组成功跳过宿主验证。

## 第 7 节逐项验收

- [x] 探针结论落档：已记录 HTTP 实测、宿主/SDK 静态证据及页面实测阻塞；尚无验证可用的路线。
- [ ] A 保存、B 打开/拉取一致，meta.rev 前进：未实现、未执行。
- [ ] A/B 并发冲突及字段合并无丢失：未实现、未执行。
- [ ] 断网编辑、黄条常驻、恢复推送：未实现、未执行。
- [ ] v4 一键迁移且 sanitize 前后结果一致：未实现、未执行；现有读取与 sanitize 逻辑完全未改。
- [ ] 无 token 只读提示与缓存查看：未实现、未执行。
- [ ] npm run check 全绿：未通过。标准 npm CLI 运行至 typecheck，子进程启动报 Not enough quota is available to process this command，没有类型检查通过结果，未进入构建/包校验。PowerShell npm.ps1 另受执行策略限制，已改用 npm.cmd/标准 npm CLI，未修改系统执行策略。
- [ ] 版本 1.4.0、插件清单/README 更新：依 S0 停止要求未执行，保持 1.3.1，没有将未实现功能写成已交付。

## 改动与边界

仅新增 S0 探针页、隔离复现脚本和本交付文档。未改 src/、sanitizePipelineState、v4 读取、清单、README、package 版本、依赖或锁文件。浏览器独立 profile 在已有忽略目录 .npm-cache/s0-browser 下。

没有 Git commit/push，没有创建分支/MR，没有向数据仓 master 写入，没有操作 Grove，没有发围炉帖或代宿主发言，没有读取、保存或输出 PAT。

## 已知限制与继续条件

1. 最小缺口是获准进行真实 Portal 插件探测并确认运行 SDK。若实际宿主与提取策略一致，需由宿主方正式提供受限网络能力或调整方案；本插件不能自行发明通道或削弱沙箱。
2. PAT 要求存本机 localStorage，但既有 src/host.ts 使用 grove.loadData/updateData 宿主存储包装，不是浏览器原生 localStorage。提取 iframe 没有 allow-same-origin，原生 localStorage 可用性需实机确认，不能悄悄改变 token 存放方式。
3. v1.4 业务实现和功能验收均未开始。本次是 **S0 阻塞交付**，不是 v1.4.0 可发布包。
