# 开发工作流改造：深度评审结论

> 评审对象：`claude/dev-workflow-optimization-2f3fc1` 工作区中的未提交改动  
> 评审依据：[`dev-workflow-refactor-review.md`](./dev-workflow-refactor-review.md) 与实际代码 diff  
> 评审日期：2026-08-24

## 1. 总体结论

**当前版本不建议合入。**

方案方向总体合理：一次性数据库、可复现种子、真实认证链路、Git 层线性历史约束，分别对应了现有多 worktree 开发中的真实问题；种子数据的类型约束、identity 序列重置和 API 文档排除开发后门，也都经过了有针对性的设计。

但实现中仍有 **5 个 P1 阻塞问题和 4 个 P2 重要问题**。其中最严重的三个问题是：

1. Codex worktree 的临时数据库容器名必然冲突，后启动者会杀掉前一个 worktree 的数据库；
2. `prune --yes` 的筛选范围可能覆盖同机其他项目的 PostgreSQL 容器和数据卷；
3. 免密登录入口随开发服务监听到 `0.0.0.0`，局域网客户端可以绕过密码取得真实 session。

这些问题会直接破坏本次改造的核心目标，或带来不可逆的数据删除风险，不能仅靠文档提示规避。

## 2. P1：合入前必须修复

### P1-1 Codex worktree 的临时库容器名必然冲突

