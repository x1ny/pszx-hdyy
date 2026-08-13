import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CalendarClockIcon,
  ClipboardListIcon,
  LayoutGridIcon,
  type LucideIcon,
  MailIcon,
  PackageIcon,
  UsersRoundIcon,
} from "lucide-react";
import { activityDetailQueryOptions } from "./-queries";
import { formatBudget } from "./-utils";

export const Route = createFileRoute(
  "/_authenticated/project/$projectId_/activity/$activityId/",
)({
  component: ActivityOverviewTab,
});

/**
 * 只挑六个最常用的子模块做首屏快捷入口，不是全部十个标签页——跟标签栏
 * 数量不一致是故意的，这里是"常用入口"，标签栏才是完整的信息架构。
 * 数字先都是"未建设"：这几个模块本来就还没有数据源，展示假数字比不展示
 * 更容易误导人。
 */
const QUICK_ENTRIES: Array<{
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

function ActivityOverviewTab() {
  const { projectId: projectIdParam, activityId: activityIdParam } =
    Route.useParams();
  const activityId = Number(activityIdParam);

  // 父路由（活动详情布局）的 loader 已经把这条数据 ensureQueryData 过，
  // 这里拿到的是缓存命中，不会再发一次请求。
  const { data: activity } = useQuery(activityDetailQueryOptions(activityId));

  if (!activity) return null;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {QUICK_ENTRIES.map((entry) => (
          <Link
            key={entry.to}
            to={entry.to}
            params={{ projectId: projectIdParam, activityId: activityIdParam }}
            className="flex items-center gap-3 rounded-lg border bg-card p-4 shadow-sm transition-colors hover:bg-muted/50"
          >
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <entry.icon className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-medium text-sm">{entry.label}</div>
              <p className="truncate text-muted-foreground text-xs">
                {entry.desc}
              </p>
            </div>
            <span className="shrink-0 text-muted-foreground text-xs">
              未建设
            </span>
          </Link>
        ))}
      </div>

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
