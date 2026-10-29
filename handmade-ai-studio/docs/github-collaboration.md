# GitHub 协作与权限说明

## 公开协作方式

公开仓库允许其他 GitHub 用户查看项目、Fork、创建 Issue 和提交 Pull Request。外部参与者不自动获得本仓库写入权限，不能因此直接合并。

目标治理规则：所有文件由仓库所有者作为唯一指定代码评审人；`main` 要求通过 PR 修改，至少一个批准并要求代码所有者批准；新提交使旧批准失效，要求对话解决；禁止强推及删除主分支，不开启自动合并。

管理员绕过规则保留给仓库所有者，以处理所有者自己的改动和紧急维护。若将其他账号设为管理员，合并权边界也会改变，须重新审查规则。

## 配置状态

- 当前：本地协作文件已准备；GitHub 尚未认证，仓库尚未创建，分支保护尚未应用。
- 仓库地址、所有者、CODEOWNERS 与实际保护状态将在认证和创建完成后更新。
- Issue 模板、PR 模板和基础源码语法检查已纳入本地项目。
- 自定义许可证尚未选择；仓库公开不能表述为已经采用某项开源许可。

## 维护提示

- 不将提交 PR 视作自动批准，不向陌生贡献者直接授予写入或管理权限。
- PR 工作流使用只读权限，不向 Fork PR 提供部署凭据，不使用 `pull_request_target` 执行贡献者代码。
- 基础语法检查不等于产品功能已完成，也不等于生成结果已通过真实性与风格验收。

## 配置依据

- [GitHub：代码所有者](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)
- [GitHub：受保护分支](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
