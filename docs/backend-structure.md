---
status: current
summary: 后端模块、基础设施、纯共享逻辑、数据库与服务端导入边界
read_when:
  - 新建后端模块，拆分服务端实现或提取共享逻辑
  - 修改 server 依赖方向、数据库归属或服务端运行入口
---

# 后端结构

本篇负责 `apps/server` 的文件归属。接口输入输出、前后端类型和可共享导出读取 [API 契约](api-contract.md)，数据库变更读取 [数据库迁移](database-migrations.md)。后端内部调整不需要先读前端组件和页面布局规范。

## 应用与包边界

当前应用是 `apps/web`、`apps/h5`、`apps/server` 三个 Bun workspace。根包只放工具和跨包编排，不添加业务依赖。DB 客户端和 schema 留在 server：当前没有第二个运行时消费者，独立拆包会增加监听和构建边界；出现独立 worker、CLI 或第二个服务时再评估。

运行时、端口和启动方式见 [开发工作流](development-workflow.md)，生产进程与静态资源挂载见 [Docker 流程](../docker/README.md)。改变 API 消费方式或运行边界时按实际影响读取前端契约，不能只凭“本次仅改 server 文件”判断范围。

## 目录与依赖方向

| 目录 | 归属 | 允许的内部依赖 |
| --- | --- | --- |
| `infra/` | 外部资源 I/O、连接和句柄，例如 DB | 基础设施和纯共享逻辑；不导入 modules |
| `shared/` | 跨模块纯函数和纯类型 | 纯共享逻辑；不导入 modules 或持有外部资源 |
| `modules/<域>/` | 业务表、校验、接口与模块本地逻辑 | infra、shared；跨模块复用需核对业务归属并保持无环 |

单模块使用的工具和类型留在模块本地。是否连接外部资源决定 infra/shared 归属，不能因为多处调用就把 DB 查询搬入 shared。

新增模块可参考 `src/modules/supplier/` 的当前实现，按需建立：

```text
modules/<域>/
├── schema.ts       表定义和领域枚举
├── validation.ts   输入校验
└── routes.ts       接口与显式字段投影
```

`src/index.ts` 负责组合，在链上挂载 `.route("/api/<模块>", moduleRoutes)`。模块 routes 内写相对前缀的 `/list`、`/create` 等动作，不重复 `/api/<模块>`。`modules/example/` 是示例，不承接新业务。

新增接口需同时完成授权登记与覆盖，见 [授权指南](authorization.md#10-加一个新模块时要做什么)。身份与输入校验由服务端负责，前端守卫不能替代它们。

## 数据库归属

`drizzle.config.ts` 从 `src/modules/**/schema.ts` 收集表，新模块自动纳入迁移发现。改表同步 typed seed，收尾生成并审阅迁移，完整流程见 [数据库迁移](database-migrations.md)。

`infra/db.ts` 故意不给 `drizzle()` 传 schema，避免基础设施反向依赖所有业务模块。查询使用 `db.select().from(table)`，由业务调用方导入表；Better Auth 在自己的模块显式接收 schema。需要 `db.query` 关系查询时应先重审 schema 组合位置，不能直接把业务聚合塞进 infra。

## 导入与类型入口

服务端只用相对路径导入。前端通过类型导入把服务端源码纳入自己的 TypeScript program 后，服务端的 `#/` 会被前端 paths 误解析；相对路径避免两个前端各自别名造成的冲突。

`client-type.ts` 是统一客户端入口，当前 exports 仍指向源码，没有独立声明制品。哪些值可以进入浏览器、如何保持类型推导，以 [API 导入清单](api-contract.md#客户端导入清单) 为准，不把服务端根入口变成浏览器运行时依赖。
