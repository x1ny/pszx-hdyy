import { useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  Outlet,
  retainSearchParams,
  useMatchRoute,
} from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import { z } from "zod";
import { activityDetailQueryOptions } from "#/features/project/queries";
import {
  ACTIVITY_TYPE_LABELS,
  formatDateTime,
  PUBLISH_STATUS_CHIP,
  PUBLISH_STATUS_LABELS,
} from "#/features/project/utils";
import { Badge } from "#/shared/components/ui/badge.tsx";
import { buttonVariants } from "#/shared/components/ui/button.tsx";
import { Skeleton } from "#/shared/components/ui/skeleton.tsx";
import { cn } from "#/shared/lib/utils.ts";

/**
 * 活动详情有两个入口：项目详情页的「活动列表」标签页，和一级菜单「活动管理」。
 * URL 只有一条（活动永远挂在项目下），所以"从哪来"没法从路径读出来，用一个
 * search param 带着走——刷新、收藏、把链接发给别人都还原得回来，比读
 * history.state 或者猜 referrer 靠谱。
 *
 * 注意这是 URL 上的 `?from=`，不是 `<Link>` 那个用于相对导航的 `from` 属性，
 * 两者同名但没关系。
 *
 * 缺省（项目详情那个入口不传）就是回项目详情，保持原来的行为。
 */
const ActivityDetailSearchSchema = z.object({
  from: z.literal("activity").optional().catch(undefined),
});

export const Route = createFileRoute(
  "/_authenticated/project/$projectId_/activity/$activityId",
)({
  validateSearch: ActivityDetailSearchSchema,
  // 标签页之间跳转时把 from 带上：人还在这个活动里，"返回"该去哪儿不该因为
  // 从「活动概览」切到「议程」就变了。各标签页自己的筛选参数不受影响。
  search: { middlewares: [retainSearchParams(["from"])] },
  loader: ({ context, params }) => {
    const activityId = Number(params.activityId);
    return context.queryClient.ensureQueryData(
      activityDetailQueryOptions(activityId),
    );
  },
  component: ActivityDetailLayout,
});

/**
 * 标签页承载活动下的全部子模块，URL 不会因为内容从占位换成真实现而改变。
 *
 * ⚠️ **报名审核暂时不挂在这里**，路由文件还留着。报名记录的唯一生产者是
 * H5 报名表单，而 H5 本期不建（见 AGENTS.md）——挂一个永远没有数据进来的
 * 标签，只会让人以为功能坏了。等 H5 或后台导入其中之一落地，把这一行加
 * 回来即可，不需要别的改动。
 */
const TABS = [
  { to: "/project/$projectId/activity/$activityId", label: "活动概览" },
  { to: "/project/$projectId/activity/$activityId/config", label: "配置总览" },
  {
    to: "/project/$projectId/activity/$activityId/agenda",
    label: "议程 / 环节",
  },
  { to: "/project/$projectId/activity/$activityId/venue", label: "场地空间" },
  {
    to: "/project/$projectId/activity/$activityId/resources",
    label: "资源需求",
  },
  {
    to: "/project/$projectId/activity/$activityId/resource-ledger",
    label: "资源台账",
  },
  { to: "/project/$projectId/activity/$activityId/members", label: "活动人员" },
  { to: "/project/$projectId/activity/$activityId/trip", label: "行程管理" },
  {
    to: "/project/$projectId/activity/$activityId/invitations",
    label: "邀请函",
  },
  { to: "/project/$projectId/activity/$activityId/seating", label: "排位" },
] as const;

/**
 * 业务状态：只表示时间进度，和发布状态是两件事（文档 §8.2 开发处理规则 1）。
 *
 * **没有对应的列，按当前时刻算**——它完全由起止时间决定，存一列就要有人在
 * 活动开始和结束的那一刻去改它，那需要定时任务；而定时任务挂了，状态就永久
 * 停在错的那一档。
 */
function businessStatus(start: string, end: string) {
  const now = Date.now();
  if (now < new Date(start).getTime()) {
    return {
      label: "未开始",
      chip: "border-border bg-muted text-muted-foreground",
    };
  }
  if (now > new Date(end).getTime()) {
    return {
      label: "已结束",
      chip: "border-border bg-muted text-muted-foreground",
    };
  }
  return {
    label: "进行中",
    chip: "border-success/30 bg-success/10 text-success-foreground",
  };
}

function ActivityDetailLayout() {
  const { projectId: projectIdParam, activityId: activityIdParam } =
    Route.useParams();
  const activityId = Number(activityIdParam);
  const { from } = Route.useSearch();
  const matchRoute = useMatchRoute();

  const activityQuery = useQuery(activityDetailQueryOptions(activityId));

  const activity = activityQuery.data;

  if (!activity) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      {from === "activity" ? (
        <Link
          to="/activity"
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "-ml-2 w-fit",
          )}
        >
          <ArrowLeftIcon data-icon="inline-start" />
          返回活动管理
        </Link>
      ) : (
        <Link
          to="/project/$projectId"
          params={{ projectId: projectIdParam }}
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "-ml-2 w-fit",
          )}
        >
          <ArrowLeftIcon data-icon="inline-start" />
          返回项目详情
        </Link>
      )}

      <div className="flex flex-wrap items-start gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-semibold text-xl tracking-tight">
              活动：{activity.name}
            </h1>
            <Badge
              variant="outline"
              className={cn(
                "border",
                PUBLISH_STATUS_CHIP[activity.publishStatus],
              )}
            >
              {PUBLISH_STATUS_LABELS[activity.publishStatus]}
            </Badge>
            {/* H5 展示开关和报名开关本期不展示：两个都只控制 H5 的行为，
                而 H5 不建（AGENTS.md）。字段和编辑表单都留着，等 H5 上马
                把这两个开关的芯片加回来即可（git 历史里有 ToggleTag 组件）。 */}
            <Badge
              variant="outline"
              className={cn(
                "border",
                businessStatus(activity.startTime, activity.endTime).chip,
              )}
            >
              {businessStatus(activity.startTime, activity.endTime).label}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            {activity.projectName} ·{" "}
            {ACTIVITY_TYPE_LABELS[activity.activityType]} ·{" "}
            {activity.location || "未填写地点"} ·{" "}
            {formatDateTime(activity.startTime)} 至{" "}
            {formatDateTime(activity.endTime)}
          </p>
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
              params={{
                projectId: projectIdParam,
                activityId: activityIdParam,
              }}
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
    </div>
  );
}
