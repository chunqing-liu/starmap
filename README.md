# 星图（Starmap）

beings 客户端的多人可视化流程看板：站（阶段）→ 节点（工作项）→ 闸口（评审），支持站间连线、碰撞自动布局、拖拽快速建卡、专注模式、评论与详情面板，以及把流程「演」出来的像素办公室视图。

> 规划中：本仓库将改造为独立插件，以插件形式加载到 beings 客户端（portal-desktop），不再作为客户端内置页面直接使用。

## 仓库结构

```
pipeline/            看板主体（原 portal-desktop 的 desktop/renderer/pipeline/）
  page.tsx           看板页面入口
  v4.css             样式
  v2~v5-design.md    各版本设计文档
  models/            数据模型：schema / status / templates / 内置工作流模板
  office/            像素办公室视图：把流程执行「演」出来（人物、工位、讨论、交接）
    vendor/          PixOffice 运行时与渲染内核（第三方，见 THIRD_PARTY_NOTICES）
README_PIPELINE.md   开发者说明（源自 portal-desktop 仓库）
shared-types.ts      共享类型（源自 desktop/shared/types.ts）
```

## 历史

代码原先住在 [portal-desktop](https://github.com/d5z/portal-desktop) 的 `feature/pipeline` / `feature/office-collab` 分支（`desktop/renderer/pipeline/`），2026-09 起经 V4→V9、P1→P6R4 迭代后拆出为独立仓库，保留全部历史设计文档与交付记录。

## License

MIT（沿用 portal-desktop）
