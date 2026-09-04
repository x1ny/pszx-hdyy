# 数据库迁移方案

> **状态：已实施并验证完毕。** 代码、迁移文件、本地持久库和**测试库**的基线、
> 镜像实机验证（含 3 副本并发）都已完成，清单见第 10 节。
>
> 下一次部署起，测试环境的 schema 变更就由容器启动时自动执行了，不需要人手做任何事。

## 0. 一句话

生产和测试用**版本化 SQL 迁移文件**——进 git、随镜像发布、容器启动前自动执行；
本地开发保留 `push` 的即时性，靠一个**不连数据库的漂移检查**保证两条路不分叉；
测试环境**不删数据**，用 baseline 平滑接进来。

## 1. 现状与问题

- 全仓**没有一个迁移文件**，`apps/server/drizzle/` 不存在。schema 的唯一事实是 `modules/*/schema.ts`。
- 开发环境靠 `dev-seed/bootstrap.ts` 的 `pushSchema()` 建表，只对空库负责。
- 生产的规矩写在 docker/README.md：人手在部署前跑 `bun run db:push`。

`db:push` 上生产的三个问题都是实打实的：

1. 它会**为了对齐 schema 而删列改类型**，而且不问；
2. **没有任何执行记录**——线上库现在是哪个版本、上次部署改了什么，事后无从查起；
3. 要求开发机能直连生产库。

## 2. 先搞清楚 drizzle 的 migrator 到底怎么工作

后面所有设计都是从这四条事实推出来的。它们来自 `drizzle-orm/pg-core/dialect.js` 的 `migrate()`
和 `drizzle-orm/migrator.js` 的 `readMigrationFiles()`（当前依赖版本 drizzle-orm 0.45）：

1. **完全没有加锁。** 一把都没有。
2. **「跑到哪了」这次读发生在事务之外**：先 `select … order by created_at desc limit 1`，
   然后才 `BEGIN`。两个进程同时启动会双双读到同一个起点。
3. **所有待执行的迁移在一个事务里跑完**，中间任何一条失败全部回滚——Postgres 的 DDL 是
   事务性的，这点比 MySQL 省心得多。
4. **判断依据是 `created_at`（= `meta/_journal.json` 里的 `when` 毫秒时间戳），不是 hash，
   也不是文件名。** hash 只是记账字段，那张表上连唯一约束都没有。而且 `lastDbMigration`
   在循环开始前只读一次、循环里不更新——所以**空库会按 journal 的数组顺序把所有迁移
   都跑一遍**，非空库则只跑 `when` 大于最后一条记录的那些。

第 1、2 条推出 5.1 的锁；第 4 条推出第 8 节那个坑。

## 3. 总体形态

| 环境 | 表结构从哪来 | 谁执行 | 什么时候 |
| --- | --- | --- | --- |
| `bun run dev` 临时库 | 迁移文件 +（还没生成迁移的改动）按快照差异补齐 | `dev-seed/bootstrap.ts` | 每次 `bun run dev` |
| `bun run dev:persist` 持久库 | 只有迁移文件 | `scripts/dev.ts` | 每次 `dev:persist` |
| 测试环境 | 只有迁移文件 | 容器 entrypoint | 每次部署 |
| 生产环境 | 只有迁移文件 | 容器 entrypoint | 每次部署 |

一条线贯穿：**除了本地那个一次性临时库，任何数据库的结构都只能由迁移文件产生。**

## 4. 仓库改动清单

**新增**

| 文件 | 作用 |
| --- | --- |
| `apps/server/drizzle/` | 迁移 SQL + `meta/`，**必须进 git** |
| `apps/server/src/migrate.ts` | 迁移入口：advisory lock + `--baseline` |
| `apps/server/src/schema-registry.ts` | 把 `modules/*/schema.ts` 汇成一个对象（这段代码原先埋在 bootstrap.ts 里，现在三处共用） |
| `apps/server/src/schema-diff.ts` | 「代码 vs 迁移文件」的差异，**不连库**。dev 补齐和漂移测试共用同一份计算 |
| `apps/server/src/schema-check.ts` | 「代码 vs 某个真实库」的差异，默认**只读不写** |
| `apps/server/src/schema-drift.test.ts` | 不连库的漂移检查 + journal 顺序守卫 |

