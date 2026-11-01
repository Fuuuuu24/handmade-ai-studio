# 一间管理后台

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

本地 Node.js 24 原生服务 + HTML/CSS/JavaScript，独立运行，无新增依赖。先交互原型，再独立管理正式版。

## Users

手作影像工作台的项目维护者，在本机查看和维护系统提示词与模型列表。

## Product Purpose

直观查看实际源码中的配置，保存独立管理草稿，并与最新源码比较。

## Capabilities and Constraints

允许从主产品单向读取；禁止写回主产品。后台配置必须明确尚未生效于主产品。无模型调用、密钥管理、远端部署。正式版数据单独存文件；原型为浏览器本地演示。

## Brand Commitments

参考用户提供的 CBI Admin 后台的导航、表格、内容编辑方式；结合一间的简体中文、精简密度。

## Evidence on Hand

主项目 instructions.ts、white.ts、models.ts；用户提供的 CBI Admin 截图及 cbi-lite/apps/admin 源码。
