import { createServer } from "node:net";
import { networkInterfaces } from "node:os";

const MAX_PORT = 65535;
const PORT_UNAVAILABLE_ERRORS = new Set(["EACCES", "EADDRINUSE"]);

function getPortProbeHosts() {
  const hosts = new Set(["127.0.0.1", "::1"]);

  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      hosts.add(address.address);
    }
  }

  return [...hosts];
}

const PORT_PROBE_HOSTS = getPortProbeHosts();

export function readPort(name: string, fallback: number) {
  const raw = process.env[name] ?? String(fallback);
  const port = Number(raw);

  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
    throw new Error(
      `${name} must be an integer between 1 and ${MAX_PORT}, got "${raw}"`,
    );
  }

  return port;
}

function isPortAvailableOnHost(port: number, host: string) {
  return new Promise<boolean>((resolveAvailability) => {
    const probe = createServer();

    probe.once("error", (error: NodeJS.ErrnoException) => {
      // A network address can disappear between enumeration and probing, and
      // IPv6 may be disabled. Only port conflicts/reservations make this
      // candidate unavailable; unsupported addresses are skipped.
      resolveAvailability(!PORT_UNAVAILABLE_ERRORS.has(error.code ?? ""));
    });
    probe.listen({ host, port }, () => {
      probe.close(() => resolveAvailability(true));
    });
  });
}

async function isPortAvailable(port: number) {
  for (const host of PORT_PROBE_HOSTS) {
    if (!(await isPortAvailableOnHost(port, host))) {
      return false;
    }
  }

  return true;
}

export async function findAvailablePort(
  requestedPort: number,
  reservedPorts: ReadonlySet<number> = new Set(),
) {
  for (let port = requestedPort; port <= MAX_PORT; port += 1) {
    if (!reservedPorts.has(port) && (await isPortAvailable(port))) {
      return port;
    }
  }

  throw new Error(
    `No available port found from ${requestedPort} to ${MAX_PORT}`,
  );
}