位置：[`scripts/dev-db.ts`](../scripts/dev-db.ts#L28-L34)、[`scripts/dev-db.ts`](../scripts/dev-db.ts#L150-L152)

`containerNameFor()` 只取 `basename(repoRoot)`：

```ts
const slug = basename(repoRoot)
  .toLowerCase()
  .replace(/[^a-z0-9_.-]/g, "-")
  .slice(0, 40);
```

Claude worktree 的叶目录通常带任务名，因此暂时看不出问题；Codex worktree 的结构则是：

```text
C:/Users/Administrator/.codex/worktrees/08fc/pszx-hdyy
C:/Users/Administrator/.codex/worktrees/2665/pszx-hdyy
C:/Users/Administrator/.codex/worktrees/698c/pszx-hdyy
...
```

当前主工作区和 7 个 Codex worktree 都会得到同一个容器名：

```text
pszx-dev-db-pszx-hdyy
```

而启动流程会先执行：

```ts
await docker(["rm", "-f", containerName]);
```

所以任意一个 Codex worktree 启动 `bun run dev`，都会先杀掉另一个正在运行的 Codex worktree 或主工作区数据库。这不是低概率竞争，而是由目录结构决定的稳定复现问题，直接违背“每个 worktree 一个临时库”的首要目标。

建议使用完整规范化 worktree 路径的稳定哈希，或者使用 worktree 专属 git-dir 作为身份来源。容器名可以保留可读前缀，但必须附加不会因相同叶目录或 40 字符截断而碰撞的哈希。

### P1-2 `prune --yes` 可能删除其他项目的数据库

位置：[`scripts/prune.ts`](../scripts/prune.ts#L26-L67)、[`scripts/prune.ts`](../scripts/prune.ts#L109-L119)

当前清理候选集的边界不是“属于本仓库”，而是：

- 所有带 `pszx-dev-db` label 的容器，包括仍在正常使用的临时库；
- 所有 Compose project 不是 `pszx-hdyy`、镜像名以 `postgres:` 开头的容器；
- Docker 中所有名称以 `_postgres_data` 结尾、但不等于 canonical 名称的数据卷。

随后 `--yes` 会先执行 `docker rm -f`，再删除卷。这意味着，只要同一台机器上还有另一个 Compose 项目使用 PostgreSQL 和常见的 `postgres_data` 卷名，该项目的容器就可能被强制停止，数据卷随后被永久删除。

默认 dry-run 只能降低误操作概率，不能修复候选集越界。文档还明确引导用户确认后执行 `bun run prune --yes`，因此不能把安全责任全部交给人工逐项识别。

建议：

1. 创建资源时写入包含仓库身份和 worktree 根路径的专属 label；
2. 清理时只处理该专属 label 下、且 worktree 已不存在或容器已停止的资源；
3. Compose 遗留资源必须校验 `com.docker.compose.project.working_dir`、配置文件路径或另一项仓库专属标识；
4. 不应把“所有非 canonical Postgres”或“所有 `_postgres_data` 卷”视为本仓库垃圾；
5. 活跃临时库至少要单独分组并拒绝自动强删。

### P1-3 免密登录入口暴露到局域网

位置：[`scripts/dev.ts`](../scripts/dev.ts#L127-L136)、[`apps/server/src/index.ts`](../apps/server/src/index.ts#L166-L169)

`scripts/dev.ts` 会为临时库和持久库两条启动路径都设置：

```ts
DEV_AUTH_BYPASS: "1"
```

但服务端默认导出只指定了 `port` 和 `fetch`，没有指定 `hostname`。当前 Bun 类型包附带的运行时文档明确记录：未指定 `hostname` 时默认监听 `0.0.0.0`。

因此，Vite 的 `--host localhost` 只能保护前端端口，不能保护别人直接访问 Hono 的后端端口。局域网客户端可以直接请求：

```text
http://<开发机地址>:<SERVER_PORT>/api/dev/login
```

该入口会签发真实 Better Auth session，之后即可直接调用受保护业务 API。临时库虽然是演示数据，但持久模式也开启同一后门；如果持久库存在 `dev@example.com`，影响将扩展到本地积累的数据。

建议在开发编排中显式将后端绑定到回环地址，并同步让 Vite proxy 使用相同地址。持久模式的免密入口应改为单独的显式选项，而不是默认开启；还可以增加每次启动生成的高熵 token 作为第二层防护。

### P1-4 `.dev-db.env` 生命周期会让持久模式静默连错库

位置：[`scripts/dev.ts`](../scripts/dev.ts#L91-L104)、[`scripts/dev.ts`](../scripts/dev.ts#L195-L216)

设计文档认为硬杀后 `.dev-db.env` 会指向“已死端口”，从而响亮失败；这个判断不成立。

临时 PostgreSQL 是通过 `docker run -d --rm` 分离启动的。任务管理器强杀父进程时，Docker 容器不会自动停止，容器和 `.dev-db.env` 会一起继续存在。随后执行 `bun run dev:persist` 时：

1. 持久分支不会删除旧 `.dev-db.env`，也不会停止同 worktree 的旧临时容器；
2. 应用子进程只读取根 `.env`，会连接持久库；
3. `db:studio`、`db:push`、`db:migrate` 会读取 `.env` 后再读取 `.dev-db.env`，因此会连接仍然存活的旧临时库。

结果是应用和数据库工具连接两个不同的库，而且不会报错，正好重现本次改造想消灭的“静默看错数据库”。

另外，从 `startEphemeralPostgres()` 成功开始到文件末尾没有覆盖完整生命周期的 `try/finally`：schema push、种子、端口解析或子进程启动任一步失败，都会遗留容器；如果失败发生在 `.dev-db.env` 写入之后，数据库工具还会连接到半灌种状态的库。

建议：

- `--persist` 启动前先清除本 worktree 的运行时连接文件，并明确处理旧临时容器；
- 临时库创建成功后立即进入 `try/finally` 管理区；
- `startEphemeralPostgres()` 自身在 ready 失败时也应回收已创建容器；
- `.dev-db.env` 使用原子写入，并考虑写入 PID、容器名和启动 nonce，读取方先验证状态；
- bootstrap 子进程增加“实际解析到的 `DATABASE_URL` 等于父进程期望值”的断言。

### P1-5 生产安全断言仍允许认证后门

位置：[`apps/server/src/modules/auth/routes.dev.ts`](../apps/server/src/modules/auth/routes.dev.ts#L29-L43)

当前“生产形态”判断是：

```ts
process.env.NODE_ENV === "production" ||
Boolean(process.env.WEB_DIST_DIR?.trim())
```

这是一份不完整的生产形态黑名单。现有 `bun run start` 不会主动设置这两个变量；方案文档中提到的前后端分域名、server 不托管静态文件的部署也可能没有 `WEB_DIST_DIR`。只要环境中残留 `DEV_AUTH_BYPASS=1`，后门就会正常挂载，而不是拒绝启动。

当前 Docker 单镜像部署会被 `WEB_DIST_DIR` 捕获，但安全断言的职责正是阻止错误配置演变成生产认证绕过，不能只覆盖当前一种部署脚本。

建议改为开发形态白名单：由根 dev runner 显式设置专用的 `APP_ENV=development` 或不可与常规部署混淆的运行标识，其他任何形态下一旦出现 `DEV_AUTH_BYPASS=1` 都拒绝启动。回环地址检查和每次启动 token 仍应保留，不能只依赖环境名。

## 3. P2：重要问题

### P2-1 Git hooks 当前会以不可执行模式提交

位置：[`.githooks/pre-commit`](../.githooks/pre-commit)、[`.githooks/pre-merge-commit`](../.githooks/pre-merge-commit)、[`scripts/setup-git.ts`](../scripts/setup-git.ts#L15-L19)

在当前 Windows worktree 中执行无索引 diff，两个新 hook 都显示：

```text
new file mode 100644
```

`.gitattributes` 的 `eol=lf` 只解决行尾，不会增加 executable bit。Unix Git 会忽略不可执行 hook，因此这套“Git 自身强制”的规则在此类开发环境完全失效。

提交时必须把两个文件记录为 `100755`，并让 `setup-git.ts` 校验 hook 是否存在、是否可执行以及配置是否真正生效。当前脚本还会静默忽略 `git config` 写入失败，与“强制层”的定位不一致。

此外，`core.hooksPath=.githooks` 是相对每个 worktree 的路径。现有尚未 rebase 到本改动的 worktree 不包含 `.githooks`，因此不会立即受到保护；如果目标是覆盖所有已经在飞的 worktree，需要把版本化 hook 安装到 shared git dir，或明确记录“rebase 后才生效”的边界。

### P2-2 反斜杠可以绕过重定向白名单

位置：[`apps/server/src/modules/auth/routes.dev.ts`](../apps/server/src/modules/auth/routes.dev.ts#L46-L52)

当前只拒绝不以 `/` 开头和以 `//` 开头的值，但 URL 标准会把反斜杠当作路径分隔符处理。例如：

```ts
new URL("/\\evil.example", "http://localhost:3000/base").href
// => "http://evil.example/"
```

Hono 查询参数解码后，`/%5Cevil.example` 也会进入相同路径。因此当前入口存在开放重定向。

建议使用 `new URL(raw, trustedOrigin)` 解析后比较 `origin`，只返回同源的 `pathname + search + hash`；最低限度也必须拒绝任何 `\\`。

### P2-3 临时数据库端口选择仍有并发竞争

位置：[`scripts/dev-db.ts`](../scripts/dev-db.ts#L150-L176)、[`scripts/ports.ts`](../scripts/ports.ts#L34-L67)

`findAvailablePort()` 探测完端口后会立即关闭探测 socket，Docker 真正绑定发生在后续 `docker run`。两个 worktree 同时启动时，可能都判断 `55432` 可用，然后其中一个容器绑定失败。

这是本次改造明确要支持的并发场景。建议让 Docker 自动分配宿主机端口，再通过 inspect 获取映射；或者对明确的端口占用错误重新选端口并有限重试。

### P2-4 新的交付门禁当前无法变绿

位置：[`AGENTS.md`](../AGENTS.md#L109-L120)

新增流程要求 agent 在 rebase 后执行：

```bash
bun run typecheck && bun run test
```

并以“检查通过”作为交付条件。但当前 `bun run test` 固定有 3 个 invitation 真实模板用例失败并返回退出码 1。即使这些失败与本改动无关，每个后续 agent 也只能被阻塞，或者逐渐形成“红灯可以忽略”的习惯，使门禁失去意义。

应当在启用这条强制流程之前修复或隔离已知失败，或者提供一个当前确实能够变绿、同时覆盖主干回归的验收命令。仅在评审说明中注明“与本次无关”不能解决后续所有分支都无法满足流程的问题。

## 4. 对原风险清单的逐项判断

| 原风险 | 结论 | 评审意见 |
| --- | --- | --- |
| 6.1 API 文档泄露后门 | 当前修法可用，但需测试守护 | 无条件过滤 `/api/dev/` 能保护当前产物；应把该前缀声明为保留命名空间，并增加回归测试。独立 Hono 实例在结构上更强，但不是当前阻塞项。 |
| 6.2 生产断言覆盖面 | 不可接受 | 见 P1-5。应从生产黑名单改为开发白名单。 |
| 6.3 重定向白名单 | 不可接受 | 见 P2-2。反斜杠可形成外站重定向。 |
| 6.4 identity 序列重置 | 当前实现正确 | 对现有 `public` schema 和 identity 列，空表时下一个值为 1，非空表时为 `max + 1`，语义正确。其它 schema、分区表属于未来扩展条件。 |
| 6.5 种子顺序无机器校验 | 当前可接受，但应收紧命名 | 暂不需要拓扑排序；建议强制 `^\d{2}-[a-z0-9-]+\.ts$` 并检查重复前缀，避免当前字典序排序被 `5-`、`100-` 等名字误解成数值排序。 |
| 6.6 依赖 Bun env 优先级 | 应增加启动断言 | Bun 1.3.14 实测成立，但 bootstrap 会执行 schema push，失败后果不应是静默连到持久库。父进程应额外传入期望 URL，并在子进程连接前比较。 |
| 6.7 硬杀残留窗口 | 当前判断不成立 | 分离容器通常仍然存活，旧 env 文件不一定指向死端口；见 P1-4。 |
| 6.8 tmpfs 512MB | 当前可接受 | 现有数据量距离上限很远。建议在 PostgreSQL 启动或写盘失败时补充针对 tmpfs 上限的诊断文案。 |
| 6.9 prune 常量耦合 | 风险比文档描述更严重 | 不只是常量同步问题，当前筛选可跨仓库删除数据；见 P1-2。canonical 名称仍应从 Compose 配置或共享常量派生。 |
| 6.10 持久库也开后门 | 不建议默认开启 | 持久库可能包含本地积累数据；应使用独立显式参数，并先解决回环绑定和生产白名单问题。 |
| 6.11 `--no-verify` 绕过 | 可以接受 | 作为明确、可审计的人工逃生口合理；但不能用它补偿 hook 不可执行或未安装的问题。 |

## 5. 验证结果

本次评审执行了以下只读或非破坏性验证：

### 5.1 类型检查

```text
bun run typecheck
```

结果：通过；server、web 和 scripts 均无 TypeScript 错误。

### 5.2 测试

```text
bun run test
```

结果：失败。

- Web：114 项通过；
- Server：61 项通过、3 项失败；
- 失败均位于 `apps/server/src/modules/invitation/docx.test.ts` 的真实模板用例，与评审文档记录一致；
- 但这仍使新增的“测试通过后交付”流程无法成立，见 P2-4。

### 5.3 格式与 diff

- `git diff --check`：通过；
- 对完整改动范围执行 `bunx biome check ...`：未通过；
- 唯一报告文件为 `scripts/gen-api-docs.ts`，当前工作副本使用 CRLF，formatter 要求 LF；
- 因此评审说明中的“17 个文件格式检查通过”在当前工作区无法完整复现。

### 5.4 针对性验证

- 直接调用 `containerNameFor()`，主工作区和多个 Codex worktree 均返回 `pszx-dev-db-pszx-hdyy`；
- `git diff --no-index` 显示两个 hook 的新文件模式均为 `100644`；
- URL 解析验证确认 `/\\evil.example`、`/%5Cevil.example` 会解析到外部 origin；
- `bun run prune` 仅以 dry-run 执行，没有删除任何容器、卷或分支；
- 搜索现有测试后，未发现覆盖 `dev-db`、`prune`、`DEV_AUTH_BYPASS`、重定向校验、序列重置或 Git setup 的自动化测试。

## 6. 建议修复顺序

建议按下面顺序修改和验收，避免后续测试建立在不稳定基础上：

1. 修复 worktree 唯一身份和容器命名，并增加 Codex/Claude 两种路径形态的单元测试；
2. 收紧 `prune` 资源归属边界，使用专属 label，增加“其他项目绝不进入候选集”和“活跃容器不删除”测试；
3. 将开发后端绑定到回环地址，把生产判断改成开发白名单，持久模式后门改为显式开关；
4. 用 `try/finally` 重做临时库及 `.dev-db.env` 生命周期，覆盖 bootstrap 失败、子进程失败、正常退出和硬杀后重启；
5. 修复同源重定向校验和端口分配竞争；
6. 以 `100755` 提交 hooks，并验证 Windows、Linux 及已有 worktree 的实际生效边界；
7. 修复或隔离现有 3 个失败测试，让文档规定的交付门禁真正可执行；
8. 增加 API 文档不泄露后门、bootstrap 连接目标断言和 identity 序列行为测试；
9. 重新执行临时模式、持久模式、双 worktree 并发、浏览器免密登录、完整类型检查与测试。

## 7. 合入标准

至少满足以下条件后再考虑合入：

- 5 个 P1 问题全部修复并有可复现验证；
- `prune --yes` 无法匹配任何不属于本仓库的资源，也不会删除活跃开发库；
- 两个 Codex worktree 可以同时运行且互不停止、互不串库；
- 后端开发端口无法从非回环地址访问免密入口；
- 临时模式、持久模式和数据库工具始终连接同一条预期连接串；
- hooks 在目标开发平台实际执行，而不只是配置了 `core.hooksPath`；
- `bun run typecheck`、约定的格式检查和正式交付测试全部返回 0。

