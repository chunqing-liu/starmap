# 星图（Starmap）

面向支持 Grove Plugin API v1 / SDK 1.3 的 beings 客户端的独立流程看板插件。源码、依赖、构建与发包都由本仓库维护，客户端只负责安装和加载插件包。

当前插件支持站、节点和检查点、连线、拖拽避让、折叠、缩放、专注模式、流程模板、评论与撤销重做，以及 Town 资源、Being 对话、资源协作侧栏和节点任务状态关联。插件 ID 保持 `community.pipeline`，客户端中已有的插件数据与显示位置继续使用该 ID。

## 安装

从本仓库 [Releases](https://github.com/chunqing-liu/starmap/releases) 下载 `desktop-plugin.tar.gz` 并解压，或从 [Actions](https://github.com/chunqing-liu/starmap/actions/workflows/plugin.yml) 下载 `starmap-plugin-ubuntu-latest` / `starmap-plugin-windows-latest` 构建产物并解压。在客户端「工具库 → Plugin → 导入插件目录」选择包含 `desktop.plugin.json` 和 `index.html` 的目录。

安装后打开「流程看板」，可在工具库配置其显示位置为顶部功能栏或独立窗口。Grove 条目使用 `plugin` 标签，下载地址指向具体版本的 Release 中的 `desktop-plugin.tar.gz`；本工作流不自动发布 Grove 条目。

插件必须在支持上述 SDK 的客户端内加载，直接用浏览器打开 HTML 无法获得 Town、Being 或私有存储能力。旧 fork 的 localStorage 不会自动导入；本插件升级沿用客户端保存的私有数据。

## 独立开发与构建

需要 Node.js 22.12 或更新版本，无需克隆或构建客户端：

```sh
git clone https://github.com/chunqing-liu/starmap.git
cd starmap
npm ci
npm run check
```

`npm run check` 执行 TypeScript 检查、生产构建及包校验。也可单独执行 `npm run build` 或 `npm run verify:package`。构建将 React、React Flow、脚本与样式打进 `dist/index.html`，不依赖 CDN 或客户端源码。SDK 是 `vendor/grove-plugin-sdk` 中固定版本的纯类型契约，运行时由宿主注入。

输出：

- `dist/desktop.plugin.json`、`dist/index.html` 与授权说明：可直接导入的插件目录。
- `dist/desktop-plugin.tar.gz`：根目录含清单及 HTML 的分发包。
- `dist/desktop-plugin.sha256`：分发包的 SHA-256 校验文件。

## CI 与版本发布

[plugin.yml](.github/workflows/plugin.yml) 在 push、PR 和手动触发时分别使用 Windows、Linux 执行 `npm ci` 和 `npm run check`，保存完整 `dist` 为 Actions artifacts（保留 14 天）。校验包含独立 HTML、加载大小限制、包内文件及其内容、版本一致性和 SHA-256。

正式发布时，在同一个提交中更新 `package.json`、`package-lock.json` 和 `desktop.plugin.json` 的版本，再推送对应 `v<版本>` tag。例如版本为 `1.3.0` 时：

```sh
git tag v1.3.0
git push origin v1.3.0
```

两个平台均通过检查后，CI 使用 Linux 产物创建 GitHub Release，上传 `desktop-plugin.tar.gz`、`desktop-plugin.sha256` 和 `desktop.plugin.json`。tag 与清单版本不一致会阻止发布。客户端与插件独立发版。

需要验证客户端集成时，在支持插件的客户端仓库中设置 `STARMAP_PLUGIN_DIR` 为此仓库构建后的 `dist` 绝对路径，再运行 `npm run test:plugins-ui` 或 `npm run test:plugins-packaged`。这些测试使用临时用户配置和离线服务。

## 仓库结构

```text
src/                    当前可安装插件的源码及宿主适配
vendor/grove-plugin-sdk/ 固定的 SDK 1.3 类型契约
desktop.plugin.json     权限、视图、命令与插槽清单
build.mjs               独立 HTML、压缩包与校验文件构建
scripts/verify-package.mjs
.github/workflows/plugin.yml
pipeline/               原仓库保留的后续看板与像素办公室研发代码
tests/                  原像素办公室测试（尚未接入插件构建）
shared-types.ts         原客户端共享类型快照
README_PIPELINE.md      原研发说明及历史记录
```

`src/` 是本次从客户端抽出的已适配插件版本；原仓库中的 `pipeline/`、像素办公室、历史测试和设计资料完整保留，尚未包含在可安装插件中，后续可逐步迁入。详见 [迁移与授权说明](PLUGIN_NOTICES.md) 和 [原流程看板说明](README_PIPELINE.md)。

## License

MIT。第三方组件与保留的像素办公室代码归属见 [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES)。