`schema-diff` 和 `schema-check` 名字像、职责完全不同，别搞混：**前者不连数据库**
（比对代码和仓库里的迁移文件），**后者必须连**（比对代码和一个真实的库）。日常拦
「忘了生成迁移」的是前者；打基线和排查线上漂移用的是后者。

**修改**：`docker/Dockerfile`、`docker/docker-entrypoint.sh`、`apps/server/package.json`（build 和 db 脚本）、
根 `package.json`（db 脚本）、`dev-seed/bootstrap.ts`、`scripts/dev.ts`、`.gitattributes`、
`AGENTS.md` 和 `docker/README.md`。

> **为什么 `schema-registry.ts` 放在 `src/` 根而不是 `infra/`**：它要 import 所有
> `modules/*/schema.ts`，放进 `infra/` 就把依赖方向倒过来了（见 AGENTS.md「代码结构」）。
> `src/` 根是组合根，`index.ts` 和 `client-type.ts` 本来就认识 modules。

## 5. 生产环境

### 5.1 迁移入口：`apps/server/src/migrate.ts`

```ts
#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

// 迁移入口，刻意独立于 index.ts：应用进程不碰 schema，「迁移失败」和
// 「应用起来了但表结构不对」必须是两种能分辨的状态。
//
// 这条 import 链上只有 drizzle-orm 和 pg，没有 drizzle-kit —— 所以
// `bun build` 出来的 dist/migrate.js 能进镜像，而不会把 kit 拖进去。

const MIGRATIONS_DIR =
  process.env.MIGRATIONS_DIR?.trim() || resolve(import.meta.dir, "../drizzle");

// 任意常量，含义只有「全仓统一」。改这个值等于换一把锁，正在跑的实例挡不住新实例。
const MIGRATION_LOCK_ID = 1_887_320_164;
const LOCK_WAIT_TIMEOUT_MS = 5 * 60_000;
const LOCK_POLL_INTERVAL_MS = 500;

async function withLock<T>(pool: Pool, run: () => Promise<T>) {
  // 会话级 advisory lock 跟着**连接**走，所以必须独占一条 client：直接用
  // pool.query 的话，unlock 可能落到另一条连接上，锁就永远留在库里了。
  const client = await pool.connect();
  const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;

  try {
    for (;;) {
      const { rows } = await client.query<{ locked: boolean }>(
        "select pg_try_advisory_lock($1) as locked",
        [MIGRATION_LOCK_ID],
      );
      if (rows[0]?.locked) break;

      // 用 try + 轮询而不是 pg_advisory_lock 死等：死等会让容器一直停在
      // 「正在启动」，编排看到的不是失败，没人会去查。
      if (Date.now() > deadline) {
        throw new Error(
          `等待迁移锁超过 ${LOCK_WAIT_TIMEOUT_MS / 1000}s。多半是另一个实例正在跑一条很慢的迁移；` +
            "确认它还活着就再等一轮，确认它已经死了就查 pg_locks。",
        );
      }
      await Bun.sleep(LOCK_POLL_INTERVAL_MS);
    }

    return await run();
  } finally {
    // 进程被 kill 时这行跑不到，但没关系：会话级锁在连接断开时由 Postgres
    // 自动释放。这正是它比「在表里插一行当锁」强的地方——那种锁得自己处理残留。
    await client
      .query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_ID])
      .catch(() => {});
    client.release();
  }
}
```

三个要点，缺一不可：

- **lock 和 unlock 必须在同一条连接上**，所以要 `pool.connect()` 单独拿一个 client。
  `migrate()` 内部用池里另一条连接不影响——这把锁只是迁移进程之间的互斥量。
- **进程被杀掉时锁自动释放**（容器 OOM、被 kill、断网都算），不需要 TTL 和残留清理。
- **第二个容器拿到锁后会发现无事可做**，`migrate()` 空转返回，继续启动。行为完全正确。

### 5.2 baseline：给已有数据的库打基线

同一个文件里再加一个分支，`--baseline` 触发。它**只写记账表，不碰任何业务表**：

