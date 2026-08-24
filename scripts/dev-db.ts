import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";

// 一次性开发数据库：容器 + tmpfs，`bun run dev` 退出即销毁。
//
// 数据目录挂 tmpfs（内存）而不是 volume，是为了让「不持久化」成为物理事实
// 而不是一段需要正确执行的清理逻辑 —— 这个仓库之前正是靠 docker-compose 的
// 具名 volume，攒出过 4 个僵尸容器和 5 个没人引用的卷。
export const DEV_DB_IMAGE = "postgres:16-alpine";
export const DEV_DB_LABEL = "pszx-dev-db";

/** 容器上记的 worktree 路径，用来判断它是不是已经没人要了。 */
export const DEV_DB_ROOT_LABEL = "pszx-dev-db.root";

const DB_USER = "postgres";
const DB_PASSWORD = "postgres";
const DB_NAME = "app_dev";

const READY_TIMEOUT_MS = 60_000;
const READY_POLL_INTERVAL_MS = 100;

/**
 * 容器名 = 可读前缀 + worktree 绝对路径的哈希。
 *
 * **不能只用 basename**：Codex 的 worktree 长成
 * `C:/Users/.../.codex/worktrees/<hash>/pszx-hdyy`，叶目录全都是 `pszx-hdyy`，
 * 和主仓库 `E:/workspace/pszx-hdyy` 一模一样。只取 basename 的话，8 个工作区
 * 会算出同一个容器名，而启动第一步就是 `docker rm -f 该名字` —— 任何一个
 * Codex worktree 起 dev，都会把另一个正在跑的 worktree 的数据库杀掉，
 * 直接违背「每个 worktree 一个库」这个首要目标。
 *
 * 路径先规范化再哈希：Windows 路径大小写不敏感、分隔符两种写法都合法，
 * 不归一化的话同一个 worktree 可能算出两个名字。
 */
export function containerNameFor(repoRoot: string) {
  const normalized = resolve(repoRoot).replaceAll("\\", "/").toLowerCase();
  const digest = createHash("sha1")
    .update(normalized)
    .digest("hex")
    .slice(0, 10);
  const slug = basename(normalized)
    .replace(/[^a-z0-9_.-]/g, "-")
    .slice(0, 24);

  return `${DEV_DB_LABEL}-${slug}-${digest}`;
}

