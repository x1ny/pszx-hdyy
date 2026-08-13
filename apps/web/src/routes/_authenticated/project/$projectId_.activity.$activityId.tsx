import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  Outlet,
  useMatchRoute,
} from "@tanstack/react-router";
import { toast } from "sonner";
import { useState } from "react";
import { Badge } from "#/shared/components/ui/badge.tsx";
import { Button } from "#/shared/components/ui/button.tsx";
import { Skeleton } from "#/shared/components/ui/skeleton.tsx";
import { cn } from "#/shared/lib/utils.ts";
import {
  ActivityFormDialog,
  type ActivityFormSubmitValues,
} from "./-components/activity-form-dialog";
import {
  activityDetailQueryOptions,
  activityKeys,
  projectDetailQueryOptions,
  updateActivity,
} from "./-queries";
import {
  ACTIVITY_TYPE_LABELS,
  formatDateTime,
  PUBLISH_STATUS_CHIP,
  PUBLISH_STATUS_LABELS,
} from "./-utils";

export const Route = createFileRoute(
  "/_authenticated/project/$projectId_/activity/$activityId",
)({
  loader: ({ context, params }) => {
    const projectId = Number(params.projectId);
    const activityId = Number(params.activityId);
    return Promise.all([
      context.queryClient.ensureQueryData(projectDetailQueryOptions(projectId)),
      context.queryClient.ensureQueryData(activityDetailQueryOptions(activityId)),
    ]);
  },
  component: ActivityDetailLayout,
});

/**
 * 十个标签页目前只有"活动概览"是真内容，其余九个都是占位页（见各自
 * 路由文件里的 PagePlaceholder）——先把信息架构和导航铺出来，内容
 * 逐个替换即可，标签页的 URL 不会因为内容从占位换成真实现实现而改变。
 */
const TABS = [
  { to: "/project/$projectId/activity/$activityId", label: "活动概览" },
  { to: "/project/$projectId/activity/$activityId/config", label: "配置总览" },
  { to: "/project/$projectId/activity/$activityId/agenda", label: "议程 / 环节" },
  { to: "/project/$projectId/activity/$activityId/venue", label: "场地空间" },
  { to: "/project/$projectId/activity/$activityId/resources", label: "资源需求" },
  {
    to: "/project/$projectId/activity/$activityId/resource-ledger",
    label: "资源台账",
  },
  { to: "/project/$projectId/activity/$activityId/members", label: "活动人员" },
  {
    to: "/project/$projectId/activity/$activityId/registration",
    label: "报名审核",
  },
  { to: "/project/$projectId/activity/$activityId/invitations", label: "邀请函" },
  { to: "/project/$projectId/activity/$activityId/seating", label: "排位" },
] as const;

function ActivityDetailLayout() {
  const { projectId: projectIdParam, activityId: activityIdParam } =
    Route.useParams();
  const projectId = Number(projectIdParam);
  const activityId = Number(activityIdParam);
  const queryClient = useQueryClient();
  const matchRoute = useMatchRoute();

  const [formOpen, setFormOpen] = useState(false);

  const projectQuery = useQuery(projectDetailQueryOptions(projectId));
  const activityQuery = useQuery(activityDetailQueryOptions(activityId));

  const project = projectQuery.data;
  const activity = activityQuery.data;

  const saveMutation = useMutation({
    mutationFn: (values: ActivityFormSubmitValues) =>
      updateActivity({ ...values, id: activityId }),
    onSuccess: () => {
      toast.success("修改成功");
      setFormOpen(false);
      queryClient.invalidateQueries({ queryKey: activityKeys.all });
    },
    onError: (error) => toast.error(error.message),
  });

  if (!activity) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <nav className="flex items-center gap-1.5 text-muted-foreground text-sm">
        <Link to="/project/list" className="hover:text-foreground hover:underline">
          项目管理
        </Link>
        <span>/</span>
        <Link
          to="/project/$projectId"
          params={{ projectId: projectIdParam }}
          className="hover:text-foreground hover:underline"
        >
          {project?.name ?? "-"}
        </Link>
        <span>/</span>
        <span>活动详情</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-semibold text-xl tracking-tight">
            活动：{activity.name}
          </h1>
          <p className="text-muted-foreground text-sm">
            {ACTIVITY_TYPE_LABELS[activity.activityType]} ·{" "}
            {activity.location || "未填写地点"} ·{" "}
            {formatDateTime(activity.startTime)} 至{" "}
            {formatDateTime(activity.endTime)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/project/$projectId"
            params={{ projectId: projectIdParam }}
            className="text-primary text-sm hover:underline"
          >
            返回项目详情
          </Link>
          <Button variant="outline" size="sm" onClick={() => setFormOpen(true)}>
            编辑活动
          </Button>
          <Badge
            variant="outline"
            className={cn("border", PUBLISH_STATUS_CHIP[activity.publishStatus])}
          >
            {PUBLISH_STATUS_LABELS[activity.publishStatus]}
          </Badge>
          <ToggleTag active={activity.displayEnabled} onLabel="H5 展示开启" offLabel="H5 展示关闭" />
          <ToggleTag active={activity.registrationEnabled} onLabel="报名开启" offLabel="报名关闭" />
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b">
        {TABS.map((tab) => {
          const isActive = !!matchRoute({
            to: tab.to,
            params: { projectId: projectIdParam, activityId: activityIdParam },
          });
          return (
            <Link
              key={tab.to}
              to={tab.to}
              params={{ projectId: projectIdParam, activityId: activityIdParam }}
              className={cn(
                "shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 font-medium text-sm transition-colors",
                isActive
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      <Outlet />

      <ActivityFormDialog
        open={formOpen}
        activity={activity}
        submitting={saveMutation.isPending}
        onOpenChange={setFormOpen}
        onSubmit={(values) => saveMutation.mutate(values)}
      />
    </div>
  );
}

function ToggleTag({
  active,
  onLabel,
  offLabel,
}: {
  active: boolean;
  onLabel: string;
  offLabel: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "border",
        active
          ? "border-success/30 bg-success/10 text-success-foreground"
          : "border-border bg-muted text-muted-foreground",
      )}
    >
      {active ? onLabel : offLabel}
    </Badge>
  );
}