```ts
/**
 * 把一个「表已经建好、但没有记账表」的库标记成「0000 已执行」。
 *
 * 用于测试环境和本地持久库这种由 db:push 建出来、又不能删数据的库。
 *
 * **前提是这个库的结构确实等于 0000 描述的结构** —— 先跑 `bun run db:check`
 * 确认零差异再打。基线打在一个不一致的库上，等于把不一致永久固化：之后所有
 * 迁移都会从这个错误的起点往上叠，而且不会有任何报错。
 */
async function baseline(db: ReturnType<typeof drizzle>) {
  const journal = JSON.parse(
    readFileSync(`${MIGRATIONS_DIR}/meta/_journal.json`, "utf8"),
  ) as { entries: { tag: string; when: number }[] };
  const first = journal.entries[0];
  if (!first) throw new Error("meta/_journal.json 里一条迁移都没有");

  // hash 算法必须和 drizzle 的 readMigrationFiles 一致：sha256(整个 .sql 文件内容)。
  // 它只是记账字段（「跑到哪了」看的是 created_at），但对不上会让审计记录失去意义。
  const hash = createHash("sha256")
    .update(readFileSync(`${MIGRATIONS_DIR}/${first.tag}.sql`, "utf8"))
    .digest("hex");

  await db.execute(sql`create schema if not exists drizzle`);
  await db.execute(sql`
    create table if not exists drizzle.__drizzle_migrations (
      id serial primary key, hash text not null, created_at bigint
    )
  `);

  const existing = await db.execute<{ count: string }>(
    sql`select count(*)::text as count from drizzle.__drizzle_migrations`,
  );
  if (Number(existing.rows[0]?.count) > 0) {
    throw new Error(
      "这个库已经有迁移记录了，不需要打基线（重复打会让后续迁移被跳过）",
    );
  }

  await db.execute(sql`
    insert into drizzle.__drizzle_migrations (hash, created_at)
    values (${hash}, ${first.when})
  `);
  console.log(`[migrate] 已打基线：${first.tag}(when=${first.when}) 标记为已执行`);
}
```

入口部分：

```ts
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle({ client: pool });

try {
  await withLock(pool, async () => {
    if (process.argv.includes("--baseline")) return baseline(db);

    const before = await lastAppliedAt(db);
    const startedAt = Date.now();
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    const after = await lastAppliedAt(db);

    // 部署日志里要能一眼看出这次到底动没动库。migrate() 自己什么都不说。
    console.log(
      before === after
        ? `[migrate] 没有待执行的迁移（当前 ${after ?? "空库"}）`
        : `[migrate] 迁移完成：${before ?? "空库"} → ${after}（${Date.now() - startedAt}ms）`,
    );
  });
} finally {
  await pool.end();
}
```

### 5.3 打进镜像

Dockerfile 运行阶段多两行 COPY 和一个 ENV：

```dockerfile
ENV MIGRATIONS_DIR=/app/drizzle
COPY --from=builder /app/apps/server/dist/migrate.js ./migrate.js
COPY --from=builder /app/apps/server/drizzle ./drizzle
```

`apps/server` 的 build 脚本打两个产物：

```json
"build": "bun build src/index.ts --target=bun --outfile dist/server.js && bun build src/migrate.ts --target=bun --outfile dist/migrate.js"
```

代价只有几十 KB：migrate.js 内联的是 drizzle-orm 的 migrator 和 pg（server.js 里本来就有），
迁移 SQL 是纯文本。**drizzle-kit 仍然不进镜像**，运行阶段依然零 node_modules。

entrypoint 在 `exec bun run /app/server.js` 之前插一段：

```sh
if [ "${SKIP_MIGRATIONS:-0}" = "1" ]; then
  echo "  MIGRATIONS:       skipped (SKIP_MIGRATIONS=1)"
else
  bun run /app/migrate.js
fi
```

文件头已经有 `set -eu`，所以**迁移失败 = 容器起不来**，Rancher 上一眼能看见。
`SKIP_MIGRATIONS=1` 是应急阀门：迁移卡住时先让应用起来（前提是这次发版不依赖新结构），
再人工接管。

### 5.4 首次上线（空库）

1. 建库、建应用账号，`DATABASE_URL` 配进 Rancher workload。
2. 正常部署。容器启动 → `migrate.js` 发现记账表不存在、库是空的 → 按 journal 顺序
   跑完所有迁移 → 启动应用。**不需要任何手工步骤。**
3. 建第一个管理员账号——这是**另一件事**，不走迁移，见第 9 节「迁移 ≠ 种子数据」。

