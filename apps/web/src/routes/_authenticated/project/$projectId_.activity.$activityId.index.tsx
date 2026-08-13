import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { activityDetailQueryOptions } from "./-queries";
import { formatBudget } from "./-utils";

export const Route = createFileRoute(
  "/_authenticated/project/$projectId_/activity/$activityId/",
)({
  component: ActivityOverviewTab,
});

function ActivityOverviewTab() {
  const { activityId: activityIdParam } = Route.useParams();
  const activityId = Number(activityIdParam);

  // 父路由（活动详情布局）的 loader 已经把这条数据 ensureQueryData 过，
  // 这里拿到的是缓存命中，不会再发一次请求。
  const { data: activity } = useQuery(activityDetailQueryOptions(activityId));

  if (!activity) return null;

  return (
    <div className="rounded-lg border bg-card p-5 shadow-sm">
      <h2 className="mb-4 font-medium text-sm">活动基础信息</h2>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-4">
        <InfoRow label="主办单位">{activity.hostOrg || "-"}</InfoRow>
        <InfoRow label="承办单位">{activity.organizerOrg || "-"}</InfoRow>
        <InfoRow label="支持单位">{activity.supportOrg || "-"}</InfoRow>
        <InfoRow label="指导单位">{activity.guidingOrg || "-"}</InfoRow>
        <InfoRow label="总预算">{formatBudget(activity.totalBudget)}</InfoRow>
      </dl>
      {activity.description && (
        <p className="mt-4 whitespace-pre-wrap text-muted-foreground text-sm leading-relaxed">
          {activity.description}
        </p>
      )}
    </div>
  );
}

function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="truncate">{children}</dd>
    </div>
  );
}
