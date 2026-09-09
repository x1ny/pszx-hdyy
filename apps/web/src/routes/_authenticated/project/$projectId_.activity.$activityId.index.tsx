import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { InferResponseType } from "hono/client";
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  Share2Icon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  ActivityFormDialog,
  type ActivityFormSubmitValues,
} from "#/features/project/activity-form-dialog";
import {
  activityDetailQueryOptions,
  activityKeys,
  shareActivityItinerary,
  updateActivity,
} from "#/features/project/queries";
import {
  ACTIVITY_TYPE_LABELS,
  formatBudget,
  formatDateTime,
  PUBLISH_STATUS_LABELS,
} from "#/features/project/utils";
import { Badge } from "#/shared/components/ui/badge.tsx";
import { Button, buttonVariants } from "#/shared/components/ui/button.tsx";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "#/shared/components/ui/card.tsx";
import { Skeleton } from "#/shared/components/ui/skeleton.tsx";
import { type ApiData, api, unwrap } from "#/shared/lib/api";
import { cn } from "#/shared/lib/utils.ts";
import { copyText } from "./-activity-overview-utils";

type ConfigStatus = ApiData<
  InferResponseType<typeof api.api.activityConfig.status.$post>
>;
type ConfigItem = ConfigStatus["items"][number];
type ItemStatus = ConfigItem["status"];

const configStatusQueryOptions = (activityId: number) =>
  queryOptions({
    queryKey: ["activityConfig", activityId] as const,
    queryFn: () =>
      unwrap(api.api.activityConfig.status.$post({ json: { activityId } })),
  });

const dayMs = 24 * 60 * 60 * 1000;

/** "2 天" / "3 小时 30 分"。跨天的活动只说天数，当天的说时长。 */
function duration({
  startTime,
  endTime,
}: {
  startTime: string;
  endTime: string;
}) {
  const ms = new Date(endTime).getTime() - new Date(startTime).getTime();
  if (ms <= 0) return "-";
  if (ms >= dayMs) {
    const days = Math.round((ms / dayMs) * 10) / 10;
    return `${days} 天`;
  }
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.round((ms % 3600000) / 60000);
  return hours > 0 ? `${hours} 小时 ${minutes} 分` : `${minutes} 分`;
}

export const Route = createFileRoute(
  "/_authenticated/project/$projectId_/activity/$activityId/",
)({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(
      configStatusQueryOptions(Number(params.activityId)),
    ),
  component: ActivityOverviewPage,
});

const STATUS_META = {
  done: {
    label: "已配置",
    chip: "border-success/30 bg-success/10 text-success-foreground",
    icon: CircleCheckIcon,
  },
  missing: {
    label: "待配置",
    chip: "border-destructive/30 bg-destructive/10 text-destructive",
    icon: CircleDotIcon,
  },
  not_applicable: {
    label: "不适用",
    chip: "border-border bg-muted text-muted-foreground",
    icon: CircleDashedIcon,
  },
} as const satisfies Record<
  ItemStatus,
  { label: string; chip: string; icon: typeof CircleCheckIcon }
>;

/**
 * 活动总览 = 原来的「活动概览」+「配置总览」。
 *
 * ## 为什么合并
 *
 * 两页都只读、都不承载作业，而且互相指：概览是活动的档案，配置总览是一张
 * "还差什么"的待办清单，它唯一的动作就是跳去别的页面。分成两个平级入口的
 * 代价是**落地页永远是最没用的那一页**——活动列表的两个入口都落在概览，
 * 而概览下方三分之二是空的，想知道进度还得再点一次。
 *
 * 合并之后这一页自己回答了两个问题：这场活动是什么（档案），现在还缺什么
 * （待办）。原来那片空白正好被待办填掉。
 *
 * ## 版面：四块 → 待办 → 档案，只有这三段
 *
 * 档案是不变的事实，待办是要动手的事，所以待办在上。**没有待办时「待处理」
 * 整栏不渲染**，四块顶上的状态 chip 就是全部结论——不为"配齐了"这件事再占
 * 半屏画空状态，那正是这一页最该消灭的噪音（BR-DEV-011：活动详情页只作为
 * 总入口和配置总览，可展示待处理提示）。
 *
 * **没有「无需处理」那一栏。** 曾经有过一个折叠区列出已配置和不适用的项，
 * 现在删了：四块本来就逐项报了状态（绿勾 / 灰圈 / 红点 + 数字），再列一遍
 * 是同一批数据的第二种表达，而且是那种"展开之后什么也做不了"的表达。
 */
