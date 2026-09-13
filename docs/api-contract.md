---
status: current
summary: 当前 Hono API、业务信封、客户端类型与运行时导入边界
read_when:
  - 新增或修改接口、输入输出、分页或校验
  - 调整客户端类型、共享导出、认证守卫或跨端调用
---

# 前后端契约

**不遵循 REST，业务语义和 HTTP 协议解耦，但不引入 RPC 框架（不上 tRPC/oRPC）**——就用 Hono 本身 + 一份共享约定。讨论和实测数据见 [docs/architecture-decisions.md](architecture-decisions.md#前后端类型安全)，这里只写规则：

- **路径 = `/api/<模块>/<动作>`，动作名不重复模块名。** 用 `getServerInfo`、`submitEcho` 这种动词开头的名字，不要 `/projects/:id` 这种资源路径——前缀只是命名空间。业务接口**全部用 POST**，HTTP 动词不承载业务含义；`GET /api/file/:fileId` 是为浏览器原生预览/下载保留的传输层例外。一个模块有多个子资源时拆成两个前缀，不要挤一个前缀又在动作名里加前缀区分。
- **HTTP 状态码不表达业务结果，只有 `code` 字段表达。** 见 `shared/result.ts` 的 `ApiResult<T>`。业务失败（未登录、字段校验不过）也返回 HTTP 200，前端靠 `result.code` 分支。字段校验失败由 `jsonBody` 的 hook 返回业务信封；JSON 无法解析、未捕获异常等传输或运行错误可能返回非 200，不要混淆字段校验与请求体解析。
- 入参用 `shared/validate.ts` 的 `jsonBody(Schema)`，出参用 `c.json(ok(...))` / `c.json(err(...))`，**两边都过信封**。**需要 json 以外的校验目标（form/param/query）时用同一文件里的 `validate(...)`，不要直接调 `zValidator`**——前两者会把 schema 记进 `validatedInputs`，直接调 `zValidator` 的路由在接口文档里会变成"入参：无"。
- **绝对不要给 `ok()` / `err()` 补 `: ApiResult<T>` 返回类型标注。** 它们故意让 TS 自然推导，`c.json(ok(row))` 就是 `{code:"OK"; data: Row}` 一种。补上标注后每个接口的响应类型都变成「OK ∪ 全部四种错误」，前端 `Extract<响应,{code:"OK"}>` 再也取不回精确的 `data`。理由写在 `shared/result.ts` 的注释里。
- 分页统一用 `shared/pagination.ts` 的 `PageInput.extend({ …筛选 })` 作入参、`{ list, total }` 作出参，别各模块自己定 `pageNo`/`pageNum`/`current`。
- 管理端需要登录的模块在路由链头挂 `requireUser`，然后用 `c.get("authedUser")`（非空），不要每个 handler 各写一遍 `c.get("user")` 判空。**`.use(requireUser)` 的作用域就是模块自己的前缀**，不依赖链上其他模块的注册顺序——`file` 模块刻意不挂它，靠的正是这一点。
- 路由必须**接在链上**（`app.post(...).post(...)`），单独写 `app.post(...)` 不会进 `AppType`。客户端统一由各前端 `shared/lib/api.ts` 使用 `client-type.ts` 的 `hcWithType` 创建，业务调用不另建裸 `hc` 客户端。当前 exports 仍指向源码，尚未建立独立声明制品；这里是统一类型入口，不承诺已经消除所有消费方的类型计算。
- 前端与服务端的类型、运行时导入按下方清单处理；不从服务端根入口导入运行时值。
- **接口清单由 `scripts/gen-api-docs.ts` 从运行时的 `app.routes` 生成**，产物 `apps/web/public/docs/{api.html,api.md}` 不进 git，`bun run build` 会先跑一遍。接口上方 JSDoc 首段会被抓成说明，值得写得像给调用方看的。它**不写出参字段**，出参以 `routes.ts` 的字段投影和 `hc<AppType>` 推导为准。这份文档走静态资源那条路、挂在 `sessionMiddleware` 之前，**任何人不登录就能访问**；要收起来就把生成目标改成一条带 `requireUser` 的路由。

**每个前端都和自己的 API 同源，所以整个仓库不需要 CORS。** 开发靠两个 `vite.config.ts` 各自代理 `/api` 到同一个后端；生产靠两个端口各自提供完整 `/api`。**不要因为"h5 和管理端是两个域名"就去加 `hono/cors`**——域名不同不等于跨域，两条路各自同源。只有真把前端和 API 拆到不同 origin 才需要那三件事（`hono/cors` + `trustedOrigins` + `VITE_API_URL`），当前架构刻意避开了这种形态。

## 客户端导入清单

| 子路径 | 当前用法与边界 |
| --- | --- |
| `@repo/server` | 前端仅 `import type`。根入口可触达 DB 和服务端初始化，不得作为浏览器运行时依赖 |
| `@repo/server/client-type` | 两个前端的 `shared/lib/api.ts` 运行时导入 `hcWithType`；模块只运行 Hono 客户端，AppType 为类型导入 |
| `@repo/server/dict` | 纯字典运行时数据；`src/shared/dict/**` 保持零 import，新增依赖需重新评估该边界 |
| `@repo/server/permissions` | 现有前端业务类型使用 `PermissionKey`；导航测试读取 `PERMISSION_KEYS`。文件自身保持零 import；这不授权把任意服务端值用于浏览器 |

除客户端创建入口外，前端 `shared/**` 不依赖服务端业务类型。根 exports 已有的子路径是显式能力，不代表所有新子路径自动适合浏览器。声明包优化和新共享包需要单独设计，不能在整理文档时顺带实施。

## 身份与渲染边界

所有业务访问校验在服务端执行。管理端登录、停用及 session 缓存见 [用户与认证](user-management-design.md)；角色、权限映射、新接口登记和覆盖检查见 [授权](authorization.md)。H5 使用独立访问链路，见 [H5 指南](h5-itinerary.md)，不复用管理端身份。

两个前端的渲染位置、路由 loader 和共享代码边界见 [代码结构](code-structure.md#运行与渲染模型)。端口、静态挂载与 cookie 部署行为见 [Docker 流程](../docker/README.md)。

## 修改业务写入之前

先用 `bun run docs:list --query <领域或行为>` 查相关契约，再读目标模块附近的注释与测试。通用 API 范式不能替代模块的事务、增量意图或并发约束。新模块以 supplier 为实现参考，并按 [CRUD 清单](crud-page-guide.md#新建一个-crud-模块的检查清单) 更新权限、迁移与种子。
