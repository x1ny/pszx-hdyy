import { describe, expect, test } from "bun:test";
import { pendingStatements, readJournal } from "./schema-diff";

// 整套迁移方案能成立，靠的就是这个文件（docs/database-migrations.md 7.4）。
//
// 开发环境用快照差异补齐正在改的 schema，生产只认迁移文件 —— 两条路本来会
// 静默分叉：某次改了 schema 忘了 `bun run db:generate`，本地一切正常，**只有
// 生产会缺表**。这里把那个失败从「上线当天」提前到「合并之前」。
//
// 全程不连数据库，跑一次约 300ms。

const entries = readJournal();

describe("迁移文件", () => {
  test("journal 不为空", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  // drizzle 判断「这条要不要跑」用的是 when 时间戳和**最后一条记录**比大小，
  // 不是文件名顺序，也不是「这条有没有执行过」。所以两个分支各自生成一条迁移、
  // 合并时把顺序弄反的话，靠前那条会被永久跳过，且不报任何错（空库却会全跑，
  // 所以本地跑不出来）。详见 docs/database-migrations.md 第 8 节。
  //
  // _journal.json 的合并冲突是第一道防线，这里是第二道：手工合坏了会在这响。
  test("when 严格递增，且和 idx 顺序一致", () => {
    for (const [index, entry] of entries.entries()) {
      expect(entry.idx).toBe(index);

      const previous = entries[index - 1];
      if (previous) {
        // 相等也不行：两条 when 一样时，靠后那条会被判成「已执行」。
        expect(entry.when).toBeGreaterThan(previous.when);
      }
    }
  });

  test("schema.ts 的改动都已经生成迁移", async () => {
    const statements = await pendingStatements();

    if (statements.length > 0) {
      throw new Error(
        [
          `有 ${statements.length} 处 schema 改动还没生成迁移，跑 \`bun run db:generate\`：`,
          ...statements.map((statement) => `  ${statement}`),
        ].join("\n"),
      );
    }

    expect(statements).toEqual([]);
  });
});
