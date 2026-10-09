# Star Map / Pipeline View（feature/pipeline 分支说明）

本分支为 Portal Desktop 新增「星图」视图：一张可视化流程画布，把 Being 的开发工作流建模为 **站（阶段容器）→ 节点（任务）→ 门（检查点）** 的有向图。左侧星轨列表管理多条流程，右侧详情面板查看与评论，画布支持缩放、折叠、专注与拖拽编排。

> 需求方与开发过程：本视图由 d5z/portal-desktop 的使用方（醇青 + 其 Being 伙伴）在实际使用中迭代提出，共 13 个功能 commit、约 20 轮真人验收。每轮需求均有书面需求包与自动化验收脚本，见文末索引。

## 功能全景

### 画布与视图
- **站 / 节点 / 门三级结构**：站是阶段容器（可折叠为紧凑条），节点是任务卡，门是流程检查点；模板内置 S01–S06 站、N01–N10 节点、H1–H4 门的开发工作流
- **缩放**：滚轮以指针为锚点缩放（0.5×–1.5×），紧凑阈值下站自动收起为单行
- **专注模式**：隐藏两侧面板只留画布，Esc 退出（修复过一轮 JS reload 不生效的坑，验收见 `v8-esc-fix` 报告）
- **折叠态**：站折叠后成员隐藏，站间链以紫色实线保持可见（收起态紫线优先，跨站投影线让位去重）

### 连线语义（站间链）
- **站与站直连**：站间为紫色实线，锚定在站容器左右边缘的专用 handle，不再借道站内首尾节点
- **站与成员锚定**：虚线表示站与成员节点的从属（默认站左侧连站内第一个节点、右侧连最后一个节点）
- **三态健康指示**：紫框 = 站内链完好；橙框 = 链中节点缺失/断链；普通 = 无站间链
- **拖拽语义**：站内拖动不改变成员顺序（锚定端点稳定）；跨站拖动按落点重新归属；拖拽碰撞时按相对位置自动避让布局（已实现，自动化验收进行中）

### 数据与模板
- **多工作流模板**：`beings-development`（默认）、`ai-product-workflow`、`bug-fix`，模板定义站/节点/门结构与转移边
- **本地持久化**：localStorage（`beings:star-map:v4`），带 schema 版本迁移与 `sanitizePipelineState` 清洗；旧数据自动升级
- **评论**：节点级评论，随画布状态一起持久化

## 工程说明

- 代码集中在 `desktop/renderer/pipeline/`：`page.tsx`（主组件）、`v4.css`（样式，全部带 `#pipeline-view` 前缀以避免与全局 `styles.css` 的遗留同名类冲突）、`models/`（schema、模板、评论）
- 画布基于 [React Flow (xyflow)](https://reactflow.dev/)
- 每个需求编号（P9–P17）对应：需求文档 → 实现 commit → 验收脚本与报告，全部入库于 `desktop/renderer/pipeline/`

## 验收方法

所有功能在隔离 Electron 实例（独立 user-data-dir + 独立调试端口）上验收，不走共享开发实例。验收脚本走 CDP 协议层：

- 页面刷新用协议级 `Page.reload` / `Page.navigate`（JS 层 `location.reload()` 在 Electron 中不生效，会读到旧内存态导致误报）
- 布局类断言用几何检测（节点 rect 重叠、位置），不信 DOM class 存在性
- 拖拽用 `Input.dispatchMouseEvent` 序列模拟真输入

## 文档索引

| 文档 | 内容 |
| --- | --- |
| `desktop/renderer/pipeline/v2-design.md` … `v5-design.md` | 各版本设计记录 |
| `desktop/renderer/pipeline/canvas-research.md` | 开源画布工具调研（15 条可借鉴点） |
| `desktop/renderer/pipeline/p16-anchor-semantics-requirements.md` | 站间连线语义需求包 |
| `desktop/renderer/pipeline/p17-collision-autolayout-requirements.md` | 碰撞自动布局需求包 |

## Commit 一览（自 origin/main 起）

```
c3220e6 feat(pipeline): add star-map pipeline board with stations, nodes and gates (V5)
0c200a5 feat(pipeline): V6 iteration (R1-R11) + canvas white-screen hotfix
b81cc3c feat(pipeline): V8 - detail panel, comments, canvas research + focus-mode Esc fix
4fec711 docs(pipeline): V8 Esc fix final report
94fd8f6 feat(pipeline): implement star map v9 requirements
3745bd2 feat(pipeline): clarify station-to-station links
25ebbbc feat(pipeline): P10 station-chain health indicator + collapsed purple-line fix
aec96b7 feat(pipeline): P11 explicit-broken station chains + P12 MR10 template sync
5c34c2e feat(pipeline): P13 rail toggles in toolbar corners + fix legacy CSS collision
118e6e5 feat(pipeline): P14 station anchor dashed edges
a1d5814 fix(pipeline): P15 in-station drag preserves nodeIds order
4a6b81f docs(pipeline): P16 station-chain + P17 collision autolayout requirements
feat(pipeline): P16 station-to-station links + P17 collision autolayout（本提交）
```
