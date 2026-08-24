import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { startEphemeralPostgres, stopEphemeralFor } from "./dev-db";
import { findAvailablePort, readPort } from "./ports";

// 开发环境的唯一入口，两条路径：
//
//   bun run dev            临时库：一次性 tmpfs 容器 + 建表 + 灌种子，退出即销毁
//   bun run dev:persist    持久库：docker-compose 那个容器，schema 和种子一概不碰
//
// 分成两条是因为多 worktree 并行开发时共用一个库会互相踩数据。默认走临时库，
// 需要看积累下来的真实数据时再显式用 dev:persist。

const DEFAULT_SERVER_PORT = 8787;
const DEFAULT_WEB_PORT = 3000;

// 后端只绑回环。Bun 不指定 hostname 时会绑到所有接口（实测局域网 IP 可达），
// 而开发环境挂着 /api/dev/login 这个免密入口 —— 不限制的话，同网段任何人
// 都能拿到一个真实 session。Vite 的 --host localhost 只保护前端端口，保护不了
// 后端端口。生产镜像不经过这个脚本，仍然绑所有接口。
const DEV_SERVER_HOST = "127.0.0.1";

const repoRoot = resolve(import.meta.dir, "..");
const usePersistentDb = process.argv.includes("--persist");
// 临时库端口每次都不同，写进这个文件让 db:studio / db:push 这些工具连得上
// 真正在跑的那个库。不写的话它们会按 .env 连到 localhost:5432（你的持久库），
// 而且不会有任何报错 —— 看到的是另一个库里的真实数据，结论必然是错的。
const runtimeEnvPath = resolve(repoRoot, "apps/server/.dev-db.env");

/** 新建的 worktree 里 .env 是不存在的（被 .gitignore 排除）。缺了就照
 *  .env.example 生成一份，顺手换掉那个占位密钥，省掉一次手工拷贝。 */
async function ensureDotEnv() {
  const envPath = resolve(repoRoot, ".env");

  if (existsSync(envPath)) {
    return envPath;
  }

  const examplePath = resolve(repoRoot, ".env.example");
  if (!existsSync(examplePath)) {
    throw new Error(".env 和 .env.example 都不存在，没法生成开发配置");
  }

  const secret = btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
  );
  const generated = (await Bun.file(examplePath).text()).replace(
    /^BETTER_AUTH_SECRET=.*$/m,
    `BETTER_AUTH_SECRET=${secret}`,
  );

  await Bun.write(envPath, generated);
  console.log("[dev] 没找到 .env，已按 .env.example 生成一份（密钥随机）");

  return envPath;
}

async function startPersistentDb() {
  // 先把本 worktree 的临时库痕迹清干净，否则数据库工具会连到它而不是持久库。
  await rm(runtimeEnvPath, { force: true });
  if (await stopEphemeralFor(repoRoot)) {
    console.log("[dev] 已停掉本 worktree 残留的临时库容器");
  }

  const proc = Bun.spawn(["docker", "compose", "up", "-d"], {
    cwd: repoRoot,
    stdout: "inherit",
    stderr: "inherit",
  });

  if ((await proc.exited) !== 0) {
    throw new Error("docker compose up -d 失败，持久库没起来");
  }
}

/** 建表 + 灌种子。放在子进程里跑，是为了让它的失败无法污染 dev 自身的状态，
 *  也让 DATABASE_URL 的注入路径和后面两个子进程完全一致。 */
async function bootstrapEphemeralDb(envPath: string, databaseUrl: string) {
  const proc = Bun.spawn(
    [
      process.execPath,
      `--env-file=${envPath}`,
      "run",
      "apps/server/src/dev-seed/bootstrap.ts",
    ],
    {
      cwd: repoRoot,
      // 进程环境变量压得过 --env-file，所以这里的 DATABASE_URL 会盖掉 .env 里那条。
      // EXPECTED_DATABASE_URL 让子进程自己复核一遍：这条注入路径一旦因为 bun 的
      // 行为变化而失效，失败方式会是「悄悄连到持久库并对它 push schema」，
      // 必须响亮地拦住。
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        EXPECTED_DATABASE_URL: databaseUrl,
      },
      stdout: "inherit",
      stderr: "inherit",
    },
  );

  if ((await proc.exited) !== 0) {
    // 种子失败就整体启动失败。在灌了一半的库上调试得出的结论全是错的，
    // 比启动失败难查十倍。
    throw new Error("建表或灌种子失败，dev 不启动");
  }
}