async function docker(args: string[]) {
  const proc = Bun.spawn(["docker", ...args], {
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

async function assertDockerRunning() {
  const { exitCode, stderr } = await docker(["info", "--format", "{{.ID}}"]);

  if (exitCode !== 0) {
    throw new Error(
      [
        "Docker 没有响应，临时开发数据库起不来。",
        "  · 确认 Docker Desktop 已启动",
        "  · 想连你本地那个持久库，改用 `bun run dev:persist`",
        stderr && `  · docker 原始报错：${stderr}`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
}

/**
 * 回收「所属 worktree 已经不存在」的临时库容器。
 *
 * `--rm` 只在容器正常停止时生效，而 dev 被硬杀（任务管理器、编辑器直接关掉
 * 终端、断电）时信号处理器根本没机会跑。这个仓库的 worktree 又是 coding agent
 * 建了删、删了建，光靠「同名顶掉」回收不到那些**目录已经没了**的容器。
 */
async function reapAbandonedContainers() {
  const listed = await docker([
    "ps",
    "-a",
    "--filter",
    `label=${DEV_DB_LABEL}`,
    "--format",
    `{{.Names}}\t{{.Label "${DEV_DB_ROOT_LABEL}"}}`,
  ]);

  for (const line of listed.stdout.split("\n").filter(Boolean)) {
    const [name, root] = line.split("\t");

    // 没有 root label 的是旧版本留下的，交给 `bun run prune` 处理，不擅自删。
    if (!name || !root || existsSync(root)) {
      continue;
    }

    await docker(["rm", "-f", name]);
    console.log(`[dev] 回收了已删除 worktree 的临时库容器 ${name}`);
  }
}

/** 容器内用 TCP 探活，不用 unix socket。postgres 官方镜像初始化期间会先起一个
 *  只监听 unix socket 的临时实例，走 socket 探活会在初始化没完成时就报 ready。 */
async function waitUntilReady(containerName: string) {
  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const { exitCode } = await docker([
      "exec",
      containerName,
      "pg_isready",
      "-h",
      "127.0.0.1",
      "-p",
      "5432",
      "-U",
      DB_USER,
      "-d",
      DB_NAME,
    ]);

    if (exitCode === 0) {
      return;
    }

    await Bun.sleep(READY_POLL_INTERVAL_MS);
  }

  const { stdout: logs } = await docker([
    "logs",
    "--tail",
    "30",
    containerName,
  ]);
  throw new Error(
    `临时数据库 ${READY_TIMEOUT_MS / 1000}s 内没有就绪。容器日志：\n${logs}`,
  );
}

/** 从 `docker port` 读回宿主机端口。形如 `127.0.0.1:55432`，也可能多行。 */
async function resolveHostPort(containerName: string) {
  const { stdout, stderr, exitCode } = await docker([
    "port",
    containerName,
    "5432/tcp",
  ]);

  if (exitCode !== 0) {
    throw new Error(`读不到临时数据库的映射端口：${stderr || stdout}`);
  }

  const port = Number(stdout.split("\n")[0]?.trim().split(":").pop());
  if (!Number.isInteger(port) || port < 1) {
    throw new Error(`临时数据库的映射端口解析失败：${JSON.stringify(stdout)}`);
  }

  return port;
}

export type EphemeralDatabase = {
  url: string;
  port: number;
  containerName: string;
  stop: () => Promise<void>;
};

export async function startEphemeralPostgres(
  repoRoot: string,
): Promise<EphemeralDatabase> {
  await assertDockerRunning();
  await reapAbandonedContainers();

  const containerName = containerNameFor(repoRoot);
  // 同名残留先顶掉：上一次 dev 被强杀时 --rm 不会生效。
  await docker(["rm", "-f", containerName]);

  const started = Date.now();
  const run = await docker([
    "run",
    "-d",
    "--rm",
    "--name",
    containerName,
    "--label",
    `${DEV_DB_LABEL}=1`,
    "--label",
    `${DEV_DB_ROOT_LABEL}=${resolve(repoRoot)}`,
    "-e",
    `POSTGRES_USER=${DB_USER}`,
    "-e",
    `POSTGRES_PASSWORD=${DB_PASSWORD}`,
    "-e",
    `POSTGRES_DB=${DB_NAME}`,
    // 端口交给 Docker 分配，只绑回环。自己探测再让 docker 去绑是有竞争的：
    // 探测 socket 关闭到 `docker run` 真正绑定之间有窗口，两个 worktree 同时
    // 启动可能选中同一个端口，其中一个直接起不来。
    "-p",
    "127.0.0.1::5432",
    "--tmpfs",
    "/var/lib/postgresql/data:rw,size=512m",
    DEV_DB_IMAGE,
  ]);

  if (run.exitCode !== 0) {
    throw new Error(`临时数据库启动失败：${run.stderr || run.stdout}`);
  }

  // 容器已经建出来了，从这里往后任何失败都必须把它带走，否则就是泄漏。
  try {
    await waitUntilReady(containerName);
    const port = await resolveHostPort(containerName);

    console.log(
      `[dev] 临时数据库就绪（${containerName} :${port}，${Date.now() - started}ms）`,
    );

    return {
      url: `postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${port}/${DB_NAME}`,
      port,
      containerName,
      stop: async () => {
        await docker(["rm", "-f", containerName]);
      },
    };
  } catch (error) {
    await docker(["rm", "-f", containerName]);
    throw error;
  }
}

/**
 * 停掉本 worktree 的临时库（如果还在）。
 *
 * `dev:persist` 启动时调用：临时库是 `docker run -d` 分离启动的，dev 被硬杀
 * 之后它照样活着。不停掉的话，应用连持久库、而 `db:studio` 顺着残留的
 * `.dev-db.env` 连到那个还活着的临时库，两边都不报错 —— 正是这次改造要
 * 消灭的「静默看错库」。
 */
export async function stopEphemeralFor(repoRoot: string) {
  const containerName = containerNameFor(repoRoot);
  const running = await docker([
    "ps",
    "-aq",
    "--filter",
    `name=^${containerName}$`,
  ]);

  if (!running.stdout) {
    return false;
  }

  await docker(["rm", "-f", containerName]);
  return true;
}
