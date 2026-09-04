#!/usr/bin/env bun
import { PassThrough } from "node:stream";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { readJournal, readSnapshot } from "./schema-diff";
import { buildSchema } from "./schema-registry";

// 「这个**真实库**的结构和当前代码一致吗」——默认只读，什么都不改。
//
// 两个用途：
//   1. 打基线之前的校验（docs/database-migrations.md 6.2）。基线是在断言
//      「这个库 = 0000 描述的结构」，断言错了就把错误永久固化了。
//   2. 排查线上漂移：有人手工改过库、或者某条迁移被跳过时，用它看差在哪。
//
// 和 src/schema-diff.ts 的分工：那个比对的是「代码 vs 迁移文件」（不连库），
// 这个比对的是「代码 vs 一个真实的库」（必须连库，所以只能用 pushSchema 内省）。
//
// `--apply` 是唯一一条把差异写进库的路径，取代了原先的 `db:push`。它要求显式
// 加参数，带数据丢失风险时还要再加一个 —— `db:push` 出事就出在「一条命令、
// 不问、直接删列」。

/**
 * 让 drizzle-kit 的交互提示能在非 TTY 环境（CI、管道、agent 的 shell）下自动过掉。
 *
 * 它遇到「这张表有 217 行数据，加唯一约束前要不要 truncate？」这类问题时会拉起一个
 * hanji 终端选择器，`!process.stdin.isTTY || !process.stdout.isTTY` 时直接抛
 * `Interactive prompts require a TTY terminal` —— 真正的 schema 差异一个字都看不到。
 *
 * 做法：塞一个假的 stdin（`isTTY = true` + 空的 `setRawMode`），并定时喂回车，
 * 让选择器提交**预选的第 0 项**。第 0 项永远是保守选项（「不要 truncate」），
 * 危险选项从来不在首位。
 *
 * **两个前提，缺一不可：**
 *   1. `process.stdout.isTTY` 也要为真，那个判断是「或」。
 *   2. 换 stdin 必须发生在 `import("drizzle-kit/api")` **之前** —— 它的 bundle
 *      在 import 时就把 `process.stdin` 抓进内部的 readline，不是惰性取的。
 *      所以下面用的是 `await import(...)`，schema-diff.ts 也跟着改成了动态 import。
 *
 * 兜底在下面：真出现 TRUNCATE 语句时会被当成数据丢失挡下来。
 */
function installAutoAnswer() {
  const stdin = new PassThrough();
  Object.assign(stdin, { isTTY: true, setRawMode: () => stdin });
  Object.defineProperty(process, "stdin", {
    value: stdin,
    configurable: true,
  });

  const stdoutWasTty = process.stdout.isTTY;
  process.stdout.isTTY = true;

  const timer = setInterval(() => stdin.write("\r"), 50);
  timer.unref?.();

  return () => {
    clearInterval(timer);
    process.stdout.isTTY = stdoutWasTty;
  };
}

type Parsed = { table: string; name: string; body?: string; raw: string };