### 5.5 日常发版

`bun run docker:build-push` → Rancher redeploy。迁移随容器启动自动执行，人不介入。
唯一需要人做的是**发版前备份**（5.8）。

### 5.6 多副本与滚动发布

advisory lock 解决的是「两个容器同时跑迁移」。它解决不了另一件事，而那件事更重要：

**滚动发布期间，新旧两个版本的代码共用同一个 schema。** 新 Pod 跑完迁移起来了，
老 Pod 还在跑、还在读写同一个库。这时候：

- 迁移**加了**表/列 → 老代码不认识它，安全。
- 迁移**删了**列或改了类型 → 老 Pod 的 SQL 立刻开始报错，直到它被换掉为止。
  用户在那几十秒里看到的是随机的 500。

所以「迁移只做加法」不是洁癖，它是**多副本 + 滚动发布这个组合的硬性前提**。
删列必须拆成两次发版：

1. 第 N 版：代码不再读那一列，迁移里什么都不删。
2. 确认线上稳定、老 Pod 全部换掉之后，第 N+1 版才发那条 `DROP COLUMN`。

改类型同理：加新列 → 双写 → 回填 → 切读 → 下一版删旧列。

> 当前 Rancher 上如果是单副本 + Recreate 策略，这两个问题都不会发生。锁和
> expand/contract 是给「哪天有人把副本数调到 2」买的保险——出问题的那一次，
> 你不会知道是它。

### 5.7 回滚

**drizzle 没有 down 迁移，我们也不自己造一套。** 策略是 forward-only：

- 迁移本身有 bug → 加一条新迁移改回来，不改旧文件（见第 9 节「不可变」）。
- 应用代码有 bug、schema 没问题 → 直接回滚镜像。因为迁移只做加法，
  **旧代码在新 schema 上一定能跑**——这正是 expand/contract 换来的东西。
- 迁移把数据毁了 → 只能从备份恢复。所以有 5.8。

### 5.8 备份

生产每次发版前：

```bash
pg_dump -Fc -d "$DATABASE_URL" -f "backup-$(date +%Y%m%d-%H%M%S).dump"
```

两个提醒：

- **`pg_dump` 备不到上传的文件。** `/app/data/files` 里的邀请函模板和附件在另一个卷上，
  只恢复数据库会得到一堆指向不存在文件的记录。备份计划必须同时覆盖那个卷。
- **没演练过的备份等于没有备份。** 至少完整恢复一次到临时库并验证能启动。

## 6. 测试环境：不删数据接进来（baseline）

### 6.1 为什么需要这一步

测试库是 `db:push` 建出来的：表都在，数据也在，但**没有 `drizzle.__drizzle_migrations`
这张记账表**。直接部署新镜像的话，`migrate.js` 会认为这是个空库，从 `0000` 开始
`CREATE TABLE "user"` → `42P07 relation already exists` → 整个事务回滚 → 容器起不来。

baseline 做的事只有一件：**告诉数据库「`0000` 这条我已经有了，别再跑」**。
它只写记账表，一个业务表都不碰，所以数据一条都不会丢。

### 6.2 操作顺序

**第 0 步：先在本地那个 docker-compose 持久库上完整走一遍。** 它和测试库处于
*完全一样*的状态（push 建的、有数据、没记账表），是最真实的演练场，而且练坏了
没有任何代价。这一步别跳。

确认流程走得通之后，对测试库依次执行：

```bash
pg_dump -Fc -d "$TEST_DATABASE_URL" -f test-before-baseline.dump
```

```bash
DATABASE_URL="$TEST_DATABASE_URL" bun run db:check
```

```bash
DATABASE_URL="$TEST_DATABASE_URL" bun run db:baseline
```

```bash
DATABASE_URL="$TEST_DATABASE_URL" bun run db:migrate
```

四步的含义：备份 → 校验结构一致（**必须输出「零差异」才能继续**）→ 打基线 →
验证（应该输出「没有待执行的迁移」）。之后正常部署即可，`0000` 会被跳过，
后续新增的迁移正常执行。

`db:check` 输出里会有一行「忽略 N 条复合约束的内省空转」，那是 drizzle-kit 的
已知内省缺陷（7.1 里解释过），`db:check` 会拿库里的**真实约束定义**逐条核对后
才归为噪音——定义对不上就照常报成真差异，不会替你吞掉。

