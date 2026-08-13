import { createServer } from "node:net";
import { resolve } from "node:path";

const DEFAULT_SERVER_PORT = 8787;
const DEFAULT_WEB_PORT = 3000;
const MAX_PORT = 65535;

function readPort(name: string, fallback: number) {
  const raw = process.env[name] ?? String(fallback);
  const port = Number(raw);

  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
    throw new Error(
      `${name} must be an integer between 1 and ${MAX_PORT}, got "${raw}"`,
    );
  }

  return port;
}

function isPortAvailable(port: number) {
  return new Promise<boolean>((resolveAvailability) => {
    const probe = createServer();

    probe.once("error", () => resolveAvailability(false));
    probe.listen({ host: "127.0.0.1", port }, () => {
      probe.close(() => resolveAvailability(true));
    });
  });
}

async function findAvailablePort(
  requestedPort: number,
  reservedPorts: ReadonlySet<number> = new Set(),
) {
  for (let port = requestedPort; port <= MAX_PORT; port += 1) {
    if (!reservedPorts.has(port) && (await isPortAvailable(port))) {
      return port;
    }
  }

  throw new Error(`No available port found from ${requestedPort} to ${MAX_PORT}`);
}

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
  WEB_PORT: String(webPort),
  WEB_ORIGIN: webOrigin,
  BETTER_AUTH_URL: webOrigin,
};
const serverCwd = resolve("apps/server");
const webCwd = resolve("apps/web");

const serverProcess = Bun.spawn(
  [
    process.execPath,
    "--env-file=../../.env",
    "--hot",
    "run",
    "src/index.ts",
  ],
  {
    cwd: serverCwd,
    env: childEnv,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  },
);

const webProcess = Bun.spawn(
  [
    process.execPath,
    "--bun",
    "vite",
    "dev",
    "--host",
    "localhost",
    "--port",
    String(webPort),
    "--strictPort",
  ],
  {
    cwd: webCwd,
    env: childEnv,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  },
);

const children = [serverProcess, webProcess];
let shuttingDown = false;

function stopChildren() {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  for (const child of children) {
    child.kill();
  }
}

process.on("SIGINT", () => {
  stopChildren();
});
process.on("SIGTERM", () => {
  stopChildren();
});

const firstExit = await Promise.race(
  children.map(async (child, index) => ({
    code: await child.exited,
    index,
  })),
);

stopChildren();
await Promise.all(children.map((child) => child.exited));
console.error(`[dev] process ${firstExit.index} exited with code ${firstExit.code}`);
process.exit(firstExit.code);
