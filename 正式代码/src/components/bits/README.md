# React Bits 组件

来源：https://github.com/DavidHDev/react-bits 的 `src/ts-default`（TS + CSS 版），提交 `4dc7b5b`（2026-10-31）。
许可：MIT + Commons Clause（见 `LICENSE.md`）——可作为本应用的一部分使用和修改，不得单独出售或再分发组件本身（含改写版）。

接入时的改动（agents.md「交互组件 React Bits」的接入须知）：

- 用户可见文案和 `aria-label` 改成中文。
- 图标换成项目自己的线条图标（`components/ui/icon.tsx`），不引入 Hugeicons。
- 默认配色改成项目的颜色变量（`app/globals.css`）。
- 修上游缺陷：卸载时 `cancelAnimationFrame` 后把编号清零，StrictMode／热更新重新挂载后动画才能重新启动。
- 去掉用不上的功能，只保留本项目用到的部分；具体见各文件开头的注释。
