# 星图插件 v1.3.1 减法改版交付报告

日期：2026-10-12。仓库：`E:\beingsspace\starmap-src`。

## 结论

减法改版与追加的站缩小态优化完成；指定 E 盘缓存安装、三关检查和安装包生成均完成；六组定向回归通过。

原先的缓存路径权限阻塞已解除。本次已成功执行 `npm.cmd install --cache E:\npm-cache`，退出码 0；没有回退到 C 盘缓存。

PowerShell 的 `npm.ps1` 被执行策略禁止，因此命令使用等价的 `npm.cmd`；没有修改系统执行策略。没有执行 git commit、git push、tag 或发布。

## 逐条改动落点

| 条目 | 文件与大致行号 | 改动 |
| --- | --- | --- |
| 1. 版本与清单 | `desktop.plugin.json:7`、`package.json:4`、`package-lock.json:3` | 版本均为 1.3.1；只保留 board/星图 与 open-board/打开星图；删除 settingsView、slots、being-assist；描述改为站、节点、闸口编排与 Being 对话。 |
| 2. 协作收拢 | `src/integrations.tsx:6`、`src/integrations.tsx:35` | 删除 PipelineSettings 和 Town 种子搜索；顶部按钮改「协作」；协作提示移至面板底部，仍用原 preferenceKey 保存、沿用旧值、限制 2000 字符并支持空值回退；保留三个 Being 按钮。 |
| 3. 侧栏下线 | `src/workspace.tsx:20`、`src/workspace.tsx:30`、`src/main.tsx:13` | 删除 PipelineWorkspace 及资源上下文订阅；启动只渲染 Pipeline；NodeTaskPanel、任务订阅、场景范围校验与任务绑定保留。host.ts 原本无该组件引用，未修改；page.tsx 仍仅引用 NodeTaskPanel。 |
| 4. 专注、状态与说明 | `src/page.tsx:91`、`src/page.tsx:1188`、`src/page.tsx:1250`、`src/page.tsx:1261` | 移除专注 state/ref、进入/退出函数、两个监听、按钮及专用 class；删除星轨详情里只为专注服务的下一步容器。站说明和节点描述/完成证据默认折叠，展开仍可编辑。 |
| 5. 轻流程 | `src/models/templates.ts:19`、`src/models/templates.ts:54`、`src/page.tsx:989`、`src/page.tsx:1211` | 注册「轻流程」：待办 → 进行中 → 完成三站，进行中站含一个未锁定的通用闸口；可按需保留或删除。折叠的「从模板新建」入口可直接创建；原「新建星轨」仍创建空白画布。 |
| 6. 术语微调 | `src/workspace.tsx:48`、`src/models/beings-development.ts:24`、`pipeline/models/beings-development.ts:24` | 用户可见「账本」改「任务记录」、「收件」改「消息」；保留源码副本里的相同 UI 文案同步修改。变量名、存储键未改；星轨、星图、站、闸保留。 |
| 7. 无主样式 | `src/v4.css:52`、`src/v4.css:334`、`src/theme.css:4`、`src/theme.css:5` | 删除专注模式样式；workspace/sdk-settings/sdk-search 的无主样式实际位于 theme.css，已在真实归属处移除；保留节点任务面板样式，为迁入的协作提示和折叠模板入口补最小样式。 |
| 文档与回归 | `README.md:5`、`tests/plugin-simplification-ui.mjs:1`、`.gitignore:2` | 更新实际功能、使用入口和版本示例；新增隔离浏览器回归脚本；仓库内 E 盘缓存加入忽略列表。 |
| 追加：站缩小态 | `src/v4.css:120`、`src/page.tsx:79`、`tests/plugin-simplification-ui.mjs:85` | 仅 is-compact 态：站标题 13px → 14px，节点完成摘要 11px → 12px，站编号 10px → 11px；上下 padding 17px → 8px，左右仍为 18px；高度常量 170 → 96，宽度仍为 286。展开态规则和共享最小宽度均未修改。 |