`db:baseline` 有两道自锁：库是空的（一张表都没有）拒绝执行——那种情况直接跑
`db:migrate` 就行；已经有迁移记录也拒绝执行——重复打基线会让本该执行的迁移被跳过。

**每条命令的第一行都会打印目标库（密码已抹掉），动手之前先看那一行。**
命令前面挂的 `DATABASE_URL=...` 确实压得过脚本里的 `--env-file`（已实测），但
「你以为在测试库、其实在本地持久库」这类事故代价太大，值得每次多看一眼。
另外：跑之前确认 `apps/server/.dev-db.env` 不存在（`bun run dev` 会写它、退出时删），
它的优先级高于 `.env`。

### 6.3 如果第 2 步输出了差异

说明测试库和当前代码的 schema 已经不一致了。**先别打基线**，逐条看输出：

- 全是 `CREATE TABLE` / `ADD COLUMN` 这类加法 → 有人改了代码没同步到测试库。
  确认无害后用 `db:check --apply` 补齐，再回到第 2 步重新校验。
- 出现 `DROP COLUMN` / `ALTER COLUMN … TYPE` → **停下来**。这说明测试库里有当前代码
  已经不要的列，补齐动作会直接删掉它。`--apply` 在这种情况下会拒绝执行，要再加
  `--allow-data-loss` 才肯动手——加之前先确认那些列真的没有数据（`select count(*)
  from <表> where <列> is not null`），并且已经备份。

一致之后再打基线。重申 5.2 里那条注释：**基线打在一个和代码不一致的库上，等于把
不一致永久固化**——之后所有迁移都从这个错误的起点往上叠，而且永远不会报错。

> **drizzle-kit 的交互提示，以及 `db:check` 怎么绕过它。**
>
> drizzle-kit 在两种情况下会拉起终端选择器：发现表/列被新增或删除时问「这是新的，
> 还是从某个旧的重命名来的？」；给一张**有数据的表**加唯一约束时问「要不要先
> truncate？」。非 TTY 环境（CI、管道、agent 的 shell）下它直接抛
> `Interactive prompts require a TTY`，真正的差异一个字都看不到。
>
> `db:check` 用两层处理：
>
> 1. **纯 SQL 的表级预检**，跑在 pushSchema 之前。表集合对不上就直接打印缺哪张、
>    多哪张然后退出——差异说得比那个提示清楚，而且根本走不到它。
> 2. **自动应答**（`installAutoAnswer`）：塞一个假 stdin 并定时喂回车，让选择器提交
>    预选的第 0 项——那永远是保守选项（「不要 truncate」）。有两个前提：
>    `process.stdout.isTTY` 也要为真（那个判断是「或」），且换 stdin 必须发生在
>    `import("drizzle-kit/api")` **之前**（它在 import 时就把 stdin 抓进内部 readline，
>    不是惰性取的）——这就是 `schema-diff.ts` 里 drizzle-kit 是动态 import 的原因。
>    兜底：真出现 `TRUNCATE` 语句会被当成数据丢失挡下来。
>
> 实测：测试库的 `invitation_record` 有 217 行，`db:check` 触发了 truncate 提示，
> 自动应答过掉之后结论是零差异，事后核对行数和约束都没变。
>
> 本地持久库的实际经历：它落后了 organization 模块和籍贯改造两个特性（缺 1 张表、
> 15 列，多 1 列 `member.native_place`）。处理办法是先把缺的表/列按 `0000_init.sql`
> 的原文补上（不手写 DDL），确认 `native_place` 有值的行数为 0 之后删掉它，再让
> `db:check --apply` 收尾剩下的 14 处约束级差异，最后校验零差异、打基线。

### 6.4 连不上测试库怎么办

`bun run db:check` / `db:baseline` 需要开发机能连到那个库——这和现在
「部署前人手跑 `bun run db:push`」的要求**完全一样**，所以连通性今天就已经具备。

哪天数据库被锁进内网了，退路是进容器跑 `bun run /app/migrate.js --baseline`（镜像里有它）。
但**容器里没有 drizzle-kit，做不了 6.2 第 2 步的校验**——那一步必须先在能跑 `db:check`
的地方做完，否则就是在闭着眼睛打基线。

