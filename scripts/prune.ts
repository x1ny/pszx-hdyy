import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { DEV_DB_LABEL, DEV_DB_ROOT_LABEL } from "./dev-db";

// 回收多 worktree 并行开发攒下来的垃圾：一次性数据库容器、被 worktree 抛弃的
// compose 容器和卷、已经合进 master 的本地分支。
//
// **默认只列不删，且只自动删能证明属于本仓库的东西。**
//
// 这里删的是数据库卷，不可逆。早先的版本按「所有 postgres: 镜像的非 canonical
// compose 容器」和「所有 _postgres_data 结尾的卷」筛选 —— 那个候选集的定义
// 是一个通用命名模式，不是仓库归属：同机上任何别的项目只要用 postgres 和常见
// 的 postgres_data 卷名，就会被卷进来。现在改成：证明得了归属的才自动删，
// 证明不了的只列出来交给人判断。

const CANONICAL_COMPOSE_PROJECT = "pszx-hdyy";
const repoRoot = resolve(import.meta.dir, "..");
const apply = process.argv.includes("--yes");

async function run(command: string[], cwd = repoRoot) {
  const proc = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

const lines = (value: string) => value.split("\n").filter(Boolean);
const normalize = (path: string) =>
  resolve(path).replaceAll("\\", "/").toLowerCase();

/** 本仓库当前所有 worktree 的绝对路径。这是「归属本仓库」唯一可靠的凭据。 */
async function worktreePaths() {
  const listed = await run(["git", "worktree", "list", "--porcelain"]);

  return lines(listed.stdout)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => normalize(line.slice("worktree ".length)));
}

type Candidate = { name: string; why: string };
type Buckets = { remove: Candidate[]; manual: Candidate[]; keep: Candidate[] };

async function collectContainers(worktrees: string[]): Promise<Buckets> {
  const buckets: Buckets = { remove: [], manual: [], keep: [] };

  // 1) 我们自己建的一次性库：label 是我们写的，归属没有疑问。
  const ours = await run([
    "docker",
    "ps",
    "-a",
    "--filter",
    `label=${DEV_DB_LABEL}`,
    "--format",
    `{{.Names}}\t{{.Label "${DEV_DB_ROOT_LABEL}"}}\t{{.State}}`,
  ]);

  for (const line of lines(ours.stdout)) {
    const [name, root, state] = line.split("\t");
    if (!name) continue;

    if (!root) {
      buckets.manual.push({
        name,
        why: "旧版本留下的临时库，没有记 worktree 路径",
      });
    } else if (!existsSync(root)) {
      buckets.remove.push({ name, why: `所属 worktree 已删除（${root}）` });
    } else {
      // 目录还在 = 可能有人正在用。别人正跑着 dev 时把库删掉，是这个脚本
      // 能造成的最恶心的事；何况下次那个 worktree 起 dev 会自己顶掉同名容器。
      buckets.keep.push({
        name,
        why: `worktree 仍存在（${root}）${state === "running" ? "，且容器在运行" : ""}`,
      });
    }
  }

  // 2) compose 建的 postgres：只认 working_dir 指向本仓库某个 worktree 的。
  const composed = await run([
    "docker",
    "ps",
    "-a",
    "--filter",
    "label=com.docker.compose.project",
    "--format",
    `{{.Names}}\t{{.Label "com.docker.compose.project"}}\t{{.Image}}\t{{.Label "com.docker.compose.project.working_dir"}}`,
  ]);

  for (const line of lines(composed.stdout)) {
    const [name, project, image, workingDir] = line.split("\t");
    if (!name || !image?.startsWith("postgres:")) continue;
    if (project === CANONICAL_COMPOSE_PROJECT) {
      buckets.keep.push({ name, why: "本仓库当前的持久库" });
      continue;
    }

    if (workingDir && worktrees.includes(normalize(workingDir))) {
      buckets.remove.push({
        name,
        why: `本仓库 worktree 的遗留 compose 容器（project=${project}）`,
      });
    } else {
      buckets.manual.push({
        name,
        why: `无法证明属于本仓库（project=${project}，working_dir=${workingDir || "未知"}）`,
      });
    }
  }

  return buckets;
}

