import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { api } from "#/lib/api";
import { authClient } from "#/lib/auth-client";
import { sessionQueryKey } from "#/lib/session";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
    <div className="p-8">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <p className="mt-4 text-sm text-gray-500">
        Server runtime: {data?.runtime ?? "…"} · {data?.time ?? "…"}
      </p>

      <div className="mt-6 flex items-center gap-3 rounded border p-4">
        <span>
          已登录: {user.name} ({user.email})
        </span>
        <button
          type="button"
          className="rounded bg-black px-3 py-1 text-sm text-white"
          onClick={() =>
            authClient.signOut({
              fetchOptions: {
                onSuccess: () => {
                  queryClient.removeQueries({ queryKey: sessionQueryKey });
                  navigate({ to: "/login" });
                },
              },
            })
          }
        >
          登出
        </button>
      </div>
    </div>
  );
}
