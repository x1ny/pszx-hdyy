import { useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  Outlet,
  retainSearchParams,
  useMatchRoute,
} from "@tanstack/react-router";
import {
  ArmchairIcon,
  ArrowLeftIcon,
  CalendarClockIcon,
  ClipboardListIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  MailIcon,
  MapPinIcon,
  PackageIcon,
  RouteIcon,
  UsersRoundIcon,
} from "lucide-react";
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
  // 子模块之间跳转时把 from 带上：人还在这个活动里，"返回"该去哪儿不该因为
  // 从「活动总览」切到「活动议程」就变了。各页面自己的筛选参数不受影响。
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
 * 侧边导航承载活动下的全部子模块，URL 不会因为内容从占位换成真实现而改变。
 *
 * ## 为什么是竖排分组，不是一行标签
 *
 * 原先是十个平级的横向标签。十个够不着溢出（1440 下大约 800px），但它们**不是
 * 同一种东西**：活动自身的档案、只读的体检表、六个作业台、一个对外产出，字号
 * 字重完全一样，每次进来都要线性扫一遍。竖排给了分组标题这个位置，"人员与安排"
 * 和"场地与座位"于是能自己说明白谁跟谁是一路的。
 *
 * 代价是横向少掉 ~11rem。**大画布编辑器不受影响**——排位画布和场地编辑器的路由
 * 用父动态参数尾 `_` 脱离了这个布局（见 AGENTS.md），它们本来就不在这条导航下面。
 * 受影响的是议程时间轴、资源和行程那几张宽表，它们各自的容器都已经 overflow-x
 * 滚动，横向变窄是滚动条早一点出现，不是布局塌掉。
 *
 * ⚠️ **报名审核暂时不挂在这里**，路由文件还留着。报名记录的唯一生产者是
 * H5 报名表单，而 H5 本期不建（见 AGENTS.md）——挂一个永远没有数据进来的
 * 入口，只会让人以为功能坏了。等 H5 或后台导入其中之一落地，把这一行加
 * 回来即可，不需要别的改动。
 *
 * ⚠️ **「活动总览」必须 exact，其余必须 fuzzy**。总览是索引路由，路径是活动
 * 详情本身，fuzzy 会让它在每一个子页面上都亮着；反过来其余项不给 fuzzy，
 * 进到环节详情（`agenda/$segmentId`）或邀请函生成页时整条导航会一个都不亮，
 * 用户看不出自己在哪儿——那正是改版前的行为。
 *
 * ## 每项都有图标，不是装饰
 *
 * 第一版是纯文字，九行同色同字号的中文，读起来是"一排杂乱的文字"——分组标题
 * 比条目还淡，反而不像标题。图标给每行一个可记忆的形状，扫描时不用逐字读；
 * 而且主侧边栏每一项都有图标，二级导航一个都没有本身就割裂。
 *
 * 图标**沿用各模块自己已经在用的那个**（排位页的 Armchair、资源需求页的
 * ClipboardList、资源台账页的 Package、议程空状态的 CalendarClock），人员和
 * 场地跟主侧边栏对齐（UsersRound / MapPin）。不另起一套，否则同一个模块在
 * 导航里和页面里是两个符号。
 */
const NAV_GROUPS = [
  {
    label: null,
    items: [
      {
        to: "/project/$projectId/activity/$activityId",
        label: "活动总览",
        icon: LayoutDashboardIcon,
        exact: true,
      },
    ],
  },
  {
    label: "议程管理",
    items: [
      {
        to: "/project/$projectId/activity/$activityId/agenda",
        label: "活动议程",
        icon: CalendarClockIcon,
        exact: false,
      },
    ],
  },
  {
    label: "人员管理",
    items: [
      {
        to: "/project/$projectId/activity/$activityId/members",
        label: "人员名单",
        icon: UsersRoundIcon,
        exact: false,
      },
      {
        to: "/project/$projectId/activity/$activityId/trip",
        label: "交通行程",
        icon: RouteIcon,
        exact: false,
      },
      {
        to: "/project/$projectId/activity/$activityId/invitations",
        label: "邀请函",
        icon: MailIcon,
        exact: false,
      },
    ],
  },
  {
    label: "场地与座位",
    items: [
      {
        to: "/project/$projectId/activity/$activityId/venue",
        label: "活动场地",
        icon: MapPinIcon,
        exact: false,
      },
      {
        to: "/project/$projectId/activity/$activityId/seating",
        label: "座位安排",
        icon: ArmchairIcon,
        exact: false,
      },
    ],
  },
  {
    label: "资源统筹",
    items: [
      {
        to: "/project/$projectId/activity/$activityId/resources",
        label: "需求总览",
        icon: ClipboardListIcon,
        exact: false,
      },
      {
        to: "/project/$projectId/activity/$activityId/resource-ledger",
        label: "资源安排",
        icon: PackageIcon,
        exact: false,
      },
    ],
  },
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

      <div className="flex flex-1 items-start gap-6 border-t pt-4">
        {/**
         * 二级导航是一根**独立的列**，靠右边那条竖线和内容分开。
         *
         * 第一版没有这条线也没有图标，九行灰字直接贴在白底上，读起来不像导航
         * 像段落。三件事一起才立得住：右边框划出地盘、图标给每行形状、分组
         * 标题比条目**更重**而不是更轻（第一版反了，标题 xs muted、条目 sm
         * muted-foreground，标题看着比条目还次要）。
         *
         * sticky 是顺带的：人员、行程那几张表一屏放不下，往下滚时导航跟着走，
         * 不用滚回顶部才能换页。`top-20` 让它停在固定顶栏（h-16）下面。
         */}
        {/* 竖线画在**外层**而不是 nav 上：nav 自己 sticky，高度只有内容那么高，
            边框跟着它就会在半路断掉；外层 self-stretch 撑满整行，线才走到底。 */}
        <div className="w-48 shrink-0 self-stretch border-r pr-4">
          <nav aria-label="活动子模块" className="sticky top-20 pb-2">
            {NAV_GROUPS.map((group, groupIndex) => (
              <div
                key={group.label ?? "overview"}
                className={groupIndex > 0 ? "mt-4" : undefined}
              >
                {group.label && (
                  <div className="px-3 pb-1 font-semibold text-foreground/80 text-xs tracking-wide">
                    {group.label}
                  </div>
                )}
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const isActive = !!matchRoute({
                      to: item.to,
                      params: {
                        projectId: projectIdParam,
                        activityId: activityIdParam,
                      },
                      fuzzy: !item.exact,
                    });
                    const Icon: LucideIcon = item.icon;
                    return (
                      <Link
                        key={item.to}
                        to={item.to}
                        params={{
                          projectId: projectIdParam,
                          activityId: activityIdParam,
                        }}
                        className={cn(
                          "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                          isActive
                            ? "bg-primary/10 font-medium text-primary"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        <Icon
                          className={cn(
                            "size-4 shrink-0",
                            !isActive && "text-muted-foreground/70",
                          )}
                        />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </div>

        {/* min-w-0：子页面里的宽表靠自己的容器横向滚动，没有这一行 flex 子项
            会被内容撑开，把侧边导航挤出视口。 */}
        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
