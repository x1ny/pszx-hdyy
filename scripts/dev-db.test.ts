import { describe, expect, test } from "bun:test";
import { containerNameFor } from "./dev-db";

// 这组用例守的是一个真实踩过的坑：容器名只取 basename 时，主仓库和 7 个
// Codex worktree 会算出同一个名字，而 dev 启动第一步就是 `docker rm -f 该名字`
// —— 等于任何一个 worktree 起 dev 都会杀掉别人的数据库。
describe("containerNameFor", () => {
  // 取自真实的 `git worktree list`：Codex 的叶目录全是 `pszx-hdyy`。
  const CODEX_STYLE = [
    "C:/Users/Administrator/.codex/worktrees/08fc/pszx-hdyy",
    "C:/Users/Administrator/.codex/worktrees/20be/pszx-hdyy",
    "C:/Users/Administrator/.codex/worktrees/2665/pszx-hdyy",
  ];
  const CLAUDE_STYLE = [
    "E:/workspace/pszx-hdyy/.claude/worktrees/table-filter-query-button-fcd1a7",
    "E:/workspace/pszx-hdyy/.claude/worktrees/file-management-module-design-2a97a9",
  ];
  const MAIN = "E:/workspace/pszx-hdyy";

  test("叶目录相同的 Codex worktree 之间不撞名", () => {
    const names = CODEX_STYLE.map(containerNameFor);
    expect(new Set(names).size).toBe(names.length);
  });

  test("Codex worktree 与主工作区不撞名", () => {
    const names = [MAIN, ...CODEX_STYLE].map(containerNameFor);
    expect(new Set(names).size).toBe(names.length);
  });

  test("所有形态放一起仍然两两不同", () => {
    const names = [MAIN, ...CODEX_STYLE, ...CLAUDE_STYLE].map(containerNameFor);
    expect(new Set(names).size).toBe(names.length);
  });

  test("同一路径的不同写法算出同一个名字", () => {
    // Windows 路径大小写不敏感，两种分隔符都合法；不归一化的话同一个
    // worktree 会因为写法不同拿到两个容器。
    const backslash = String.raw`E:\workspace\PSZX-hdyy`;
    expect(containerNameFor(backslash)).toBe(containerNameFor(MAIN));
  });

  test("名字符合 Docker 的容器名规则", () => {
    for (const path of [MAIN, ...CODEX_STYLE, ...CLAUDE_STYLE]) {
      expect(containerNameFor(path)).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);
    }
  });

  test("保留可读前缀，便于在 docker ps 里认出是谁的", () => {
    expect(containerNameFor(MAIN)).toStartWith("pszx-dev-db-pszx-hdyy-");
  });
});
