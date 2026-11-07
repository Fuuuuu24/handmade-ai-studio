# GitHub 协作与权限说明

> 更新：2026-11-06。

## 公开协作方式

公开仓库允许其他 GitHub 用户查看项目、Fork、创建 Issue 和提交 Pull Request。外部参与者不自动获得本仓库写入权限，不能因此直接合并。

目标治理规则：所有文件由仓库所有者作为唯一指定代码评审人；`main` 要求通过 PR 修改，至少一个批准并要求代码所有者批准；新提交使旧批准失效，要求对话解决；禁止强推及删除主分支，不开启自动合并。

管理员绕过规则保留给仓库所有者，以处理所有者自己的改动和紧急维护。若将其他账号设为管理员，合并权边界也会改变，须重新审查规则。

## 配置状态

- 仓库：[Fuuuuu24/handmade-ai-studio](https://github.com/Fuuuuu24/handmade-ai-studio)，公开，默认分支 `main`，Issue 已开启。
- CODEOWNERS：`.github/CODEOWNERS` 指定 `@Fuuuuu24` 为所有文件的评审人；需配合分支保护中的「要求代码所有者评审」才生效。
- Pull Request：#1—#8 均已由所有者合并（2026-10-29 至 2026-11-04）：#7 凭据统一管理、文档整理、删除原型 v2（2026-11-02 合并）；#8 2026-11-03 的 badcase 修复与静态无字商品图测试集（2026-11-04 合并）。贡献者账号 `wh3474812446-design` 通过自己的 fork 提交。
- 正式代码（M2）和独立管理后台在分支 `feat/m2-workbench` 上开发（2026-10-31 从 `origin/main` 拉出），2026-11-01 推到 fork 并提交 PR #6，同日由所有者合并；凭据统一管理随 PR #7 于 2026-11-02 合并；2026-11-03 的 badcase 修复与测试集在分支 `fix/badcase-2026-11-03` 上，2026-11-04 提交 PR #8，同日合并。2026-11-06 的 badcase 拍板实现（BC-006 房间参考、BC-013 原话核对、批准前提醒）在本地分支 `feat/room-ref-said-quote`（从合并后的 `origin/main` 拉出），未提交、未推送。之后的改动从最新 `origin/main` 拉新分支；推送和建 PR 每次需发起人明确授权。
- 分支保护：尚未配置。
- Issue 模板、PR 模板和 `Source checks` 工作流（`.github/workflows/source-checks.yml`）已纳入项目：检查旧 `原型/` 的服务脚本，2026-11-01 加了 `正式代码/` 的 `app` 任务（单元测试、类型检查、lint、构建和全流程测试），随 PR #6 第一次在 GitHub 上运行，PR 和合并后的 `main` 上都通过；不覆盖 `原型-v3/`、`管理后台/`。
- 自定义许可证尚未选择；仓库公开不能表述为已经采用某项开源许可。

## 维护提示

- 不将提交 PR 视作自动批准，不向陌生贡献者直接授予写入或管理权限。
- PR 工作流使用只读权限，不向 Fork PR 提供部署凭据，不使用 `pull_request_target` 执行贡献者代码。
- 基础语法检查不等于产品功能已完成，也不等于生成结果已通过真实性与风格验收。

## 配置依据

- [GitHub：代码所有者](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)
- [GitHub：受保护分支](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