async function startAppProcesses(envPath: string, databaseUrl?: string) {
  const requestedServerPort = readPort("SERVER_PORT", DEFAULT_SERVER_PORT);
  const requestedWebPort = readPort("WEB_PORT", DEFAULT_WEB_PORT);
  const serverPort = await findAvailablePort(requestedServerPort);
  const webPort = await findAvailablePort(
    requestedWebPort,
    new Set([serverPort]),
  );
  const webOrigin = `http://localhost:${webPort}`;

  if (serverPort !== requestedServerPort) {
    console.log(
      `[dev] SERVER_PORT ${requestedServerPort} is occupied; using ${serverPort}`,
    );
  }

  if (webPort !== requestedWebPort) {
    console.log(
      `[dev] WEB_PORT ${requestedWebPort} is occupied; using ${webPort}`,
    );
  }

  const childEnv = {
    ...process.env,
    SERVER_PORT: String(serverPort),
    SERVER_HOST: DEV_SERVER_HOST,
    WEB_PORT: String(webPort),
    WEB_ORIGIN: webOrigin,
    BETTER_AUTH_URL: webOrigin,
    // 免密登录入口的两道闸（modules/auth/routes.dev.ts）：APP_ENV 是白名单，
    // 只有这个 dev runner 会设；DEV_AUTH_BYPASS 是开关。两者缺一入口就不存在，
    // 而 DEV_AUTH_BYPASS=1 出现在非 development 形态里会直接拒绝启动。
    APP_ENV: "development",
    DEV_AUTH_BYPASS: "1",
    ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
  };

  const serverProcess = Bun.spawn(
    [process.execPath, `--env-file=${envPath}`, "--hot", "run", "src/index.ts"],
    {
      cwd: resolve(repoRoot, "apps/server"),
      env: childEnv,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  );

  // Do not add `--bun` here. On Windows, Bun may bind IPv4 localhost even when
  // the same port is already listening on IPv6 localhost. Respecting Vite's Node
  // shebang keeps its own automatic port fallback consistent with this probe.
  const webProcess = Bun.spawn(
    [
      process.execPath,
      "vite",
      "dev",
      "--host",
      "localhost",
      "--port",
      String(webPort),
      "--strictPort",
    ],
    {
      cwd: resolve(repoRoot, "apps/web"),
      env: childEnv,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  );

  // 两条路径都挂着免密入口，所以两条都要提示。持久库里未必有种子账号，
  // 那种情况下这个入口会返回一段说明为什么失败的文案，而不是静默 404。
  console.log(
    `[dev] 前端 ${webOrigin}，免密登录 ${webOrigin}/api/dev/login`,
  );

  return [serverProcess, webProcess];
}

const envPath = await ensureDotEnv();
let databaseUrl: string | undefined;
let stopDatabase: (() => Promise<void>) | undefined;

if (usePersistentDb) {
  await startPersistentDb();
  console.log("[dev] 使用持久库（docker-compose），不建表也不灌种子");
} else {
  const database = await startEphemeralPostgres(repoRoot);
  databaseUrl = database.url;
  stopDatabase = database.stop;
}

let exitCode = 0;

// 从临时库创建成功那一刻起，后面每一步失败都必须把容器和运行时文件带走。
// 没有这层 finally 的话，建表失败、种子失败、端口耗尽、子进程起不来，
// 都会留下一个孤儿容器，外加一份指向它的 .dev-db.env。
try {
  if (databaseUrl) {
    await Bun.write(runtimeEnvPath, `DATABASE_URL=${databaseUrl}\n`);
    await bootstrapEphemeralDb(envPath, databaseUrl);
  }

  const children = await startAppProcesses(envPath, databaseUrl);
  let shuttingDown = false;

  const stopChildren = () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    for (const child of children) {
      child.kill();
    }
  };

  process.on("SIGINT", stopChildren);
  process.on("SIGTERM", stopChildren);

  const firstExit = await Promise.race(
    children.map(async (child, index) => ({
      code: await child.exited,
      index,
    })),
  );

  stopChildren();
  await Promise.all(children.map((child) => child.exited));
  console.error(
    `[dev] process ${firstExit.index} exited with code ${firstExit.code}`,
  );
  exitCode = firstExit.code;
} finally {
  await rm(runtimeEnvPath, { force: true });
  await stopDatabase?.();
}

process.exit(exitCode);