function ActivityOverviewPage() {
  const { projectId, activityId: activityIdParam } = Route.useParams();
  const activityId = Number(activityIdParam);
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);

  // 父路由（活动详情布局）的 loader 已经把这条数据 ensureQueryData 过，
  // 这里拿到的是缓存命中，不会再发一次请求。
  const { data: activity } = useQuery(activityDetailQueryOptions(activityId));
  const statusQuery = useQuery(configStatusQueryOptions(activityId));

  const saveMutation = useMutation({
    mutationFn: (values: ActivityFormSubmitValues) =>
      updateActivity({ ...values, id: activityId }),
    onSuccess: () => {
      toast.success("修改成功");
      setFormOpen(false);
      // 不用顺手 invalidate activityConfig：六个配置项没有一项读活动表自己的
      // 列，编辑活动改不动它们（「活动基础信息」那一项已经删了）。
      queryClient.invalidateQueries({ queryKey: activityKeys.all });
    },
    onError: (error) => toast.error(error.message),
  });

  const shareMutation = useMutation({
    mutationFn: () => shareActivityItinerary(activityId),
    onSuccess: async ({ url }) => {
      if (await copyText(url)) {
        toast.success("行程链接已复制");
      } else {
        toast.error("链接已生成，但复制失败，请重试");
      }
    },
    onError: (error) => toast.error(error.message),
  });

  if (!activity) return null;

  const items = statusQuery.data?.items ?? [];
  // 配置项现在**每一项都归四块中的某一块**，所以待办就是全部 missing 项，
  // 这里不用再挑。（曾经要挑掉「活动基础信息」，那一项已经从服务端删掉了。）
  const todos = items.filter((item) => item.status === "missing");

  return (
    <>
      <div className="flex flex-col gap-4">
        {statusQuery.isPending ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {OVERVIEW_BLOCKS.map((block) => (
              <Skeleton key={block.label} className="h-28 w-full" />
            ))}
          </div>
        ) : (
          <OverviewBlocks
            items={items}
            projectId={projectId}
            activityIdParam={activityIdParam}
          />
        )}

        {todos.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="font-semibold text-sm">
              待处理
              <span className="ml-1 font-normal text-muted-foreground">
                （{todos.length}）
              </span>
            </h2>
            {todos.map((item) => (
              <ItemRow
                key={item.key}
                item={item}
                projectId={projectId}
                activityIdParam={activityIdParam}
              />
            ))}
          </section>
        )}

        <Card size="sm">
          <CardHeader>
            {/* 这里**不提示"还差哪几个字段"**。地点、简介、主办/承办确实有
                下游消费方（H5 展示、邀请函正文），但它们不是配置流程的一步，
                而且"这场活动就是没有承办单位"是常态——挂一个红提示，用户学会
                的是无视它，顺带无视上面四块里真正的待办。 */}
            <CardTitle>活动基础信息</CardTitle>
            <CardAction className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={shareMutation.isPending}
                onClick={() => shareMutation.mutate()}
              >
                <Share2Icon data-icon="inline-start" />
                {shareMutation.isPending ? "正在生成..." : "分享行程链接"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFormOpen(true)}
              >
                编辑活动
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {/**
             * 字段清单对齐原型 activity-detail.html 的「活动基础信息」面板，
             * 去掉三样：
             * - H5 展示、报名开关：只控制 H5 行为，H5 本期不建。
             * - 活动图片/视频：同上，媒体全是给 H5 用的。
             *
             * 顶部那行副标题里已经有类型/地点/时间了，这里仍然重复一遍——副
             * 标题是跟着所有子页面走的**上下文**，这张卡片是活动的**档案**，
             * 一份缺了地点和时间的"基础信息"看着就像坏了。
             */}
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-4">
              <InfoRow label="所属项目">{activity.projectName}</InfoRow>
              <InfoRow label="活动类型">
                {ACTIVITY_TYPE_LABELS[activity.activityType]}
              </InfoRow>
              <InfoRow label="发布状态">
                {PUBLISH_STATUS_LABELS[activity.publishStatus]}
              </InfoRow>
              <InfoRow label="总预算">
                {formatBudget(activity.totalBudget)}
              </InfoRow>

              <InfoRow label="活动地点">{activity.location || "-"}</InfoRow>
              <InfoRow label="开始时间">
                {formatDateTime(activity.startTime)}
              </InfoRow>
              <InfoRow label="结束时间">
                {formatDateTime(activity.endTime)}
              </InfoRow>
              <InfoRow label="活动时长">{duration(activity)}</InfoRow>

              <InfoRow label="主办单位">{activity.hostOrg || "-"}</InfoRow>
              <InfoRow label="承办单位">{activity.organizerOrg || "-"}</InfoRow>
              <InfoRow label="支持单位">{activity.supportOrg || "-"}</InfoRow>
              <InfoRow label="指导单位">{activity.guidingOrg || "-"}</InfoRow>
            </dl>

            {/* 简介单独一块并带上标签。原来它是一段没有标题的灰字，读者分不清
                那是简介还是某个字段的补充说明 */}
            <div className="mt-2 flex flex-col gap-0.5 border-t pt-4">
              <dt className="text-muted-foreground text-xs">活动简介</dt>
              <dd className="whitespace-pre-wrap text-sm leading-relaxed">
                {activity.description || (
                  <span className="text-muted-foreground">未填写</span>
                )}
              </dd>
            </div>
          </CardContent>
        </Card>
      </div>

      <ActivityFormDialog
        open={formOpen}
        activity={activity}
        submitting={saveMutation.isPending}
        onOpenChange={setFormOpen}
        onSubmit={(values) => saveMutation.mutate(values)}
      />
    </>
  );
}

