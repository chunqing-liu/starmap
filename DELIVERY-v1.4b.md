# 星图 v1.4b 交付 · 文件交换式团队同步

日期：2026-10-14。任务依据：v1.4b-task.md 全文。工作区：E:\beingsspace\starmap-src，仍在 main 分支；插件版本 1.4.0。本次未 commit、未 push、未打 tag、未发布或更新 Grove；等待用户验收。

## 设计落点与实际 v4 结构

- 源码确认：`src/models/schema.ts` 的 PipelineLocalState 实际是单个 `{ schemaVersion: 4, board, selectedDemandId, demands }`，并非空间字典。星轨是 demands；站、节点、闸、连线、位置、交付物及覆盖项嵌套在每条 demand 内。没有凭任务示例虚构顶层 stations/nodes 集合。
- `beings:star-map:v4` 仍保存原单看板结构，旧数据继续由原加载器读取。已有空间初始以 board.name 为名称，缺省时使用 board.id；导入包的空间名称为匹配主键。
- 多空间需要真实可用而非只存包：额外空间与活动空间名称使用旁键 `beings:star-map:team-spaces`，活动看板仍位于 v4。设置区仅在有多个空间时显示「当前空间」选择器。空间切换、导入与恢复刷新现有看板，并清空旧撤销栈和选择状态，避免跨空间撤销覆盖数据。
- 本仓库的 localStorage 语义实际通过 `src/host.ts` 的 pluginStorage 映射到宿主私有数据，不是直接调用浏览器 localStorage；继续使用该适配器，未改为另一个存储源。
- 原适配器 setItem 为异步不等待，不能证明备份落盘。本版增加可等待的 setItems，将已有写入串行排在备份前；备份成功后才单独提交 v4 + 旁键。使用已有 SDK 1.3 的 updateData 顶层原子合并契约，成功后才更新新路径的内存数据；失败向 UI 返回明确错误。没有新增网络实现、权限、冻结合同或额外发布机制。
- `sanitizePipelineState` 本体与 v4 类型文件完全未改。导出、每个导入空间、合并结果、恢复前均调用原 sanitize；JSON/schema/version/spaces 校验先于写入。无效空间逐个剔除；全部剔除或全部保留只出报告，不写备份或 v4。
- 合并按实际唯一顶层集合 demands 的 id 求并集。同 id 内容冲突根据清洗前原始 demand.updated_at 选择整条较新记录；缺失、无效、相同则导入胜。活动与非活动空间均验证；站/节点等随 demand 整条选择，不做未约定的字段级深合并。本地 board 与 selectedDemandId 保留。冲突报告逐 id 记录旧值、最终新值与胜出方向。
- 备份键 `beings:star-map:pre-import-backup` 仅保留最近一次，包含 backed_up_at 以及导入前 v4 和旁键的原字符串；恢复前再次校验并 sanitize，确认后整体恢复活动看板和全部额外空间。

### 主要实现

| 路径 | 职责 |
| --- | --- |
| `src/team-sync.ts` | 包解析、空间集合、Blob 下载、id 合并、备份/恢复、空间切换 |
| `src/team-sync-ui.tsx` | 设置区三按钮、逐空间/统一三选项、确认弹窗、导入报告 |
| `src/host.ts` | 保持既有存储接口，新增可等待写入与串行保存 |
| `src/integrations.tsx`、`src/page.tsx` | 在原协作设置区接入、应用后刷新看板，避免重复同值自动保存 |
| `src/theme.css` | 新小节与弹窗的局部样式；原看板样式不变 |
| `build.mjs` | 从 package.json 注入导出包 app_version，避免硬编码版本漂移 |
| `tests/team-sync.test.mjs`、`tests/team-sync-ui.mjs` | 可复跑数据夹具与真实浏览器验收 |

## 第 7 节逐条验收

以下勾选限定为本仓库测试环境：数据夹具 + 真实 Chrome、mock Grove SDK、离线 file 页面。浏览器团队同步验收加上 `connect-src 'none'`；未把模拟宿主测试说成 Portal Desktop 实机验收。

