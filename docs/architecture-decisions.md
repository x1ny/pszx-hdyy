# 架构决策记录

这份文档记录"为什么长这样"，不是使用说明——用法看 [AGENTS.md](../AGENTS.md) 和 [README.md](../README.md)。

## 前后端类型安全

### 目标

三条诉求，都要同时满足：

1. 后端显式定义输入/输出 schema（不是靠 handler 返回值反推）
2. 端到端类型安全，改了 handler 前端编译期就能发现
3. 业务语义和 HTTP 协议解耦——不遵循 REST 那套"路径表达资源、动词表达操作、状态码表达结果"

### 为什么不是 oRPC / tRPC

这是最先被考虑、也最贴合"业务语义脱离 HTTP"这条诉求的方案——procedure 按业务域组织成树，`.errors()` 声明的业务错误码天然跟 HTTP status 无关，`isDefinedError` 提供编译期收窄。技术上完全成立。

最终没选，是因为用户明确要求"前后端衔接这块有框架保障就行，不想再多引入一层 RPC 框架"——衡量下来，Hono 自己已经能做到同样的三条诉求（见下），多引入 oRPC 换来的增量是路由从 procedure 树自动派生、以及更精致的错误收窄语法，但这不是必须的，模板要保持精简。

### 最终方案：纯 Hono + Zod + 一份共享信封

**不是自己发明一套 RPC 协议**，是三个框架自带的机制拼起来：

- `hc<AppType>()`（Hono 官方 RPC 客户端）—— 端到端类型推断，不用 codegen
- `@hono/zod-validator` —— 输入侧的 schema 校验，官方中间件
- 一个 12 行的共享类型 `ApiResult<T>`（[`apps/server/src/shared/result.ts`](../apps/server/src/modules)）—— 输出侧的"business code, not http status"约定

三条诉求对照：

| 诉求 | 落地方式 |
|---|---|
| 显式 schema | 每个端点自己的 `schemas.ts`（Zod），handler 用 `c.req.valid("json")` |
| 端到端类型安全 | `hc<AppType>` 全自动推断，改 handler 前端编译期报错 |
| 脱离 REST 语义 | 路径是动作名（`getServerInfo`、`submitEcho`），全部 POST；业务结果放在 body 的 `code` 字段，不用状态码表达 |

**状态码的边界**：只有两类响应会返回真正的非 200 —— 请求体不是合法 JSON（`zValidator` 的自定义 error hook 拦下）、handler 内部抛出未捕获异常（顶层 `app.onError`）。这两类是"传输层出了问题"，跟业务结果无关；除此之外一律 200，`code` 字段承担 `OK` / `UNAUTHORIZED` / `VALIDATION_ERROR` 等所有业务状态。前端**只看 `result.code`，不看 `res.status`** 做业务判断。

**曾经考虑过 `@hono/zod-openapi`**（Zod schema 同时驱动运行时校验和 OpenAPI 文档），最后没用：OpenAPI 文档的价值在于给"你控制不了的消费方"看（外部团队、非 TS 客户端），当前是同仓库同人维护前后端，`hc<AppType>` 已经提供了比文档更强、且不会过期的保障，为此把每个端点从 ~6 行加到 ~20 行不值。真需要文档/给外部消费方用的那天，`OpenAPIHono` 是 `Hono` 的父类，能平滑升级，不是单向门。

### 已验证：discriminated union 在同状态码下依然正确收窄

方案能不能成立，关键在一个具体的类型系统问题：`ApiResult<T>` 的两个分支（`{code:"OK",data}` 和 `{code:"ERR",message}`）返回的 **HTTP 状态码都是 200**，`hc` 客户端能不能仅凭 `code` 字段正确推出可辨识联合类型、并在 `if (result.code === "OK")` 里正确收窄？

写了最小复现验证过（两个分支都 `c.json(..., )` 默认 200），结果：**可以**。`result.code === "OK"` 分支内 `.data` 可访问、`.message` 编译报错；没收窄前两个字段都访问不到。这是 Hono 自己的类型系统能力（`c.json()` 返回值的联合来自 handler 函数返回类型的正常 TS 推断），不依赖任何额外库。

## AppType 的编译期性能

Hono 官方文档有一条警告："路由越多，IDE 越慢"——单个 Hono 实例链的路由数量增长时，`typeof routes` 这个类型的合并开销会增大，拖慢 `tsc` 和编辑器的类型检查。

**这条警告和"是否显式定义 schema"无关，也不会被"写清楚类型"绕开**——实测过，见下。

### 实测数据

用真实的 `apps/server` tsconfig 和依赖跑的（不是纸面推算），对比"handler 返回值靠推导"vs"`c.json<T>()` 显式声明、`T = z.infer<ZodSchema>`"：

| 条件 | 25 条路由 | 75 条路由 |
|---|---|---|
| 基线（这批路由不存在） | 1860 ms | — |
| 推导（`c.json({...})`，无类型标注） | 1975 ms | 2018 / 2054 ms（两轮） |
| 显式 Zod（`c.json<T>()`） | 1978 ms | 2088 / 2115 ms（两轮） |

结论：

- 两条曲线随路由数量**同步**上涨，显式类型没有改变 Hono 路由链本身的 scaling 特性——这条性能警告的根源是路由链的类型合并机制，不是"类型有没有名字"
- 显式 Zod 版本在 75 条路由时反而比推导版本多花 60~100ms——`z.infer<>` 把 Zod 自己的泛型体系翻译成 TS 类型，这本身有编译期代价，是社区里有据可查的问题。所以显式 schema 不是在"避开"这条警告，是在其之上又加了一层自己的、独立的开销
- 但两者的绝对数字都很小：75 条复杂路由，涨幅也就一成多。当前模板只有 2~3 个端点，这条警告离触发还差两个数量级，现在不用为此改设计

### 已经采纳的免费防御

`apps/server/src/client-type.ts` 用官方的 `hcWithType` 预编译技巧——把类型计算挪到 `tsc` 编译期算好，IDE 不用每次重新展开整棵类型树。零行为差异，纯包装，现在就用，不用等到规模变大。

真正的拆分手段（用 `.route()` 把大 app 拆成按业务域组织的子 app，见 [AGENTS.md](../AGENTS.md#后端目录结构按业务功能拆不按类型拆) 的 `modules/` 结构）等路由数量明显增长、`tsc` 肉眼可感变慢时再做，不是现在的优先级。