async function collectVolumes(worktrees: string[]): Promise<Buckets> {
  const buckets: Buckets = { remove: [], manual: [], keep: [] };
  const all = await run(["docker", "volume", "ls", "--format", "{{.Name}}"]);

  // compose 的卷名是 `<project>_<卷名>`，而 project 早先是按目录名派生的。
  // 所以「project 前缀 ∈ 本仓库 worktree 的目录名」就是可用的归属凭据。
  const ownedPrefixes = new Set([
    ...worktrees.map((path) => basename(path)),
    // 仓库早先的默认 project 名（package.json 的 name）。
    "fullstack-template",
  ]);

  for (const name of lines(all.stdout)) {
    if (!name.endsWith("_postgres_data")) continue;

    if (name === `${CANONICAL_COMPOSE_PROJECT}_postgres_data`) {
      buckets.keep.push({ name, why: "本仓库持久库的数据卷" });
      continue;
    }

    const prefix = name.slice(0, -"_postgres_data".length);
    if (ownedPrefixes.has(prefix)) {
      buckets.remove.push({
        name,
        why: `本仓库 worktree 的遗留卷（${prefix}）`,
      });
    } else {
      buckets.manual.push({
        name,
        why: `前缀 "${prefix}" 不对应本仓库任何 worktree，可能属于别的项目`,
      });
    }
  }

  return buckets;
}

async function collectMergedBranches() {
  // 带上 worktreepath：被其他 worktree 检出的分支删不掉，列出来只是噪音。
  const merged = await run([
    "git",
    "branch",
    "--merged",
    "master",
    "--format",
    "%(refname:short)%09%(worktreepath)",
  ]);

  return lines(merged.stdout)
    .map((line) => line.split("\t"))
    .filter(([name, worktreePath]) => name !== "master" && !worktreePath)
    .map(([name]) => ({ name: name as string, why: "已合入 master" }));
}

const worktrees = await worktreePaths();
const containers = await collectContainers(worktrees);
const volumes = await collectVolumes(worktrees);
const branches = await collectMergedBranches();

function report(title: string, items: Candidate[]) {
  if (items.length === 0) return;
  console.log(`\n${title}（${items.length}）`);
  for (const item of items) {
    console.log(`  ${item.name}\n      ${item.why}`);
  }
}

console.log(`本仓库 worktree 共 ${worktrees.length} 个，归属判定以它们为准。`);

report("将删除：容器", containers.remove);
report("将删除：数据库卷", volumes.remove);
report("将删除：分支", branches);
report("⚠ 需要你自己确认（不会自动删）", [
  ...containers.manual,
  ...volumes.manual,
]);
report("保留（正在使用或属于持久库）", [...containers.keep, ...volumes.keep]);

const willRemove =
  containers.remove.length + volumes.remove.length + branches.length;

if (!apply) {
  console.log(
    `\n以上只是清单，没有删除任何东西。确认无误后加 --yes 执行（将删除 ${willRemove} 项）：\n  bun run prune --yes\n`,
  );
  process.exit(0);
}

for (const { name } of containers.remove) {
  const result = await run(["docker", "rm", "-f", name]);
  console.log(`  ${result.exitCode === 0 ? "已删除容器" : "跳过容器"} ${name}`);
}

for (const { name } of volumes.remove) {
  // 还在被容器引用的卷会删除失败，这是我们要的：那说明它不是垃圾。
  const result = await run(["docker", "volume", "rm", name]);
  console.log(
    `  ${result.exitCode === 0 ? "已删除卷" : "跳过卷（仍在使用）"} ${name}`,
  );
}

for (const { name } of branches) {
  // -d（不是 -D）：删不掉的就是还有没合进 master 的提交，那正是不该删的。
  const result = await run(["git", "branch", "-d", name]);
  console.log(
    `  ${result.exitCode === 0 ? "已删除分支" : "保留分支（还有未合入的提交）"} ${name}`,
  );
}
