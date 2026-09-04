#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

// 迁移入口，刻意独立于 index.ts：应用进程不碰 schema，「迁移失败」和「应用起来了
// 但表结构不对」必须是两种能分辨的状态。容器 entrypoint 在 exec server.js 之前
// 跑它一次，本地 `bun run db:migrate` 跑的也是这一份。
//
// **这条 import 链上只有 drizzle-orm 和 pg，没有 drizzle-kit。** 所以
// `bun build` 出来的 dist/migrate.js 能进镜像而不会把整个 kit 拖进去，
// 运行阶段仍然零 node_modules。加 import 之前先想清楚这一点。
//
// 完整方案见 docs/database-migrations.md。

type Journal = { entries: JournalEntry[] };
type JournalEntry = { idx: number; tag: string; when: number };
type Db = ReturnType<typeof drizzle>;

const MIGRATIONS_DIR =
  process.env.MIGRATIONS_DIR?.trim() || resolve(import.meta.dir, "../drizzle");

// 任意常量，含义只有「全仓统一」。改这个值等于换一把锁 —— 正在跑的实例挡不住
// 新实例，也就没有互斥了。
const MIGRATION_LOCK_ID = 1_887_320_164;
const LOCK_WAIT_TIMEOUT_MS = 5 * 60_000;
const LOCK_POLL_INTERVAL_MS = 500;

function fail(message: string): never {
  console.error(`\n[migrate] ${message}\n`);
  process.exit(1);
}

/** 连接串里有密码，打日志前抹掉。 */
function maskUrl(url: string) {
  return url.replace(/:\/\/[^@/]*@/, "://***@");
}

function readJournal(): JournalEntry[] {
  const journalPath = `${MIGRATIONS_DIR}/meta/_journal.json`;

  if (!existsSync(journalPath)) {
    fail(
      `找不到 ${journalPath}。\n` +
        "  迁移文件是随代码走的：本地先跑 `bun run db:generate`，镜像里则应该由 Dockerfile COPY 进来。",
    );
  }

  return (JSON.parse(readFileSync(journalPath, "utf8")) as Journal).entries;
}

/**
 * 已执行到哪一条。返回记账表里最大的 `created_at`，空库或没有记账表时返回 null。
 *
 * 判断依据必须和 drizzle 自己一致：它用的是 `created_at`（= journal 里的
 * `when`），不是 hash，也不是文件名。
 */
async function lastAppliedAt(db: Db): Promise<number | null> {
  const present = await db.execute<{ present: boolean }>(
    sql`select to_regclass('drizzle.__drizzle_migrations') is not null as present`,
  );

  if (!present.rows[0]?.present) {
    return null;
  }

  const row = await db.execute<{ created_at: string | null }>(
    sql`select created_at from drizzle.__drizzle_migrations order by created_at desc limit 1`,
  );
  const value = row.rows[0]?.created_at;

  return value == null ? null : Number(value);
}

/** 把 when 时间戳翻译成迁移名，日志里才有意义。 */
function describe(when: number | null, entries: JournalEntry[]) {
  if (when === null) {
    return "空库";
  }

  return entries.find((entry) => entry.when === when)?.tag ?? `when=${when}`;
}

async function withLock<T>(pool: Pool, run: () => Promise<T>) {
  // 会话级 advisory lock 跟着**连接**走，所以必须独占一条 client：直接用
  // pool.query 的话 unlock 可能落到另一条连接上，锁就永远留在库里了。
  const client = await pool.connect();
  const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;

  try {
    for (;;) {
      const { rows } = await client.query<{ locked: boolean }>(
        "select pg_try_advisory_lock($1) as locked",
        [MIGRATION_LOCK_ID],
      );

      if (rows[0]?.locked) {
        break;
      }

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
    // 自动释放。这正是它比「在表里插一行当锁」强的地方 —— 那种锁得自己处理残留。
    await client
      .query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_ID])
      .catch(() => {});
    client.release();
  }
}

