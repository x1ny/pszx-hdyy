import { existsSync } from "node:fs";
import { resolve } from "node:path";

// 线性历史的强制层，由 postinstall 落地。
//
// 为什么是 git config 而不是 .claude/settings.json 的 hook：这个仓库同时被
// Claude Code 和 Codex 的 worktree 使用（两边各有若干分支在飞），只对某一个
// 工具生效的规则等于只防住一半，还会造成「已经防住了」的错觉。git 这一层
// 对所有工具、所有 worktree、以及人手动敲的命令一视同仁。
//
// 挂 postinstall 而不是让人记得跑 `bun run setup`：新 worktree 必然要
// `bun install`，所以它必然被执行到，不依赖任何人记性。

const repoRoot = resolve(import.meta.dir, "..");
const HOOKS_DIR = ".githooks";
const HOOKS = ["pre-commit", "pre-merge-commit"];

const SETTINGS: [key: string, value: string, why: string][] = [
  ["merge.ff", "only", "拒绝任何非快进合并"],
  ["pull.ff", "only", "分支落后时 pull 失败而不是悄悄生成合并提交"],
  ["core.hooksPath", HOOKS_DIR, "启用仓库内版本化的钩子"],
];

async function git(args: string[]) {
  const proc = Bun.spawn(["git", ...args], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

const warnings: string[] = [];

// 生产镜像的构建过程里也会跑 bun install，那里没有 .git。这个脚本在任何
// 情况下都不该让安装失败 —— 它是便利设施，不是构建的一环。
const inRepo = await git(["rev-parse", "--git-dir"]);
if (inRepo.exitCode !== 0) {
  process.exit(0);
}

const applied: string[] = [];

for (const [key, value, why] of SETTINGS) {
  const current = await git(["config", "--get", key]);

  if (current.stdout === value) {
    continue;
  }

  const result = await git(["config", key, value]);
  if (result.exitCode === 0) {
    applied.push(`${key}=${value}（${why}）`);
  } else {
    // 早先这里是静默 continue。一个写不进去的强制层等于没有强制层，
    // 而且比没有更糟——所有人都以为它在生效。
    warnings.push(
      `写入 git 配置 ${key}=${value} 失败：${result.stderr || "未知原因"}`,
    );
  }
}

// 钩子文件必须存在，且在索引里是可执行的。Windows 上 core.fileMode=false，
// chmod 不会反映到 git 索引里，于是很容易提交成 100644 —— 而 Unix 的 git
// **会静默忽略不可执行的钩子**。那是最坏的失败形态：规则看起来装好了，
// 实际一条都不生效。
for (const hook of HOOKS) {
  const hookPath = `${HOOKS_DIR}/${hook}`;

  if (!existsSync(resolve(repoRoot, hookPath))) {
    warnings.push(
      `${hookPath} 不存在。当前分支可能还没 rebase 到包含它的提交上；` +
        "merge.ff=only 仍然生效，但挡不住显式的 `git merge --no-ff`。",
    );
    continue;
  }

  const staged = await git(["ls-files", "-s", "--", hookPath]);
  const mode = staged.stdout.split(" ")[0];

  // 文件还没进版本库时 ls-files 没有输出，此时无从检查，交给提交时把关。
  if (mode && mode !== "100755") {
    warnings.push(
      `${hookPath} 在 git 索引里的模式是 ${mode}，不是 100755。` +
        "Unix 上不可执行的钩子会被静默忽略。修法：" +
        `git update-index --chmod=+x ${hookPath}`,
    );
  }
}

if (applied.length > 0) {
  console.log(`[setup] 已启用线性历史强制：\n  ${applied.join("\n  ")}`);
}

if (warnings.length > 0) {
  console.error(
    `\n[setup] ⚠ 线性历史的强制层没有完全就位：\n  ${warnings.join("\n  ")}\n`,
  );
}
