---
status: current
summary: Web 与 H5 的页面目录、共享代码、SPA 渲染及路由生成边界
read_when:
  - 新建前端页面，移动组件或提取跨页面代码
  - 修改前端路由、路径别名、SSR 假设或浏览器运行边界
---

# 前端结构

本篇适用于 `apps/web` 和 `apps/h5`。管理端组件选型与样式读取 [管理端 UI](web-ui.md)，H5 交互读取 [H5 指南](h5-itinerary.md)。只调整后端内部实现时无需读取本篇；改变浏览器消费的契约时按影响范围组合阅读 [API 契约](api-contract.md)。

## 运行与渲染模型

两个前端都是纯客户端 SPA，没有 SSR 或 server function。各自的 `index.html` 是 HTML 壳，`src/main.tsx` 挂载应用；路由 `beforeLoad`、`loader` 和组件全部在浏览器执行。路由守卫、菜单过滤和按钮显隐不构成安全边界，每个受保护接口必须在服务端独立校验。

两个前端独立维护身份、主题和 UI，不互相 import。共同消费的服务端导出按 [API 导入清单](api-contract.md#客户端导入清单) 使用；确有跨端纯前端共享需求时再评估 `packages/`，不因外观相似预建共享包。运行入口见 [开发工作流](development-workflow.md)，静态挂载见 [Docker 流程](../docker/README.md)。

## 目录与依赖方向

两个应用各自使用以下分层；目录按实际需要创建，H5 不为了与 Web 对称预建 feature 或 UI 目录。

| 目录 | 归属 | 允许的内部依赖 |
| --- | --- | --- |
| `app/` | 全应用一份的组合根、配置和布局 | 各层 |
| `routes/` | 路由与页面本地实现 | features、shared；不导入其他路由的私有实现 |
| `features/<域>/` | 多页面共用的业务逻辑 | shared、其他 feature；必须无环，不导入 routes/app |
| `shared/` | 不认识业务的通用组件、纯工具 | shared 内部及三方库 |

业务逻辑在第二个真实消费方出现时提升到 feature，纯 UI 可等第三个消费方再提取。只有一个页面使用时，组件、hooks、查询和工具留在页面本地；消费方降回一个时也应迁回。跨路由引用他人的 `-` 私有文件说明需要重新裁决归属，不能用相对路径绕过边界。

是否认识业务，按是否导入领域类型、调用业务 API 或编码业务规则判断；只接收 props、操作 DOM 的组件才可能进入 shared。

### routes：页面本地优先

- `-` 前缀文件和目录被 TanStack Router 忽略；单文件辅助模块也必须带前缀。
- 常用名字为 `-components/`、`-hooks/`、`-queries.ts`、`-utils.ts`。新增命名模式时同步在本篇说明用途，不为每页任意增加分类。
- 现有 `-draft.ts` 用于页面编辑草稿：为避免把表单状态伪装成通用工具，保留这个明确的本地命名；不据此为每个页面预建草稿模块。
- 页面没有本地辅助代码时用单文件；需要本地目录时改为同名目录的 `index.tsx`，不并存两种组织方式。生成的 route id 可能增加尾 `/`，需核对 Link 类型及调用方，访问 URL 不因此改变。
- 测试放 `-` 目录内，或由 `tsr.config.json` 的 `routeFileIgnorePattern` 排除，不能让测试文件成为路由。
- pathless layout 也占物理目录层级；移动布局时连同本地实现移动。已开启路由自动代码分割，避免无必要地把页面实现搬到全局入口。

以下只展示组织方式，具体业务文件以目标实现为准：

```text
routes/_authenticated/supplier/
├── index.tsx
├── -queries.ts
├── -utils.ts
└── -components/
    ├── supplier-form-dialog.tsx
    └── supplier-detail-sheet.tsx
```

### features：按业务域复用

- 按业务域分目录，如 `features/auth/`，不建 `features/hooks/` 等技术分类。
- 内部按需使用 `queries.ts`、`mutations.ts`、`components/`、`hooks/`、`types.ts`，不预建空目录。深度超过两层时重新评估域边界。
- 当前不加 barrel `index.ts`；跨 feature 直接导入实际文件且保持无环。出现明确的公开/私有 API 需求时再评估封装。
- 单页面业务不为了形式统一搬进 features；不在查询模块之外再叠一层 `services/`。

### shared：不依赖业务

`shared/**` 不导入 `@repo/server`，唯一例外是传输层客户端 `shared/lib/api.ts`，具体导出能力见 [API 契约](api-contract.md#客户端导入清单)。可用 `rg '@repo/server' apps/web/src/shared apps/h5/src/shared` 核对。

通用组件放 `components/`，hooks 放 `hooks/`，工具放 `lib/`；不再并列建立 `utils/`。Web 的 `components/ui/` 用于 vendored shadcn primitives，细分归属见 [管理端 UI](web-ui.md#组件归属)。H5 不因此引入 shadcn。

### app：组合根

只有全应用一份且各页面间接依赖的配置、provider 和布局进入 app。`src/main.tsx`、`src/styles.css` 留在 src 根；`routes/__root.tsx` 留在 routes，负责根级挂载，具体布局放 `app/layout/`。

## 命名与生成文件

文件使用 kebab-case，一个文件一个主导出，组件名对应文件名；props 类型就地写 `XxxProps`。不采用 `components/common` 与 `components/business` 的双目录分类。

Web、H5 的 `#/*` 分别指向各自的 `src/*`，在各包 `package.json` 的 imports 和 `tsconfig.json` 的 paths 中保持一致，不能借别名跨端导入。

`routeTree.gen.ts` 是生成物，不手改。Vite 中 `tanstackRouter()` 先于 `viteReact()`；路由变更后执行对应包的 `generate-routes`。大画布编辑路由使用父动态参数尾 `_` 脱离详情布局，URL 保持不变。
