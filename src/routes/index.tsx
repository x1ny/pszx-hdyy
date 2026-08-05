import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

const getServerInfo = createServerFn({ method: "GET" }).handler(async () => ({
  runtime:
    typeof Bun !== "undefined"
      ? `Bun ${Bun.version}`
      : `Node ${process.version}`,
  time: new Date().toISOString(),
}));

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { data } = useQuery({
    queryKey: ["server-info"],
    queryFn: () => getServerInfo(),
  });

  return (
    <div className="p-8">
      <h1 className="text-4xl font-bold">Welcome to TanStack Start</h1>
      <p className="mt-4 text-lg">
        Edit <code>src/routes/index.tsx</code> to get started.
      </p>
      <p className="mt-4 text-sm text-gray-500">
        Server runtime: {data?.runtime ?? "…"} · {data?.time ?? "…"}
      </p>
    </div>
  );
}