- [x] **导出结构、sanitize deep-equal、下载可用。** 数据测试核对 schema/version/exported_at/app_version/spaces、空间时间与总 demand 计数；向 v4 注入 null transition 和无效选中 id 后，导出内容与现有 sanitize 结果 deep-equal，存储不变。浏览器实测 Blob + 对象 URL + a.download，下载文件名符合 starmap-export-YYYYMMDD-HHmm.json，下载 JSON app_version=1.4.0，内容 deep-equal，toast 显示 1 空间/2 星轨。证据：`tests/team-sync.test.mjs` §1、`ui.log` 第 1 项、`export.json`。
- [x] **全新团队包导入正确创建空间、数据一致。** 空存储导入团队甲/乙，v4 顶层仍只有原四字段，另一个空间保存在旁键；切换与再次导出一致。真实 UI 从现有本机导入新团队乙并切换，画布/星轨立即变化；恢复移除新增空间。证据：数据测试 §2 全新本地、`ui.log` 第 5 项、`settings-spaces.png`。
- [x] **同名空间三选项。** 独立 keep/replace/merge 三个数据用例及同样三轮真实 UI 夹具全部通过。保留本地时全存储字符串和写调用数不变；使用导入时空间整包等于 sanitize 后的导入状态；合并验证报告、结果与刷新。证据：数据测试 §2 三选项、`ui.log` 第 3 项。
- [x] **id 并集与较新整条胜出。** 构造相同 id 不同标题/摘要/节点数据，本地较新、导入较新、相同时间、缺任一/双方时间、非法时间七种情况；本地独有、导入独有均存活，每个冲突有旧→新和胜出方向。本地较新整条保留，导入胜出时整条替换，没有拼字段。对非活动空间复测同样规则。证据：数据测试 §3、`ui.log` 第 3 项、`merge-report.png`。
- [x] **坏包三连测，错误具体，逐字节不变。** malformed JSON / schema 不符 / version=2，在数据与 UI 两层整体拒绝；UI 同时比较全部宿主私有数据、浏览器 localStorage 的序列化字符串、写调用数量，完全不变。version=2 在 spaces 无效前先返回「团队包来自更新的版本，请先升级插件」。额外覆盖 version 字符串、spaces 数组、坏空间剔除与全坏无写入。证据：数据测试 §2 坏包与剔除、`ui.log` 第 2 项。
- [x] **先备份，恢复 deep-equal。** 严格断言写入顺序：第一调用仅备份键，第二调用才是 v4 + 旁键。备份原字符串与导入前一致，带有效时间；恢复后规范 v4 和全部空间与导入前 deep-equal。额外注入异步 QuotaExceededError，备份失败时无应用写入、v4/已有备份不变；模拟应用失败时保留备份，坏备份拒绝且无副作用；取消导入也无写入。证据：数据测试 §4/宿主适配、`ui.log` 第 3/4 项。
- [x] **新增代码零网络调用。** 对整个 src（覆盖全部新文件，强于只查差异）运行 `rg -n 'fetch|XMLHttpRequest|WebSocket|EventSource' src`：无匹配，exit=1 表示未找到。浏览器团队同步 HTTP 请求列表为空；未增加 SDK 网络方法或外部依赖。证据：`static.txt`、`ui-results.json` 的 httpRequests=[]。
- [x] **npm run check 全绿，现有插件用例无回归。** typecheck → 11/11 数据测试 → build → verify:package，整体退出码 0。原 `tests/plugin-simplification-ui.mjs` 6/6 全过：八态/九态、协作提示与三 Being 按钮、站缩小/放大尺寸、轻流程与任务状态关联、闸拦截与删除后推进、空白新建及既有数据，页面异常为空。证据：`check.log`、`regression.log`。历史像素办公室测试并非当前可安装插件测试，未额外改造或声称执行它们。
- [x] **版本号 1.4.0、清单/README 更新。** package.json、package-lock.json 两处、desktop.plugin.json 一致；生产包校验输出「PASS: 星图流程看板 v1.4.0」。README 明确文件交换入口、三选项、备份恢复、多空间及限制。插件 id、权限、视图和命令保持既有值，不新增 Grove 发布行为。