/** public 下有几张业务表。用来分辨「空库」和「已有数据的库」。 */
async function countPublicTables(db: Db) {
  const result = await db.execute<{ count: string }>(sql`
    select count(*)::text as count
    from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
  `);

  return Number(result.rows[0]?.count ?? 0);
}

/**
 * 把一个「表已经建好、但没有记账表」的库标记成「0000 已执行」。
 *
 * 用于测试环境和本地持久库这种由 db:push 建出来、又不能删数据的库。它**只写
 * 记账表，一个业务表都不碰**，所以不会丢任何数据。
 *
 * **前提是这个库的结构确实等于 0000 描述的结构** —— 先跑 `bun run db:check`
 * 确认零差异再打。基线打在一个不一致的库上，等于把不一致永久固化：之后所有
 * 迁移都会从这个错误的起点往上叠，而且不会有任何报错。
 */
async function baseline(db: Db, entries: JournalEntry[]) {
  const first = entries[0];

  if (!first) {
    fail("meta/_journal.json 里一条迁移都没有，先跑 `bun run db:generate`");
  }

  // 空库打基线是灾难：0000 会被标记成已执行，但表一张都没建，之后永远不会
  // 补上，而应用只会在跑到某条 SQL 时才炸。
  if ((await countPublicTables(db)) === 0) {
    fail(
      "这是个空库（public 下一张表都没有），不需要打基线。\n" +
        "  直接跑 `bun run db:migrate`，它会从 0000 开始把表建全。",
    );
  }

  if ((await lastAppliedAt(db)) !== null) {
    fail(
      "这个库已经有迁移记录了，不需要打基线。\n" +
        "  重复打基线会让本该执行的迁移被跳过。",
    );
  }

  // hash 算法必须和 drizzle 的 readMigrationFiles 一致：sha256(整个 .sql 文件内容)。
  // 它只是记账字段（「跑到哪了」看的是 created_at），但对不上会让审计记录失去意义。
  const hash = createHash("sha256")
    .update(readFileSync(`${MIGRATIONS_DIR}/${first.tag}.sql`, "utf8"))
    .digest("hex");

  await db.execute(sql`create schema if not exists drizzle`);
  await db.execute(sql`
    create table if not exists drizzle.__drizzle_migrations (
      id serial primary key,
      hash text not null,
      created_at bigint
    )
  `);
  await db.execute(sql`
    insert into drizzle.__drizzle_migrations (hash, created_at)
    values (${hash}, ${first.when})
  `);

  console.log(
    `[migrate] 已打基线：${first.tag} 标记为已执行（when=${first.when}），业务表未做任何改动`,
  );
  console.log(
    "[migrate] 下一步跑 `bun run db:migrate` 验证，应该输出「没有待执行的迁移」",
  );
}

const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  fail("DATABASE_URL 没有设置");
}

const isBaseline = process.argv.includes("--baseline");
const pool = new Pool({ connectionString: databaseUrl });
const db = drizzle({ client: pool });

// 打日志确认连的是哪个库。「你以为在测试库、其实在本地持久库」这类事故，
// 代价大到值得每次多打一行。
console.log(`[migrate] 目标库：${maskUrl(databaseUrl)}`);

try {
  await withLock(pool, async () => {
    const entries = readJournal();

    if (isBaseline) {
      await baseline(db, entries);
      return;
    }

    const before = await lastAppliedAt(db);
    const startedAt = Date.now();
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    const after = await lastAppliedAt(db);

    // 部署日志里要能一眼看出这次到底动没动库 —— migrate() 自己什么都不说。
    console.log(
      before === after
        ? `[migrate] 没有待执行的迁移（当前 ${describe(after, entries)}）`
        : `[migrate] 迁移完成：${describe(before, entries)} → ${describe(after, entries)}（${Date.now() - startedAt}ms）`,
    );
  });
} finally {
  await pool.end();
}
