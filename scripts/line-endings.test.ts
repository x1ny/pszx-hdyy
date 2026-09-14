import { afterEach, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve, sep } from "node:path";
import { normalizeLineEndings } from "./normalize-line-endings";

const project = resolve(import.meta.dir, "..");
const attributes = readFileSync(resolve(project, ".gitattributes"));
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    if (!directory.startsWith(`${resolve(tmpdir())}${sep}project-eol-`))
      throw new Error("拒绝清理非测试临时目录");
    rmSync(directory, { recursive: true });
  }
});

function put(root: string, path: string, content: string | Buffer) {
  const absolute = resolve(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

function git(root: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", ...args], { cwd: root });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result;
}

function fixture(autocrlf: string) {
  const root = mkdtempSync(resolve(tmpdir(), "project-eol-"));
  directories.push(root);
  const repo = resolve(root, "repo");
  mkdirSync(repo);
  git(repo, "init", "--quiet");
  git(repo, "config", "user.name", "Line ending test");
  git(repo, "config", "user.email", "eol-test@example.invalid");
  git(repo, "config", "commit.gpgsign", "false");
  git(repo, "config", "core.hooksPath", resolve(root, "empty-hooks"));
  git(repo, "config", "core.autocrlf", autocrlf);
  git(repo, "config", "core.safecrlf", "true");
  put(repo, ".gitattributes", attributes);
  return { root, repo };
}

for (const autocrlf of ["true", "false"]) {
  test(`新 worktree 在 autocrlf=${autocrlf} 下保持 LF、批处理与二进制字节`, () => {
    const { root, repo } = fixture(autocrlf);
    const files = {
      "apps/web/src/中文 页面.tsx": 'export const title = "页面";\n',
      "scripts/tool.ts": "export const value = 1;\n",
      "docs/guide.md": "# 指南\n\n正文\n",
      "apps/server/drizzle/0000_test.sql": "SELECT 1;\n",
      ".githooks/pre-commit": "#!/bin/sh\nexit 0\n",
      "run.cmd": "@echo off\r\necho hello\r\n",
      // 即使内容像文本，已声明的二进制格式也不能被转码。
      "sample.docx": "binary fixture\r\nunchanged\r\n",
      "sample.png": Buffer.from([0, 13, 10, 255, 13, 10]),
    };
    for (const [path, content] of Object.entries(files))
      put(repo, path, content);
    expect(git(repo, "add", "--all").stderr.toString()).not.toContain(
      "will be replaced",
    );
    git(repo, "commit", "--quiet", "-m", "fixture");
    const checkout = resolve(root, "checkout");
    git(repo, "worktree", "add", "--quiet", "--detach", checkout, "HEAD");
    for (const [path, content] of Object.entries(files))
      expect(readFileSync(resolve(checkout, path))).toEqual(
        Buffer.from(content),
      );
    expect(normalizeLineEndings(checkout).normalized).toEqual([]);
    expect(git(checkout, "status", "--porcelain").stdout.toString()).toBe("");
  });
}

test("旧工作副本一次性归一化，保留暂存/未暂存修改与未跟踪文件，再执行无变化", () => {
  const { repo } = fixture("true");
  for (const path of ["clean.ts", "dirty.ts", "staged.ts"])
    put(repo, path, "export const value = 1;\n");
  git(repo, "add", "--all");
  git(repo, "commit", "--quiet", "-m", "fixture");
  put(repo, "clean.ts", "export const value = 1;\r\n");
  put(repo, "dirty.ts", "export const value = 2;\r\n");
  put(repo, "staged.ts", "export const value = 3;\n");
  git(repo, "add", "--", "staged.ts");
  put(repo, "staged.ts", "export const value = 3;\r\n");
  put(repo, "untracked.ts", "export const value = 4;\r\n");
  const before = git(repo, "diff", "--cached").stdout.toString();
  const result = normalizeLineEndings(repo);
  expect(result.normalized).toEqual(["clean.ts"]);
  expect(result.skipped).toEqual(["dirty.ts", "staged.ts"]);
  expect(readFileSync(resolve(repo, "clean.ts"), "utf8")).not.toContain("\r");
  for (const path of ["dirty.ts", "staged.ts", "untracked.ts"])
    expect(readFileSync(resolve(repo, path), "utf8")).toContain("\r\n");
  expect(git(repo, "diff", "--cached").stdout.toString()).toBe(before);
  const status = git(repo, "status", "--porcelain").stdout.toString();
  expect(status).not.toContain("clean.ts");
  expect(status).toContain("dirty.ts");
  expect(status).toContain("staged.ts");
  expect(status).toContain("untracked.ts");
  expect(normalizeLineEndings(repo).normalized).toEqual([]);
});

test("非 Git 安装目录可跳过，不改现有文件", () => {
  const root = mkdtempSync(resolve(tmpdir(), "project-eol-"));
  directories.push(root);
  put(root, "sample.ts", "text\r\n");
  expect(normalizeLineEndings(root).available).toBe(false);
  expect(readFileSync(resolve(root, "sample.ts"), "utf8")).toBe("text\r\n");
});

test("Biome 检查不写文件，保留失败状态；历史原型不进入应用检查范围", () => {
  const { repo } = fixture("false");
  put(repo, "biome.json", readFileSync(resolve(project, "biome.json")));
  const config = JSON.parse(
    readFileSync(resolve(project, "package.json"), "utf8"),
  );
  // 使用真实根 check 的参数和已安装 CLI，避免测试里另写一套只读行为。
  const [runner, ...args] = (config.scripts.check as string).split(" ");
  if (runner !== "biome") throw new Error("check 入口已改变，需要重审此验证");
  const check = () =>
    Bun.spawnSync(
      [
        process.execPath,
        resolve(project, "node_modules/@biomejs/biome/bin/biome"),
        ...args,
      ],
      { cwd: repo },
    );
  put(repo, "apps/web/src/sample.ts", "export const sample = 1;\n");
  put(repo, "docs/新版H5_Demo/app/src/broken.ts", "export const = ;\r\n");
  const valid = check();
  if (valid.exitCode !== 0)
    throw new Error(valid.stdout.toString() + valid.stderr.toString());
  const malformed = "export const sample={ value:1 };\r\n";
  put(repo, "apps/web/src/sample.ts", malformed);
  expect(check().exitCode).not.toBe(0);
  expect(readFileSync(resolve(repo, "apps/web/src/sample.ts"), "utf8")).toBe(
    malformed,
  );
});
