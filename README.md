# 星图（Starmap）

面向支持 Grove Plugin API v1 / SDK 1.3 的 beings 客户端的独立流程看板插件。源码、依赖、构建与发包都由本仓库维护，客户端只负责安装和加载插件包。

当前插件支持站、节点和闸口编排、连线、拖拽避让、折叠、缩放、流程模板、评论与撤销重做，以及 Being 对话和节点任务状态关联。v1.4.0 新增文件交换式团队同步；仍仅保留「星图」视图，协作提示与团队同步都在顶部「协作」面板的设置区。插件 ID 保持 `community.pipeline`，客户端中已有的插件数据与显示位置继续使用该 ID。

「新建星轨」仍从空白画布开始；展开「从模板新建」可选已有流程或「轻流程」。轻流程包含待办、进行中、完成三站，中间的通用闸口可按需保留或删除。站的流程说明、节点的描述与完成证据默认折叠，展开后仍可编辑。

## 安装

从本仓库 [Releases](https://github.com/chunqing-liu/starmap/releases) 下载 `desktop-plugin.tar.gz` 并解压，或从 [Actions](https://github.com/chunqing-liu/starmap/actions/workflows/plugin.yml) 下载 `starmap-plugin-ubuntu-latest` / `starmap-plugin-windows-latest` 构建产物并解压。在客户端「工具库 → Plugin → 导入插件目录」选择包含 `desktop.plugin.json` 和 `index.html` 的目录。

安装后打开「星图」，可在工具库配置其显示位置为顶部功能栏或独立窗口。Grove 条目使用 `plugin` 标签，下载地址指向具体版本的 Release 中的 `desktop-plugin.tar.gz`；本工作流不自动发布 Grove 条目。

插件必须在支持上述 SDK 的客户端内加载，直接用浏览器打开 HTML 无法获得 Being 或私有存储能力。旧 fork 的 localStorage 不会自动导入；本插件升级沿用客户端保存的私有数据。

## 团队同步（文件交换）

插件在隔离沙箱内无法直接联网，团队同步不访问外部 API：

1. 打开「协作」面板底部的「团队同步（文件交换）」，点「导出团队包」下载 JSON；交给 Being 或伙伴提交到团队仓库。
2. 从伙伴或团队仓库取得团队包，点「导入团队包」。每个空间可选「保留本地」「使用导入」「合并」，也可统一选择；取消或包校验失败不会修改数据。
3. 确认导入后先保存导入前备份；备份失败立即中止。完成后显示新增、覆盖、合并、保留、剔除与逐星轨 id 的冲突报告。
4. 「恢复导入前备份」显示时间与空间数，确认后完整还原；仅保留最近一次导入前快照。多个空间通过本小节的「当前空间」切换。

原 `beings:star-map:v4` 键仍保存单个 `{ schemaVersion, board, selectedDemandId, demands }`，看板的清洗逻辑不变；额外空间保存在独立旁键，不改 v4 结构。合并针对实际唯一的顶层集合 `demands` 按 id 求并集；同 id 整条取较新的 `updated_at`，任一方缺失、无效或相同则导入胜，站、节点等随所属星轨整体替换。当前 v4 没有内置星轨更新时间，常规导出默认走导入胜规则，不自动补时间戳。合并保留本地看板元信息与当前选中星轨。

空间名称是匹配依据，改名视为新空间，不自动追踪重命名或跨文件删除。团队包与备份仅覆盖 v4 空间数据，不包含独立存储的评论、任务绑定和个人协作提示；这些数据仍留在本机。多窗口同时修改同一插件数据不提供协同冲突解决。

## 独立开发与构建

需要 Node.js 22.12 或更新版本，无需克隆或构建客户端：

```sh
git clone https://github.com/chunqing-liu/starmap.git
cd starmap
npm ci
npm run check
```

`npm run check` 执行 TypeScript 检查、11 项团队同步数据测试、生产构建及包校验。也可单独执行 `npm run test:team-sync`、`npm run build` 或 `npm run verify:package`。构建将 React、React Flow、脚本与样式打进 `dist/index.html`，不依赖 CDN 或客户端源码。SDK 是 `vendor/grove-plugin-sdk` 中固定版本的纯类型契约，运行时由宿主注入。

真实浏览器验收使用 `npm run test:team-sync-ui` 和 `node tests/plugin-simplification-ui.mjs`，需可解析的 `playwright-core` 及 Chromium（可通过 `NODE_PATH`、`STARMAP_BROWSER_PATH` 指向已有本地工具，不加入插件运行依赖）。脚本使用隔离页面和 mock SDK，不发送真实 Being 请求；下载样本、截图与报告写入 `.npm-cache/team-sync-evidence/`。

输出：

- `dist/desktop.plugin.json`、`dist/index.html` 与授权说明：可直接导入的插件目录。
- `dist/desktop-plugin.tar.gz`：根目录含清单及 HTML 的分发包。
- `dist/desktop-plugin.sha256`：分发包的 SHA-256 校验文件。

## CI 与版本发布

[plugin.yml](.github/workflows/plugin.yml) 在 push、PR 和手动触发时分别使用 Windows、Linux 执行 `npm ci` 和 `npm run check`，保存完整 `dist` 为 Actions artifacts（保留 14 天）。校验包含独立 HTML、加载大小限制、包内文件及其内容、版本一致性和 SHA-256。

正式发布时，在同一个提交中更新 `package.json`、`package-lock.json` 和 `desktop.plugin.json` 的版本，再推送对应 `v<版本>` tag。例如版本为 `1.4.0` 时：

```sh
git tag v1.4.0
git push origin v1.4.0
```

两个平台均通过检查后，CI 使用 Linux 产物创建 GitHub Release，上传 `desktop-plugin.tar.gz`、`desktop-plugin.sha256` 和 `desktop.plugin.json`。tag 与清单版本不一致会阻止发布。客户端与插件独立发版。

需要验证客户端集成时，在支持插件的客户端仓库中设置 `STARMAP_PLUGIN_DIR` 为此仓库构建后的 `dist` 绝对路径，再运行 `npm run test:plugins-ui` 或 `npm run test:plugins-packaged`。这些测试使用临时用户配置和离线服务。

## 仓库结构

```text
src/                    当前可安装插件的源码及宿主适配
vendor/grove-plugin-sdk/ 固定的 SDK 1.3 类型契约
desktop.plugin.json     权限、视图与命令清单
build.mjs               独立 HTML、压缩包与校验文件构建
scripts/verify-package.mjs
.github/workflows/plugin.yml
pipeline/               原仓库保留的后续看板与像素办公室研发代码
tests/                  团队同步与插件回归，以及原像素办公室测试（历史办公室测试未接入构建）
shared-types.ts         原客户端共享类型快照
README_PIPELINE.md      原研发说明及历史记录
```

`src/` 是本次从客户端抽出的已适配插件版本；原仓库中的 `pipeline/`、像素办公室、历史测试和设计资料完整保留，尚未包含在可安装插件中，后续可逐步迁入。详见 [迁移与授权说明](PLUGIN_NOTICES.md) 和 [原流程看板说明](README_PIPELINE.md)。

## License

MIT。第三方组件与保留的像素办公室代码归属见 [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES)。