## 7. 本地开发

### 7.1 `bun run dev`（临时库）：迁移 + 快照差异补齐 + 警告

`dev-seed/bootstrap.ts` 的 `pushTables()` 换成三步：

1. `migrate()` 把已经定稿的迁移全部重放一遍（空库，按 journal 顺序全跑）；
2. `pendingStatements()` 算出「当前 schema.ts 相对最新迁移快照」还差哪些语句；
3. 有差异就直接执行补上，同时打一条醒目的警告，列出缺的语句和
   「提交前记得 `bun run db:generate`」。

> **第 2 步刻意不用 `pushSchema`。** 最初的方案是用它干跑一次，实测不行：
> drizzle-kit 的内省 round-trip 不了**复合约束**（多列外键 / 多列唯一），本仓库
> 有 17 个，于是它每次都稳定报出 34 条「DROP 掉再原样 ADD 回去」的假差异——
> 每次 `bun run dev` 都刷一屏警告，真有问题时反而没人看。快照对比没有这个问题：
> 两边都是 kit 自己生成的 JSON，不经过数据库。
>
> 附带的好处是它和 7.4 的漂移测试**用的是同一份计算**（都在 `schema-diff.ts`），
> 所以启动时警告说什么，`bun run test` 就报什么，不会两头对不上。
>
> 顺带一提，旧的 `db:push` 每次也在默默做这 34 条空转，只是从来没人看见。

**刻意不做成「没生成迁移就拒绝启动」。** 改 schema 的过程中一小时可能动十次，
每次都逼着生成一个迁移文件、最后还得手工合并，那只会让人绕过整套机制。
所以：迁移负责已经定稿的部分，push 负责你正在改的部分，警告负责提醒你收尾。
真正的硬关卡在 7.4，它不需要数据库、跑得飞快，放在 `bun run test` 里。

`bun run dev` 的体感不变：临时库仍然是「起容器 → 建表 → 灌种子 → 3 秒可用」。

### 7.2 `bun run dev:persist`（持久库）：只跑迁移

**这是一处行为变化**：`dev:persist` 现在会自动执行迁移（不 push、不灌种子）。
AGENTS.md 里「不建表也不灌种子，schema 同步靠你手动 db:push」那句要跟着改。

理由是它和生产形态最接近：持久库有累积的真实数据，正好用来预演生产的迁移路径。
第一次跑会因为没有记账表而失败，提示你先 `bun run db:baseline`——这正是 6.2 说的演练。

### 7.3 改 schema 的日常动作

1. 改 `modules/<模块>/schema.ts`；
2. `bun run dev` 照常调试（push 自动补齐 + 一条警告）；
3. 改完了、准备提交前：`bun run db:generate`；
4. **打开生成的 SQL 看一眼**——这是整套机制里唯一真正需要动脑的一步。
   有没有 `DROP`？有没有 `NOT NULL` 加在一张已有数据的表上（会失败）？
   需不需要拆成 expand/contract 两版？
5. `bun run test`——漂移检查会告诉你有没有漏；
6. **SQL 文件和 schema.ts 放在同一个 commit 里提交。** 分开提交等于制造一个
   「代码要新列、迁移还没到」的中间提交，谁 checkout 到那里谁遭殃。

### 7.4 硬关卡：不连数据库的漂移检查

`apps/server/src/schema-drift.test.ts`，进 `bun run test`：

```ts
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";

// 拿 drizzle/meta/ 里最新的快照和「当前 schema.ts 生成的快照」做 diff。
// 全程不连数据库 —— 快照是 drizzle-kit generate 时顺手写下的 JSON 文件。
const statements = await generateMigration(
  latestSnapshot,
  generateDrizzleJson(await buildSchema(), latestSnapshot.id),
);

expect(statements).toEqual([]); // 非空 = 有 schema 改动没生成迁移
```

这是整套方案能成立的关键：dev 用 push、prod 用迁移文件，两条路本来会静默分叉——
某次改了 schema 忘了 `db:generate`，开发一切正常，**只有生产会缺表**。
这个检查把那个失败从「上线当天」提前到「合并之前」，代价是零（不需要库、毫秒级）。

同一个文件里再加一条 journal 顺序守卫，见第 8 节。

### 7.5 `db:push` 从脚本里删掉