/**
 * 总览顶部的四块。
 *
 * **和左侧导航的四个分组一一对应**（议程 / 人员与安排 / 场地与座位 / 资源统筹），
 * 这不是巧合而是唯一的取名依据：用户在导航里刚认下这四堆东西，总览就该按同一
 * 种分法回答"每一堆配到哪了"。换成别的分法，两个地方就得各记一遍。
 *
 * 服务端的六个配置项**正好被这四块分完**，一项不剩。下面那张「活动基础信息」
 * 卡不参与——它是活动的档案，不是配置项（那一项已经从服务端删了，理由写在
 * `activity-config/routes.ts` 顶上）。
 *
 * 一块里可能装两项（场地 + 排座、人员 + 邀请函），块的状态取**最差的那一项**：
 * 一块里只要有待办，整块就该是红的，否则用户扫一眼会以为这一堆没事。
 */
const OVERVIEW_BLOCKS = [
  { label: "活动议程", keys: ["agenda"] },
  { label: "人员管理", keys: ["members", "invitation"] },
  { label: "场地与座位", keys: ["venue", "seating"] },
  { label: "资源统筹", keys: ["resource"] },
] as const;

function OverviewBlocks({
  items,
  projectId,
  activityIdParam,
}: {
  items: readonly ConfigItem[];
  projectId: string;
  activityIdParam: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {OVERVIEW_BLOCKS.map((block) => {
          const blockItems = block.keys
            .map((key) => items.find((item) => item.key === key))
            .filter((item): item is ConfigItem => !!item);

          if (blockItems.length === 0) return null;

          // 有待办报红；一项都没待办但有配好的报绿；全不适用报灰。
          const status: ItemStatus = blockItems.some(
            (item) => item.status === "missing",
          )
            ? "missing"
            : blockItems.some((item) => item.status === "done")
              ? "done"
              : "not_applicable";
          const meta = STATUS_META[status];

          // 整块点进它的**第一项**：那一项是这一堆的前置（场地先于排座、
          // 人员先于邀请函），配不下去时该落在需要先动手的那一页。
          const firstTab = blockItems[0]?.tab;
          const entry = isNavKey(firstTab) ? NAV_ENTRIES[firstTab] : null;
          const multi = blockItems.length > 1;

          const body = (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm">{block.label}</span>
                <Badge
                  variant="outline"
                  className={cn("shrink-0 border", meta.chip)}
                >
                  {status === "missing" ? "待处理" : meta.label}
                </Badge>
              </div>
              <div className="flex flex-col gap-1.5">
                {blockItems.map((item) => {
                  const ItemIcon = STATUS_META[item.status].icon;
                  return (
                    <div
                      key={item.key}
                      className="flex items-baseline gap-1.5"
                      title={`${item.label}：${item.detail}`}
                    >
                      <span
                        className={cn(
                          "font-semibold tabular-nums leading-none",
                          multi ? "text-lg" : "text-2xl",
                        )}
                      >
                        {item.metric.value}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
                        {item.metric.unit}
                      </span>
                      {/* 一块装两项时才标出是哪一行出的问题——只给一个状态
                          图标，不写项名：单位（"个可用区域" / "个环节已确认
                          排位"）已经把是谁说清楚了，再写一遍反而把单位挤到
                          省略号里。项名和完整判定留在 title 上。 */}
                      {multi && (
                        <ItemIcon
                          className={cn(
                            "size-3.5 shrink-0 self-center text-muted-foreground",
                            item.status === "done" && "text-success",
                            item.status === "missing" && "text-destructive",
                          )}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          );

          const shell = cn(
            "flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm",
            status === "missing" && "border-destructive/30",
          );

          return entry ? (
            <Link
              key={block.label}
              to={entry.to}
              params={{ projectId, activityId: activityIdParam }}
              className={cn(
                shell,
                "transition-colors hover:border-primary/50 hover:bg-muted/40",
              )}
            >
              {body}
            </Link>
          ) : (
            <div key={block.label} className={shell}>
              {body}
            </div>
          );
        })}
      </div>
      <p className="text-muted-foreground text-xs">
        只统计本活动适用的配置项；缺失只提示，不阻断活动发布
      </p>
    </div>
  );
}

/**
 * 配置项 → 侧边导航项的跳转表。
 *
 * 路由写成字面量而不是 `to={`.../${item.tab}`}`——TanStack Router 的 `to` 要的是
 * 字面量路由，拼出来的字符串拿不到类型检查，改路由时不会报错。
 *
 * 服务端给的 `item.tab` 仍然是老的路径段（`agenda` / `members` / …），那是路由
 * 名不是显示名，不用跟着导航改名动；这张表负责把它翻译成用户现在看到的名字。
 */
const NAV_ENTRIES = {
  agenda: {
    to: "/project/$projectId/activity/$activityId/agenda",
    label: "去活动议程",
  },
  members: {
    to: "/project/$projectId/activity/$activityId/members",
    label: "去人员名单",
  },
  resources: {
    to: "/project/$projectId/activity/$activityId/resources",
    label: "去需求总览",
  },
  venue: {
    to: "/project/$projectId/activity/$activityId/venue",
    label: "去活动场地",
  },
  seating: {
    to: "/project/$projectId/activity/$activityId/seating",
    label: "去座位安排",
  },
  invitations: {
    to: "/project/$projectId/activity/$activityId/invitations",
    label: "去邀请函",
  },
} as const;

type NavKey = keyof typeof NAV_ENTRIES;

const isNavKey = (tab: string | undefined): tab is NavKey =>
  tab !== undefined && tab in NAV_ENTRIES;

/**
 * 跳转按钮用实心蓝（`default` 变体 = `bg-primary`）。
 *
 * 这里不走 crud-page-guide 里"行内操作用 ghost + text-primary"那条：那条针对
 * 的是表格操作列，一行三四个按钮并排，实心底会糊成一片。这个页面每行最多
 * 一个按钮，而且它就是这一行唯一的行动点，实心底才配得上它的分量。
 */
const ENTRY_LINK_CLASS = buttonVariants({ size: "sm" });

/**
 * 一条待办。
 *
 * 只渲染 `missing` 的项——「无需处理」那一栏已经去掉了，已配置和不适用的状态
 * 由上面四块承担。所以这里不再分状态样式，也不再有「基础信息就地开弹窗」那条
 * 分支：基础信息压根不进这个列表，它的缺口挂在下面那张卡的标题上。
 */
function ItemRow({
  item,
  projectId,
  activityIdParam,
}: {
  item: ConfigItem;
  projectId: string;
  activityIdParam: string;
}) {
  const meta = STATUS_META[item.status];
  const Icon = meta.icon;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-card p-4 shadow-sm">
      <Icon className="size-5 shrink-0 text-destructive" />

      <div className="min-w-48 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{item.label}</span>
          <Badge variant="outline" className={cn("border", meta.chip)}>
            {meta.label}
          </Badge>
        </div>
        <p className="text-muted-foreground text-sm">{item.detail}</p>
        {item.hint && (
          <p className="mt-0.5 text-muted-foreground text-xs">{item.hint}</p>
        )}
      </div>

      {isNavKey(item.tab) && (
        <Link
          to={NAV_ENTRIES[item.tab].to}
          params={{ projectId, activityId: activityIdParam }}
          className={ENTRY_LINK_CLASS}
        >
          {NAV_ENTRIES[item.tab].label}
        </Link>
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
