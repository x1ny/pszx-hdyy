import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DrizzleSnapshotJSON } from "drizzle-kit/api";
import { buildSchema } from "./schema-registry";

// 「当前 schema.ts 相对最新的迁移文件，还差哪些 SQL」——**全程不连数据库**。
//
// 被两处共用：dev 临时库的补齐（dev-seed/bootstrap.ts）和漂移测试
// （schema-drift.test.ts）。两边必须是同一份计算，否则 dev 里补进去的东西和
// 测试拦下来的东西对不上，警告就没有意义了。
//
// **刻意不用 pushSchema。** push 要内省真实库，而 drizzle-kit 的内省 round-trip
// 不了复合约束（多列外键 / 多列唯一）：本仓库有 17 个这样的约束，push 每次都会
// 稳定地报出 17 组「DROP 掉再原样 ADD 回去」的假差异。快照对比没有这个问题，
// 因为两边都是 kit 自己生成的 JSON，不经过数据库。

export type JournalEntry = { idx: number; tag: string; when: number };

export const MIGRATIONS_DIR = resolve(import.meta.dir, "../drizzle");

export function readJournal(): JournalEntry[] {
  const journalPath = `${MIGRATIONS_DIR}/meta/_journal.json`;
  const parsed = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: JournalEntry[];
  };

  return parsed.entries;
}

export function readSnapshot(idx: number) {
  return JSON.parse(
    readFileSync(
      `${MIGRATIONS_DIR}/meta/${String(idx).padStart(4, "0")}_snapshot.json`,
      "utf8",
    ),
  ) as DrizzleSnapshotJSON;
}

/** 还没生成迁移的那些语句。空数组 = schema.ts 和迁移文件完全同步。 */
export async function pendingStatements() {
  const latest = readJournal().at(-1);

  if (!latest) {
    throw new Error(
      "meta/_journal.json 里一条迁移都没有，先跑 `bun run db:generate`",
    );
  }

  // 动态 import 而不是写在文件顶部：drizzle-kit/api 的 bundle 在**被 import 的
  // 那一刻**就把 process.stdin 抓进它内部的 readline 里。schema-check.ts 需要在
  // import 之前先换掉 stdin（见那边的 installAutoAnswer），而它又要用本文件的
  // readJournal/readSnapshot —— 顶层 import 会让 drizzle-kit 提前加载，把那套
  // 机制废掉。这里保持惰性，上面两个函数就只依赖 node:fs。
  const { generateDrizzleJson, generateMigration } = await import(
    "drizzle-kit/api"
  );
  const previous = readSnapshot(latest.idx);
  const current = generateDrizzleJson(await buildSchema(), previous.id);

  return generateMigration(previous, current);
}