根 `package.json` 的 db 脚本变成：

| 脚本 | 作用 |
| --- | --- |
| `db:generate` | drizzle-kit 生成迁移文件（唯一的写 schema 入口） |
| `db:migrate` | 跑 `apps/server/src/migrate.ts`，**和生产同一份代码** |
| `db:baseline` | 同上，带 `--baseline` |
| `db:check` | 只读比对某个库和当前代码 |
| `db:studio` | 不变 |
| ~~`db:push`~~ | **删掉** |

删掉比加护栏简单，也更彻底：`.env` 里放着生产连接串的人手一滑就是删列。
临时库那条路仍然用 `pushSchema()`，但它埋在 bootstrap.ts 里、且有
`EXPECTED_DATABASE_URL` 双重校验，够不着别的库。

## 8. 并行分支：这个仓库特别容易踩的坑

回到第 2 节第 4 条：**判断「该不该跑」用的是 `when` 时间戳，不是文件名顺序，
也不是「这一条有没有执行过」。**

于是这个场景会静默出事：

1. 分支 A 上午生成 `0001_a.sql`（when = T1）；
2. 分支 B 下午生成 `0001_b.sql`（when = T2 > T1）；
3. B 先合进 master 并部署，库里最后一条记录是 T2；
4. A 随后合进来、部署 —— `T1 < T2`，**`0001_a.sql` 永远不会执行**，不报任何错。

生产库缺一张表，而本地全绿（空库按数组顺序全跑一遍，见第 2 节第 4 条）。
这个仓库同时开多个 worktree/分支是常态，所以必须有守卫：

1. **`meta/_journal.json` 一定会产生 git 冲突**——两个分支都往 `entries` 数组尾部追加，
   文本上必然撞车。这是第一道自动防线，你不可能不看见它。
2. **冲突的正确解法是重新生成，不是手工合并。** rebase 时先拿 master 那一份
   （连同它的 `.sql`），删掉自己那条迁移文件，rebase 完成后重新 `bun run db:generate`。
   手工把两条 journal 记录都留下来，正好制造出上面那个场景。
3. **测试里断言 journal 的 `when` 严格递增**，且顺序和 `idx` 一致。手工合坏了会响。

另外一条同源的规矩：**迁移文件合进 master 之后就是不可变的。** 改一个已经在测试环境
跑过的 SQL 文件，那个库不会重跑它，你和它就永久分叉了。要改就加一条新迁移。

## 9. 规约速查

- **迁移只做加法。** 删列改类型拆成两次发版（5.6）。
- **迁移文件不可变。** 合进 master 就不许再改（第 8 节）。
- **迁移 ≠ 种子数据。** 迁移只管结构；初始管理员账号、字典数据这类初始化走单独的
  一次性命令。真正需要随结构一起走的**回填**（加一列后给存量行填默认值）可以写进迁移，
  但要意识到它靠 advisory lock 才做到只执行一次——没有那把锁就会跑两遍。
- **行尾**：`.gitattributes` 加一行

  ```
  apps/server/drizzle/**/*.sql text eol=lf
  ```

  迁移的 hash 是按文件字节算的（`sha256(整个文件)`），CRLF/LF 不一致会让同一份迁移在
  Windows 和容器里算出不同 hash。**这不会导致重复执行**（判断看的是 `created_at`），
  但会让审计记录对不上，而且本仓库 `core.autocrlf=true`，不写这行必然发生。
- **权限**：迁移用的账号需要 DDL 权限。哪天把应用账号收紧成只读写数据，就给迁移
  单独配一个 `MIGRATION_DATABASE_URL`，`migrate.ts` 优先读它、回落 `DATABASE_URL`。
- **迁移不要写成需要长时间锁表的形式**：大表加索引用 `CREATE INDEX CONCURRENTLY`，
  但它**不能在事务里跑**，而 drizzle 把所有迁移包在一个事务里——真遇到时单独拆一条
  迁移，并在 SQL 顶部写 `--> statement-breakpoint` 之外的说明，或者手工执行。
  当前数据量下不会遇到，先记着。

## 10. 实施状态

