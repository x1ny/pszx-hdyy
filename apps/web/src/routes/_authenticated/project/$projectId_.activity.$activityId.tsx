import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  CalendarClockIcon,
  ClipboardListIcon,
  LayoutGridIcon,
  MailIcon,
  PackageIcon,
  type LucideIcon,
  UsersRoundIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "#/shared/components/ui/badge.tsx";
import { Button, buttonVariants } from "#/shared/components/ui/button.tsx";
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
  formatBudget,
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
  component: ActivityDetailPage,
});

/** 六个子模块目前全部只有占位页，见 -components/activity-subpage-placeholder.tsx。 */
const SUB_MODULES: Array<{
  to:
    | "/project/$projectId/activity/$activityId/config"
    | "/project/$projectId/activity/$activityId/agenda"
    | "/project/$projectId/activity/$activityId/resources"
    | "/project/$projectId/activity/$activityId/members"
    | "/project/$projectId/activity/$activityId/invitations"
    | "/project/$projectId/activity/$activityId/seating";
  icon: LucideIcon;
  label: string;
  desc: string;
}> = [
  {
    to: "/project/$projectId/activity/$activityId/config",
    icon: LayoutGridIcon,
    label: "配置中心",
    desc: "配置项完成情况总览",
  },
  {
    to: "/project/$projectId/activity/$activityId/agenda",
    icon: CalendarClockIcon,
    label: "议程 / 环节",
    desc: "按时间自动生成串并行",
  },
  {
    to: "/project/$projectId/activity/$activityId/resources",
    icon: PackageIcon,
    label: "资源需求",
    desc: "用车 / 用餐 / 住宿 / 物料",
  },
  {
    to: "/project/$projectId/activity/$activityId/members",
    icon: UsersRoundIcon,
    label: "活动人员",
    desc: "来源 / 分组 / 负责人",
  },
  {
    to: "/project/$projectId/activity/$activityId/invitations",
    icon: MailIcon,
    label: "邀请函",
    desc: "生成、下载、提醒记录",
  },
  {
    to: "/project/$projectId/activity/$activityId/seating",
    icon: ClipboardListIcon,
    label: "排位",
    desc: "场地库 + 排位方案",
  },
];

function ActivityDetailPage() {
  const { projectId: projectIdParam, activityId: activityIdParam } =
    Route.useParams();
  const projectId = Number(projectIdParam);
  const activityId = Number(activityIdParam);
  const queryClient = useQueryClient();

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
    <div className="flex flex-1 flex-col gap-6">
      <div>
        <Link
          to="/project/$projectId"
          params={{ projectId: projectIdParam }}
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "-ml-2 mb-2",
          )}
        >
          <ArrowLeftIcon />
          返回项目详情
        </Link>

        <div className="flex flex-col gap-4 rounded-lg border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <p className="text-muted-foreground text-xs">
                所属项目：{project?.name ?? "-"}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-semibold text-xl tracking-tight">
                  {activity.name}
                </h1>
                <Badge variant="outline">
                  {ACTIVITY_TYPE_LABELS[activity.activityType]}
                </Badge>
                <Badge
                  variant="outline"
                  className={cn(
                    "border",
                    PUBLISH_STATUS_CHIP[activity.publishStatus],
                  )}
                >
                  {PUBLISH_STATUS_LABELS[activity.publishStatus]}
                </Badge>
                <Badge variant="outline">
                  {activity.displayEnabled ? "H5 展示开启" : "H5 展示关闭"}
                </Badge>
                <Badge variant="outline">
                  {activity.registrationEnabled ? "报名开启" : "报名关闭"}
                </Badge>
              </div>
              <p className="text-muted-foreground text-sm">
                {activity.location || "未填写地点"} ·{" "}
                {formatDateTime(activity.startTime)} ~{" "}
                {formatDateTime(activity.endTime)}
              </p>
            </div>
            <Button variant="outline" onClick={() => setFormOpen(true)}>
              编辑活动信息
            </Button>
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
            <InfoRow label="主办单位">{activity.hostOrg || "-"}</InfoRow>
            <InfoRow label="承办单位">{activity.organizerOrg || "-"}</InfoRow>
            <InfoRow label="支持单位">{activity.supportOrg || "-"}</InfoRow>
            <InfoRow label="指导单位">{activity.guidingOrg || "-"}</InfoRow>
            <InfoRow label="总预算">{formatBudget(activity.totalBudget)}</InfoRow>
          </dl>

          {activity.description && (
            <p className="whitespace-pre-wrap text-muted-foreground text-sm leading-relaxed">
              {activity.description}
            </p>
          )}
        </div>
      </div>

      <div>
        <h2 className="mb-3 font-semibold text-lg tracking-tight">子模块</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {SUB_MODULES.map((module) => (
            <Link
              key={module.to}
              to={module.to}
              params={{ projectId: projectIdParam, activityId: activityIdParam }}
              className="flex items-center gap-3 rounded-lg border bg-card p-4 shadow-sm transition-colors hover:bg-muted/50"
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <module.icon className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm">{module.label}</div>
                <p className="truncate text-muted-foreground text-xs">
                  {module.desc}
                </p>
              </div>
              <span className="shrink-0 text-muted-foreground text-xs">
                未建设
              </span>
            </Link>
          ))}
        </div>
      </div>

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
