<!-- intent-skills:start -->
## Skill Loading

Before editing files for a substantial task:
- Run `bunx @tanstack/intent@latest list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `bunx @tanstack/intent@latest load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->

# 项目约定

这里是全仓知识入口。约定可以调整，但应将采纳的规则与理由写回**所属当前文档**，方向性取舍记录到 ADR；不要默默制造例外，也不要把每次功能经验追加到本文件。

## 工作方式

- 工具链使用 `bun` / `bunx`。修改前查看工作树、目标实现与相关测试，保留已有改动。
- 实质性任务开始时运行 `bun run docs:list`；已知领域时用 `--query <关键词>` 缩小范围，按摘要与 `read_when` 读取当前专题。命中多个主题时组合阅读，不默认通读整个 docs。
- 找不到资料时再查代码附近的注释和未入索引文档。历史方案、原型或研究结论不自动替代当前规则；代码与约定冲突时核对决策依据。
- 项目 skill 在 `.agents/skills/`，按描述选择并读取；上游通用指导与项目已采纳约定冲突时遵守项目约定，具体 API 核对已安装版本。不要仅因 skill 被发现就全部加载。

## 通用边界

- 按依赖方向决定归属；禁止跨路由引用他人的 `-` 私有文件。前端运行时导入服务端值必须符合 API 契约的明确清单，不能从服务端根入口导入运行时实现。
- 身份、授权与输入校验在服务端执行；前端显隐和路由守卫不能替代后端校验。新增接口同时检查授权归属与相应覆盖测试。
- 修改 schema 同步维护 typed seed，收尾生成并审阅迁移；新增模块补种子。不要手改生成路由树。
- 组件、主题、路由及运行模型按对应当前指南；修改已采纳的产品方向或架构选择时说明依据，不因为库的默认示例而切换。

## 常用命令

| 任务 | 在仓库根执行 |
| --- | --- |
| 安装 | `bun install` |
| 默认开发 | `bun run dev`：每个 worktree 独立临时库；使用启动输出的实际端口 |
| 持久库开发 | `bun run dev:persist`：执行迁移，不灌种子 |
| 类型 / 测试 / 构建 | `bun run typecheck` / `bun run test` / `bun run build` |
| 本次文件检查 | `bunx biome check <本次修改文件...>`，不加 `--write` |
| 资料发现 / 入口检查 | `bun run docs:list` / `bun run docs:check` |

当前 `bun run check` 会写文件，不作为日常收尾检查。需要全仓修复时先确认工作树干净，再执行并核对改动范围。

管理端可自行访问开发环境 `/api/dev/login`（可加 redirect）并走真实浏览器操作。连接当前临时库沿用脚本生成的 `apps/server/.dev-db.env`，不要猜 `localhost:5432`。凭据留在本地配置，不写入文档、日志或提交。

## 按任务读取

| 通用任务 | 当前入口 |
| --- | --- |
| 新建模块/页面、提取共享代码、改变路由或运行边界 | [代码结构](docs/code-structure.md) |
| 新增接口、改输入输出、客户端类型或共享导出 | [API 契约](docs/api-contract.md) |
| 管理端 CRUD、表单、筛选或视觉接线 | [CRUD 指南](docs/crud-page-guide.md) |
| schema、种子、迁移或数据库操作 | [数据库迁移](docs/database-migrations.md) |
| 开发环境、运行入口、检查、交付或排障 | [开发工作流](docs/development-workflow.md) |
| 构建镜像、发版、部署或静态资源入口 | [Docker 流程](docker/README.md) |
| 修改规范、记录经验、增加资料或 skill | [知识维护](docs/knowledge-maintenance.md) |

业务领域、特定端的页面和交互规则通过 `docs:list --query <领域或行为>` 定位，读取目标实现旁的专题指针。不要为每个业务模块在根文件新增条目。

## 验证与交付

执行与改动相称的检查，报告范围与未验证项；真实事务和交互要求的验收不能由类型检查代替。既有失败范围与复现基线见开发指南，不吞掉退出码或放宽产品期望制造通过。

遵守线性历史：在功能分支完成 rebase 与交付检查，再报告可合并状态；master 合入由用户编排。不使用 `merge --no-ff`。完整步骤见开发指南。

## 知识维护

根文件只收录适用于多个无关领域、需要常驻且可简短表达的约束。**模块契约、功能过渡状态、迭代记录、字段规则和实现细节不进入根文件**，也不包装成新表格或子章节；写入所属专题，通过阅读条件和代码附近指针发现。

修改本文件前读知识维护规则。更新后运行 `bun run docs:check`，它也包含在现有 `bun run test` 中；根章节结构固定，新增业务章节会失败。机械检查不代替内容归属审阅。

6—10 KiB 是根文件软目标，必须小于 32 KiB 并为宿主加载链留余量。`CLAUDE.md` 只保留一行 `@AGENTS.md`，不展开导入整套专题。仅标题、链接和体积检查通过，不代表资料已在所有宿主正确加载。
