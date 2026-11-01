---
name: 一间管理后台
description: 参考 CBI Admin 的本地提示词与模型配置界面
colors:
  primary: "#b8ef35"
  primary-hover: "#a8df28"
  navigation: "#7953c8"
  navigation-bg: "#f0eafa"
  canvas: "#f7f8fa"
  surface: "#ffffff"
  text: "#20232b"
  muted: "#677182"
  line: "#e3e6ec"
typography:
  heading:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "24px"
    fontWeight: 650
    letterSpacing: "-0.025em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "13px"
    lineHeight: 1.65
rounded:
  panel: "12px"
  button: "7px"
  field: "6px"
spacing:
  group: "24px"
  page: "34px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#263014"
    rounded: "{rounded.button}"
    padding: "6px 13px"
    height: "34px"
---

# Design System: 一间管理后台

## Overview

用户指定的 CBI Admin 是视觉参考。界面用于维护配置，采用固定左导航、浅灰画布、白色编辑区与表格。风格描述据实现记录，未把新的品牌比喻记为用户决策。

## Colors

黄绿色用于保存、新增和同步等关键动作；紫色用于当前导航和编辑链接。来源一致、后台修改、停用以文字和轻量状态底色表达，不能只靠颜色。

## Typography

全无衬线，24px 页面标题、16px 面板标题、13px 正文、12px 操作与说明、11px 元信息。只有 API ID、文件路径和摘要使用等宽字体。

## Layout

桌面侧栏 226px，顶栏 62px；内容最大 1600px。提示词列表与宽编辑器并排，1000px 以下改为上下布局。1120px 以下侧栏缩至 190px；760px 以下导航进入顶部。表格在自己容器内横向滚动。

## Elevation & Depth

面板用单层细边框区分，常态不加阴影。只有操作结果 toast 使用 `0 8px 25px #16203120`，0.18 秒透明度与位移反馈；尊重减少动态效果设置。

## Shapes

面板使用 panel 圆角，按钮与表单分别使用 button、field 圆角。采用一致的 1.65px SVG 线条图标，不用 emoji 代替操作图标。

## Components

按钮有 hover、禁用和焦点状态；错误持续显示并提供恢复入口。模型编辑是普通页面，不使用狭窄弹窗。长提示词具备章节导航、原文/草稿/对比/预览/版本视图；未保存编辑切换这些视图时保留。

## Do's and Don'ts

明确写出后台配置的独立作用范围；主产品原文标注来源快照时间。保留真实来源与差异。不要加入虚构运行指标、假连通状态、模型调用或写回入口。