## 复跑方式与证据

`npm run check` 已包含数据测试；浏览器测试不加入插件运行依赖，复用仓库已有的本地 Playwright 工具：

~~~powershell
npm.cmd run check
$env:NODE_PATH = Join-Path $PWD '.npm-cache\_npx\e058441c325e062a\node_modules'
$env:STARMAP_BROWSER_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$env:TEMP = Join-Path $PWD '.npm-cache\browser-tmp'
$env:TMP = $env:TEMP
npm.cmd run test:team-sync-ui
node tests/plugin-simplification-ui.mjs
rg -n 'fetch|XMLHttpRequest|WebSocket|EventSource' src
git diff -- src/models/templates.ts src/models/schema.ts
git diff --check
~~~

NODE_PATH/浏览器路径依赖本机安装，在其他机器替换为当地已有的 playwright-core/Chromium。数据测试只使用现有 esbuild 与 Node，不需要额外安装工具。

本机证据在 `.npm-cache/team-sync-evidence/`（按既有 .gitignore 忽略，不混入正式源码或分发包）：

- `check.log`：完整检查输出，11 tests / 11 pass / 0 fail；生产构建与包校验通过。
- `ui.log`、`ui-results.json`：5 组实际浏览器检查，pageErrors=[]、httpRequests=[]。
- `regression.log`：原插件 6 组回归通过。
- `static.txt`：全 src 零网络扫描、sanitize/schema 零差异与 diff whitespace 检查。
- `export.json`：浏览器实际下载的团队包。
- `settings-spaces.png`、`merge-report.png`：设置区和逐 id 冲突报告；已目视检查，保持原设置面板风格，报告支持滚动。

## 本地交付产物

- `dist/index.html`：570890 字节，自包含，无外部脚本或样式资源。
- `dist/desktop-plugin.tar.gz`：177432 字节，本地构建包。
- `dist/desktop.plugin.json`：1.4.0，community.pipeline，原单视图/原权限。
- 原有构建的分发包校验文件继续由原脚本生成并通过校验，没有新增校验机制。

## 已知限制与未执行项

1. 匹配按空间名、星轨 id；不追踪重命名，空间改名视为新空间；合并也不把导入方缺失条目当删除。要完全采用团队版本需选「使用导入」。
2. 实际 v4 Demand 类型与原 sanitize 没有保留 demand.updated_at 字段，因此普通 v4 导出的同 id 冲突默认导入胜。本版比较输入原始数据中确实存在的时间戳，不伪造更新时间、不给旧数据补时钟。导入/恢复后的规范状态仍遵循原 sanitize，不提供额外的持久版本历史。
3. 合并粒度是顶层 demand。共享 demand 内的本地独有站/节点不会再做深层并集，而是随胜出 demand 整条保留/替换；看板元信息与选中项保留本地，选中失效时由原 sanitize 回退。
4. 团队包和备份范围是 v4 与新增团队空间旁键，不含独立键上的评论、任务绑定、协作提示、侧栏宽度。既有评论按 demand id 分键，相同 demand id 的不同空间仍可能看到同一本机评论；本版未改变这些旧键。
5. 仅单窗口文件交换，不提供多窗口并发写入仲裁、自动仓库同步或跨机器协同会话。团队仓库取包/提交仍由 Being 或人完成。
6. 浏览器已实测下载，且同步操作在 connect-src 'none' 下通过；没有在真实 Portal Desktop 宿主重新加载 1.4.0，实际宿主的文件选择/下载权限与 UI 仍待用户安装验收，不声称已实机发布。
7. 不操作团队 GitLab 仓库，不发围炉帖，不代宿主发言，不碰 Grove 发布。未执行 commit/push/tag/release。
8. 原 `v1.4-task.md`、`DELIVERY-v1.4.md`、`scripts/s0-network-probe.html`、`scripts/s0-network-probe.mjs` 与用户的 `v1.4b-task.md` 均保留原文件、未修改、未删除；本交付另用 DELIVERY-v1.4b.md。

**交付状态：本地实现与任务书测试环境验收完成，停下等待用户验收。**