NodeStatus 文案按顺序为：pending=待开始、ready=可开始、running=进行中、waiting_human=待评审、blocked=受阻、failed=失败、done=完成、skipped=已跳过。节点卡片不再以 Bug 的「已关闭」覆盖 done 文案；Bug 自身状态、DemandStatus 九态及其文案不动。

## 清单前后对比

对比来源：仓库 HEAD 中的原清单与当前工作区清单。

| 字段 | 改动前 | 改动后 |
| --- | --- | --- |
| version | 1.3.0 | 1.3.1 |
| views | board / 流程看板；settings / 看板设置；companion / 资源协作 | 仅 `{ "id": "board", "title": "星图" }` |
| commands | open-board / 打开流程看板；being-assist / 打开 Being 协作 | 仅 open-board / 打开星图，view=board |
| settingsView | settings | 字段删除 |
| slots | workspace / right-sidebar；resource / resource-actions，资源类型 seeds、embers、kits、announcements | 字段删除，不是空数组 |
| description | 用站、节点和检查点编排工作流，支持资源协作侧栏、Being 对话和节点任务状态关联。 | 用站、节点和闸口编排星轨，在星图中通过 Being 对话协作推进任务。 |

## 验证摘要

依赖安装实际执行：`npm.cmd install --cache E:\npm-cache`。

- 退出码 0；up to date，audited 38 packages in 3s，found 0 vulnerabilities。

追加任务完成后重跑三关：`npm.cmd --cache E:\npm-cache run check`，整体退出码 0。

| 阶段 | 输出摘要 | 结果 |
| --- | --- | --- |
| typecheck | `tsc --noEmit -p tsconfig.json`，无类型错误 | 通过 |
| build | `node build.mjs`；`Plugin built: E:\beingsspace\starmap-src\dist` | 通过 |
| verify:package | `PASS: 星图流程看板 v1.3.1; self-contained HTML, package contents and checksum verified.` | 通过 |

额外检查：`git diff --check` 通过；src 中已无专注/下线组件引用及旧 UI 术语；保留的 pipeline 源码中已无「账本」「收件」UI 字符串；`src/models/schema.ts`、`src/host.ts` 无变更。没有修改现有 v4 数据归一化、保存或加载实现。

隔离 Chrome + mock Grove SDK 的六组定向回归全部通过：

- 八种节点状态、九种星轨状态与 v4 数据保持兼容；轻流程注册与空白默认新建正确。
- 旧协作提示读出、修改与保存成功；三个按钮将提示与星轨上下文传给 compose/chat/navigate。
- 缩小态真实计算字号为 14px / 12px / 11px，上下内边距为 8px，高度为 96px、宽度为 286px；文字无溢出，放大后的展开态尺寸、内边距与字号均恢复且不变。等待尺寸动画结束后断言，避免过渡帧造成误报。
- 轻流程渲染三站与四节点；说明默认折叠且可编辑；八态文案精确匹配；节点任务关联与状态应用有效。
- 站说明默认折叠；保留闸口时既有拦截生效，删除可选闸口后可推进下游，没有削弱既有闸口规则。
- 一键新建仍为空白；原默认星轨、Bug 星轨、任务绑定与 schemaVersion 保留；无页面异常。

回归脚本需要 `playwright-core` 和 Chromium。此次临时工具仅安装在 E 盘 npm 缓存，没有加入插件依赖。执行脚本：`node tests/plugin-simplification-ui.mjs`；可用 NODE_PATH 指向临时工具的 node_modules，STARMAP_BROWSER_PATH 指向本机 Chrome/Chromium。浏览器临时目录此次也设在仓库内 E 盘缓存中。

**验证范围：** 已验证构建产物与模拟宿主接口的真实浏览器交互，未在 Grove 桌面宿主内加载，也未发送真实 Being 请求。

## 交付产物

- `dist/desktop-plugin.tar.gz`：171467 字节。
- `dist/index.html`：555413 字节，单文件自包含。
- `dist/desktop.plugin.json`：v1.3.1 单视图清单。
- `dist/desktop-plugin.sha256`：与包验证及独立 Get-FileHash 结果一致。

SHA-256：

```text
831bdb4c807cfa2b1efd25bee8d83274d8afc115a4919f00e4b48fd7371d3759
```