- [x] 1. `bun run db:generate --name init` 生成 `0000_init.sql`（39 张表，720 行）。
- [x] 2. 新增 `schema-registry.ts`，把 bootstrap.ts 里的 `buildSchema()` 挪过去。
- [x] 3. 新增 `migrate.ts`（迁移 + baseline + advisory lock）、`schema-diff.ts`、`schema-check.ts`。
- [x] 4. 两个 `package.json` 换 db 脚本组（7.5），删掉 `db:push`。
- [x] 5. 改 `bootstrap.ts`（7.1）和 `scripts/dev.ts`（7.2）。
- [x] 6. 新增 `schema-drift.test.ts`（7.4 + 第 8 节的 journal 守卫）。
      **已验证它会响**：临时加一列不生成迁移，测试报出确切的 `ALTER TABLE … ADD COLUMN`。
- [x] 7. 改 Dockerfile + entrypoint（5.3）。`bun build` 产出 `migrate.js` 281 KB，
      已确认没混进 drizzle-kit。
- [x] 8. `.gitattributes` 加 `apps/server/drizzle/**/*.sql text eol=lf`。
- [x] 9. **本地持久库已完成 6.2 全流程**：备份 → 对账（补 1 表 15 列、删 1 空列、
      补 14 处约束）→ 校验零差异 → 打基线 → 验证。数据完好，重复打基线会被拒绝。
- [x] 10. `bun run dev` / `dev:persist` 两条路径都跑通了。
- [x] 11. **镜像实机验证**（`docker buildx build` + 一次性 postgres）：
      - 空库启动 → `迁移完成：空库 → 0000_init（414ms）`，建出 39 张表，应用正常启动；
      - 重启同一容器 → `没有待执行的迁移（当前 0000_init）`，幂等；
      - **3 个副本同时拉起对着同一个空库** → 恰好 1 个执行迁移，另外 2 个等到锁之后
        发现无事可做，三个都正常启动，记账表只有 1 行。**advisory lock 实测有效。**
- [x] **12. 测试库已打基线**（2026-09-04）：备份 303 KB（347 条归档项 / 39 张表有数据）→
      `db:check` 触发 truncate 提示、自动应答过掉后输出**零差异** → 打基线 → 验证输出
      `没有待执行的迁移（当前 0000_init）`。事后核对：39 张表、`invitation_record` 仍 217 行、
      记账表 1 行，hash 与容器实测的一致（说明 LF 行尾这条规矩生效了）。重复打基线被拒绝。
- [ ] 13. 下一次部署时观察容器日志，应出现 `没有待执行的迁移（当前 0000_init）`。

## 10.1 已知代价

- `bun run dev` 现在多依赖一样东西：`apps/server/drizzle/` 必须存在。误删了就起不来，
  重新 `bun run db:generate` 即可（但注意别把已经合进 master 的迁移重新生成，见第 8 节）。
- `db:check` 依赖一个针对 drizzle-kit 交互提示的自动应答（6.3 的方框）。drizzle-kit
  升级后要重新验一遍：选择器的第 0 项必须仍是保守选项。

## 11. 故障速查

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| 容器启动报 `42P07 relation already exists` | 库里有表但没打基线 | 按 6.2 打基线 |
| 容器启动报「等待迁移锁超时」 | 另一个实例正在跑长迁移，或有连接卡死 | 查 `pg_locks`；确认无人在跑就重启该实例 |
| 部署完页面报「列不存在」 | 迁移被跳过（第 8 节的顺序问题） | `bun run db:check` 看差异，补一条新迁移 |
| `db:check` 在生产报差异 | 有人手工改过库，或迁移漏了 | 差异内容决定：补迁移 or 撤手工改动。**不要直接 push** |
| `bun run dev` 一直打漂移警告 | schema.ts 改了没生成迁移 | `bun run db:generate` |
| `bun run test` 漂移检查失败 | 同上，且已经准备提交了 | `bun run db:generate` 后重跑 |
| `db:check` 报 `Interactive prompts require a TTY` | 列级别有新增/删除，drizzle-kit 要问「新增还是重命名」 | 换到你自己的终端里跑同一条命令（6.3 的方框） |
| `db:check` 说「表级别就对不上」 | 库落后/超前了整张表 | 按 6.3 处理，**别打基线** |
| `bun run dev` 报找不到 `meta/_journal.json` | `apps/server/drizzle/` 没了 | `bun run db:generate`（先确认不是误删了已合并的迁移） |
