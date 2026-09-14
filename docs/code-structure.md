---
status: reference
summary: 旧结构指南的兼容索引；当前规则已按前端与后端拆分
read_when:
  - 从旧链接进入结构指南，需要找到迁移后的当前正文
---

# 代码结构索引

当前指南已按任务拆分。直接读取相关端，跨端契约变更再组合阅读，不需要通读所有链接。

| 任务 | 当前正文 |
| --- | --- |
| 前端页面、路由、共享代码、SPA 渲染 | [前端结构](frontend-structure.md) |
| 服务端模块、基础设施、DB 和导入 | [后端结构](backend-structure.md) |
| 接口、类型和浏览器可用导出 | [API 契约](api-contract.md) |
| 管理端组件与 shadcn 适配 | [管理端 UI](web-ui.md) |

以下标题保留旧链接锚点；规则只在目标文档维护。

## 运行与渲染模型

见 [前端运行与渲染模型](frontend-structure.md#运行与渲染模型)；包与数据库归属见 [后端应用边界](backend-structure.md#应用与包边界)。

## 后端目录结构：基础设施 / 业务模块 / 共享逻辑

见 [后端结构](backend-structure.md)。

## 前端目录结构：页面本地优先

见 [前端结构](frontend-structure.md)。

## 路径别名与路由生成

见 [前端命名与生成文件](frontend-structure.md#命名与生成文件) 和 [服务端导入](backend-structure.md#导入与类型入口)。
