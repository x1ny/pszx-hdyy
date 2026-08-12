import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "#/shared/lib/api";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const { user } = Route.useRouteContext();
  const { data } = useQuery({
    queryKey: ["server-info"],
    queryFn: async () => {
      const res = await api.api.getServerInfo.$post();
      const result = await res.json();
      if (result.code !== "OK") throw new Error(result.message);
      return result.data;
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">工作台</h1>
      <p className="text-sm text-muted-foreground">
        Server runtime: {data?.runtime ?? "…"} · {data?.time ?? "…"}
      </p>
      <p className="text-sm">
        已登录: {user.name} ({user.email})
      </p>
    </div>
  );
}
