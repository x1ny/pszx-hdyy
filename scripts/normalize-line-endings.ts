import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

function git(root: string, args: string[]) {
  return Bun.spawnSync(["git", ...args], { cwd: root });
}

function readGit(root: string, args: string[]) {
  const result = git(root, args);
  if (result.exitCode !== 0) throw new Error(result.stderr.toString().trim());
  return result.stdout.toString();
}

function refreshCleanIndex(root: string, paths: string[]) {
  // Git 在属性文件变更后会保留旧的工作副本 stat 信息；--renormalize
  // 只为已确认干净的文件刷新该信息，索引 blob 不会变化。
  for (let start = 0; start < paths.length; start += 100) {
    const result = git(root, [
      "add",
      "--renormalize",
      "--",
      ...paths.slice(start, start + 100),
    ]);
    if (result.exitCode !== 0) throw new Error(result.stderr.toString().trim());
  }
}

function ordinaryStatusPath(entry: string) {
  let separator = -1;
  // `1` 记录的路径在八个固定字段之后，路径本身可以包含空格。
  for (let index = 0; index < 8; index += 1) {
    separator = entry.indexOf(" ", separator + 1);
    if (separator === -1) throw new Error("无法解析 Git 状态记录");
  }
  return entry.slice(separator + 1);
}

function staleWorktreePaths(root: string, dirty: Set<string>) {
  return readGit(root, ["status", "--porcelain=v2", "-z"])
    .split("\0")
    .filter((entry) => entry.startsWith("1 .M "))
    .map(ordinaryStatusPath)
    .filter((path) => !dirty.has(path));
}

// .gitattributes 不会刷新已检出的未改文件。安装时只整理这些旧副本，
// 不格式化代码、不加入语义改动暂存区，也不改用户的 Git 配置。
export function normalizeLineEndings(root: string) {
  const normalized: string[] = [];
  const skipped: string[] = [];
  let top: ReturnType<typeof git>;
  try {
    top = git(root, ["rev-parse", "--show-toplevel"]);
  } catch {
    return { normalized, skipped, available: false };
  }
  if (top.exitCode !== 0) return { normalized, skipped, available: false };
  const realRoot = realpathSync(root);
  if (realpathSync(top.stdout.toString().trim()) !== realRoot)
    throw new Error("换行整理必须从仓库根目录执行");

  // 包括暂存及未暂存的语义变化；这些文件归当前任务所有，不代为改写。
  // 分开读取可支持尚没有首个提交的仓库。
  const dirty = new Set(
    [
      readGit(root, ["diff", "--name-only", "-z", "--"]),
      readGit(root, ["diff", "--cached", "--name-only", "-z", "--"]),
    ]
      .flatMap((output) => output.split("\0"))
      .filter(Boolean),
  );
  const entries = readGit(root, ["ls-files", "--eol", "-z"])
    .split("\0")
    .filter(Boolean);
  for (const entry of entries) {
    const tab = entry.indexOf("\t");
    const info = entry.slice(0, tab);
    const path = entry.slice(tab + 1);
    // 只处理索引已是 LF、工作副本有 CRLF 且当前属性要求 LF 的文本。
    // 二进制、批处理及尚需迁移索引的特殊文件不在此自动整理。
    if (
      !/^i\/lf\s+w\/(?:crlf|mixed)\s/.test(info) ||
      !/\beol=lf\s*$/.test(info)
    )
      continue;
    if (dirty.has(path)) {
      skipped.push(path);
      continue;
    }
    const absolute = resolve(root, path);
    if (!existsSync(absolute)) {
      skipped.push(path);
      continue;
    }
    const within = relative(realRoot, realpathSync(absolute));
    if (
      within === ".." ||
      within.startsWith(`..${sep}`) ||
      isAbsolute(within) ||
      !lstatSync(absolute).isFile()
    ) {
      skipped.push(path);
      continue;
    }
    const bytes = readFileSync(absolute);
    // Latin-1 往返逐字节保留原数据，只移除 CRLF 中的 CR；不重编码文本。
    const lf = Buffer.from(
      bytes.toString("latin1").replaceAll("\r\n", "\n"),
      "latin1",
    );
    if (!bytes.equals(lf)) {
      writeFileSync(absolute, lf);
      normalized.push(path);
    }
  }
  // 属性变更前已被其他工具改为 LF 的文件也可能只留下陈旧 stat 缓存。
  refreshCleanIndex(root, [
    ...new Set([...normalized, ...staleWorktreePaths(root, dirty)]),
  ]);
  return { normalized, skipped, available: true };
}

if (import.meta.main) {
  try {
    const result = normalizeLineEndings(resolve(import.meta.dir, ".."));
    if (result.normalized.length)
      console.log(
        `[eol] 已将 ${result.normalized.length} 个干净工作副本恢复为 LF`,
      );
    if (result.skipped.length)
      console.warn(
        `[eol] 保留 ${result.skipped.length} 个已修改或特殊文件，未改写其内容`,
      );
  } catch (error) {
    console.error(
      `[eol] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
