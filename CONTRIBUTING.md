# 星图团队协作

## 开发与发行入口

- [公司 GitLab / agent-team/starmap](http://newgit.d5techs.com.cn/agent-team/starmap) 是团队源码、版本更新及正式发布的唯一依据（source of truth）。源码仓与团队数据仓分别管理。
- 后续源码、版本标签与下载优先由本 GitLab 仓提供；发行必须从本仓已审核提交和标签构建。GitLab 源码归档不等于可安装的插件包。
- 既有发布物仅作为过渡保留，本次迁入不删改、不重发。只有 GitLab 不便直接分发时，才可另行将 GitLab 内容复制到分发镜像；镜像不得反向成为开发或发布源。本轮不新增其他渠道操作，也未配置自动镜像或双向同步。

## 分支与 Merge Request

2026-10-16 核验的实际规则：main 为受保护分支，推送和合并均要求 Maintainer（40）或以上；不允许 force push。Developer（30）权限不意味着能够绕过 main 保护。继承组权限的 Developer 可在项目中创建非受保护的功能分支，向功能分支提交后发起以 main 为目标的 Merge Request，由具备权限的维护者评审合并。以后以 GitLab 的实时保护设置为准。

新克隆可使用：

```sh
git clone http://newgit.d5techs.com.cn/agent-team/starmap.git
cd starmap
git switch -c feature/short-description
```

已有工作区保留原 origin 配置，不代表继续将其作为上游；添加并使用明确的 gitlab remote，从 gitlab/main 创建功能分支，并只向 GitLab 推送后续开发与发布所需提交。不要强推或重置他人分支。

## 检查与数据安全

- 使用 Node.js 22.12+，依次执行 npm ci、npm run check；可选宿主与 UI 测试的配置和 skip 边界见 README。
- 代码、测试夹具和实际公司业务数据分开。不要提交访问令牌、账号会话、本地缓存、真实联网报告、测试空间内容或用户 profile。
- 通过受支持的 Git credential helper 或正常登录鉴权；不要把凭据写进 URL、脚本、仓库、日志或聊天。公司 HTTP 地址未加密，只使用已授权的精确 origin，不降低重定向鉴权隔离、TLS 或宿主安全约束。
- 修改星图源码不等于获得数据仓内容写入授权；真实数据写测试仍须使用明确批准的隔离目标。

本次迁入保留 v1.5.0 正式源码历史和原标签；本说明是其后的独立文档变更，不修改插件功能或版本。
