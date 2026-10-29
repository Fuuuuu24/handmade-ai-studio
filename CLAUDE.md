@agents.md

## 运行环境说明（Claude Code 专用，优先于 agents.md 中的对应内容）

- 主开发在 Windows 上，由 Codex 进行；`agents.md` 中的项目位置（`C:\Users\asus\Desktop\手作`）、PowerShell 及相关命令均以 Windows 环境为准。
- Claude Code 运行在 macOS 上。项目位置和运行环境以本机实际情况为准：使用本机项目路径和 zsh / bash 命令，不照搬 Windows 路径与 PowerShell 命令。
- 不修改 `agents.md` 中的 Windows 路径和命令；它们服务于 Windows 侧的 Codex 开发。

## GitHub 与 PR 环境（Claude Code 专用）

- 本机 `gh` 登录账号为 `wh3474812446-design`，不是仓库所有者 `Fuuuuu24`，对上游仓库没有直接写入权限。
- 远端：`origin` = 上游 `Fuuuuu24/handmade-ai-studio`（只用于 fetch）；`fork` = 自己的 fork `wh3474812446-design/handmade-ai-studio`（push 目标）。
- 提 PR 流程：从最新 `origin/main` 拉出功能分支 → 推送到 `fork` → `gh pr create --repo Fuuuuu24/handmade-ai-studio --base main --head wh3474812446-design:<分支名>`。
- 不向 `origin` 直接推送；PR 由 `Fuuuuu24` 评审合并，本机不执行合并。
- 推送和创建 PR 仍需用户每次明确授权（见全局规则）。
