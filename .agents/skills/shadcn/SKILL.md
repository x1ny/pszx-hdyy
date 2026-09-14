---
name: shadcn
description: 在本仓库 apps/web 管理端新增、组合、修改或更新 shadcn UI 组件、表单、反馈和样式时使用，复用已有组件并核对 Base UI API。不用于纯后端、数据库、文档整理、H5 页面或仅调整前端数据查询且不涉及 UI 的任务。
metadata:
  claude-user-invocable: "false"
---

# 管理端 shadcn 开发

先读 [管理端 UI](../../../docs/web-ui.md)，再查看 `apps/web/components.json`、目标组件和实际调用方。本篇提供操作流程；项目选型、配色与组件归属只在当前指南维护，不按本目录的上游通用示例切换它们。

## 按任务取用

- 只组合已有组件：先查本地导出与 props，复用已有实现。涉及表单、筛选、列表视觉时再读 [CRUD 指南](../../../docs/crud-page-guide.md) 对应章节。
- 新建页面或提取复用组件：读取 [前端结构](../../../docs/frontend-structure.md) 决定归属；普通局部接线无需重读全部结构指南。
- 新增 primitive、更新上游或不确定 API：在 `apps/web` 用 Bun/bunx 查询当前 CLI 帮助、组件文档和预览；先比较本地版本及定制，再合入需要的改动。
- 管理端与 H5 混合任务：本 skill 只用于 Web 部分，H5 按自己的专题执行。

## CLI 与组件资料

项目配置直接读取文件，不依赖宿主在正文中执行动态命令。确需更多上下文时再执行：

```sh
# 在 apps/web 执行
bunx --bun shadcn@latest --version
bunx --bun shadcn@latest info --json
bunx --bun shadcn@latest docs button dialog
```

上例的组件名按任务替换；`@latest` 是按需调用的上游 CLI，不是仓库已锁定依赖。新增或更新时记录实际版本，先核对当前帮助中的预览参数，再执行最小范围命令。仅复用已安装组件无需运行联网 CLI。

下列是保留的上游参考，按具体问题选读。示例中的 npm/pnpm 命令在本项目改用 Bun；框架默认示例、主题、表单库和 toast 选择以管理端 UI 指南为准。

| 问题 | 参考 |
| --- | --- |
| Base UI 的 render 与 Radix asChild 等 API 差异 | [base-vs-radix](rules/base-vs-radix.md) |
| Field、输入组合、校验状态 | [forms](rules/forms.md) |
| Dialog 标题、菜单分组等组件组合 | [composition](rules/composition.md) |
| token、布局、图标、主题扩展 | [styling](rules/styling.md)、[icons](rules/icons.md)、[customization](customization.md) |
| 新增/更新命令、registry 来源 | [CLI](cli.md)、[registry](registry.md) |
| 确实涉及聊天界面 | [chat](rules/chat.md) |

## 收尾

审阅新增文件的 alias、组件 API、业务归属及本地定制是否保留。执行与修改相称的类型、文件检查及浏览器验收；交互重点是焦点、键盘、禁用、错误与反馈，表单验收沿用 CRUD 指南。不要把类型通过报告为交互通过。