const DROP_PATTERN = /^ALTER TABLE "([^"]+)" DROP CONSTRAINT "([^"]+)"/;
const ADD_PATTERN =
  /^ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)" ([\s\S]+)$/;

/**
 * 把一段约束定义压成可比较的形状。
 *
 * 两边的写法不同但语义相同：drizzle 写 `FOREIGN KEY("a","b") REFERENCES
 * "public"."t"("x") ON DELETE no action`，Postgres 的 pg_get_constraintdef 写
 * `FOREIGN KEY (a, b) REFERENCES t(x)`（NO ACTION 是默认值，它压根不写）。
 */
function canonical(definition: string) {
  return definition
    .replace(/"/g, "")
    .replace(/\bpublic\./gi, "")
    .replace(/ON DELETE NO ACTION/gi, "")
    .replace(/ON UPDATE NO ACTION/gi, "")
    .replace(/\s*([(),])\s*/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/;\s*$/, "")
    .trim()
    .toUpperCase();
}

function parse(statement: string): {
  drop?: Parsed;
  add?: Parsed;
  raw: string;
} {
  const raw = statement.trim();
  const dropped = DROP_PATTERN.exec(raw);

  if (dropped) {
    return {
      raw,
      drop: { table: dropped[1] as string, name: dropped[2] as string, raw },
    };
  }

  const added = ADD_PATTERN.exec(raw);

  if (added) {
    return {
      raw,
      add: {
        table: added[1] as string,
        name: added[2] as string,
        body: added[3] as string,
        raw,
      },
    };
  }

  return { raw };
}

const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  console.error("\n[db:check] DATABASE_URL 没有设置\n");
  process.exit(1);
}

const shouldApply = process.argv.includes("--apply");
const allowDataLoss = process.argv.includes("--allow-data-loss");
const pool = new Pool({ connectionString: databaseUrl });
const db = drizzle({ client: pool });

console.log(
  `[db:check] 目标库：${databaseUrl.replace(/:\/\/[^@/]*@/, "://***@")}`,
);

// 表级预检，用纯 SQL 做，**必须在 pushSchema 之前**。
//
// pushSchema 一旦发现有表被新增或删除，就会弹一个「这是新表，还是从某张表
// 重命名来的？」的交互提示 —— 非 TTY 环境（CI、管道、agent 的 shell）下它
// 直接抛错，报的是 "Interactive prompts require a TTY"，完全看不出真正的差异
// 是什么。先把表集合比一遍，差异在这一层就能说清楚，也就不会走到那个提示。
const expectedTables = new Set(
  Object.keys(readSnapshot(readJournal().at(-1)?.idx ?? 0).tables).map((key) =>
    key.replace(/^public\./, ""),
  ),
);
const actualTableRows = await db.execute<{ table_name: string }>(sql`
  select table_name
  from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'
`);
const actualTables = new Set(actualTableRows.rows.map((row) => row.table_name));

const missingTables = [...expectedTables].filter(
  (name) => !actualTables.has(name),
);
const extraTables = [...actualTables].filter(
  (name) => !expectedTables.has(name),
);

if (missingTables.length > 0 || extraTables.length > 0) {
  console.error("\n[db:check] 表级别就对不上，不再往下比字段：\n");

  for (const name of missingTables) {
    console.error(`  缺少（代码有、库里没有）：${name}`);
  }
  for (const name of extraTables) {
    console.error(`  多出（库里有、代码没有）：${name}`);
  }

  console.error(
    [
      "",
      "  这个库还没跟上代码。**不要在这个状态下打基线** —— 基线会把差异永久固化。",
      "  处理办法见 docs/database-migrations.md 6.3。",
      "",
    ].join("\n"),
  );
  await pool.end();
  process.exit(1);
}

const restoreStdio = installAutoAnswer();
// 动态 import：必须在 installAutoAnswer() 之后，理由见那个函数的注释。
const { pushSchema } = await import("drizzle-kit/api");
const { statementsToExecute, hasDataLoss, warnings, apply } = await pushSchema(
  (await buildSchema()) as never,
  db as never,
);
restoreStdio();

// 库里每个约束的真实定义，用来判断「DROP 了再 ADD 回去」到底是不是空转。
const constraintRows = await db.execute<{
  table_name: string;
  constraint_name: string;
  definition: string;
}>(sql`
  select rel.relname as table_name,
         con.conname as constraint_name,
         pg_get_constraintdef(con.oid) as definition
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace ns on ns.oid = rel.relnamespace
  where ns.nspname = 'public'
`);

const actualDefinitions = new Map(
  constraintRows.rows.map((row) => [
    `${row.table_name}.${row.constraint_name}`,
    row.definition,
  ]),
);

const parsed = statementsToExecute.map(parse);
const droppedKeys = new Set(
  parsed.flatMap(({ drop }) => (drop ? [`${drop.table}.${drop.name}`] : [])),
);

/**
 * drizzle-kit 的内省 round-trip 不了复合约束（多列外键 / 多列唯一），对每个这样
 * 的约束都会稳定地报出一组「DROP 掉再原样 ADD 回去」。这个库有 17 个复合约束，
 * 于是每次 check 都会多出 34 条纯空转的语句。
 *
 * 不能只按名字配对就当噪音忽略 —— 那样一个**真的改了定义**的复合约束（同名、
 * 不同列）也会被一起吞掉。所以拿库里的真实定义比一遍：定义一致才算噪音，
 * 不一致就是真差异，照常报出来。
 */
const isIntrospectionNoise = (entry: ReturnType<typeof parse>) => {
  const target = entry.add ?? entry.drop;

  if (!target || !droppedKeys.has(`${target.table}.${target.name}`)) {
    return false;
  }

  const actual = actualDefinitions.get(`${target.table}.${target.name}`);

  if (!actual) {
    return false;
  }

  // DROP 那条没带定义，配对的 ADD 才有。两条一起判，结论必须一致。
  const addBody = entry.add
    ? entry.add.body
    : parsed.find(
        ({ add }) => add?.table === target.table && add?.name === target.name,
      )?.add?.body;

  return addBody !== undefined && canonical(addBody) === canonical(actual);
};

const noise = parsed.filter(isIntrospectionNoise);
const real = parsed.filter((entry) => !isIntrospectionNoise(entry));

for (const warning of warnings) {
  console.warn(`[db:check] 警告：${warning}`);
}

if (noise.length > 0) {
  console.log(
    `[db:check] 忽略 ${noise.length} 条复合约束的内省空转（DROP 后原样 ADD 回去，已逐条核对库里的真实定义）`,
  );
}

if (real.length === 0) {
  console.log("[db:check] 零差异：这个库的结构和当前代码一致");
  await pool.end();
  process.exit(0);
}

console.log(
  `\n[db:check] 有 ${real.length} 处真实差异${hasDataLoss ? "（⚠ 含数据丢失风险）" : ""}：\n`,
);

for (const entry of real) {
  console.log(`  ${entry.raw}`);
}

if (!shouldApply) {
  console.log(
    "\n[db:check] 以上语句**没有执行**。确认无害后用 `--apply` 写入。\n",
  );
  await pool.end();
  process.exit(1);
}

// 兜底：自动应答只选第 0 项（保守项），理论上不会产生 TRUNCATE。万一 drizzle-kit
// 改了选项顺序，这里把它拦下来 —— 一条 TRUNCATE 能清空一整张有数据的表。
const truncates = real.filter((entry) => /^TRUNCATE\b/i.test(entry.raw));

if (truncates.length > 0 && !allowDataLoss) {
  console.error(
    "\n[db:check] 这批语句里有 TRUNCATE，拒绝执行：\n" +
      truncates.map((entry) => `  ${entry.raw}`).join("\n") +
      "\n  这不该出现（自动应答只选保守项）。先查清楚再决定，别顺手加 --allow-data-loss。\n",
  );
  await pool.end();
  process.exit(1);
}

if (hasDataLoss && !allowDataLoss) {
  console.error(
    "\n[db:check] 这批语句会丢数据，拒绝执行。\n" +
      "  确认那些数据真的不要了，再加 `--allow-data-loss`。\n",
  );
  await pool.end();
  process.exit(1);
}

await apply();
await pool.end();
console.log("\n[db:check] 已写入。");
