import { queryOptions, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  ConstructionIcon,
} from "lucide-react";
import { Badge } from "#/shared/components/ui/badge.tsx";
import { buttonVariants } from "#/shared/components/ui/button.tsx";
import { Skeleton } from "#/shared/components/ui/skeleton.tsx";
import { type ApiData, api, unwrap } from "#/shared/lib/api";
import { cn } from "#/shared/lib/utils.ts";
import type { InferResponseType } from "hono/client";

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

export const Route = createFileRoute(
  "/_authenticated/project/$projectId_/activity/$activityId/config",
)({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(
      configStatusQueryOptions(Number(params.activityId)),
    ),
  component: ConfigOverviewTab,
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
  module_pending: {
    label: "待建设",
    chip: "border-border bg-muted text-muted-foreground",
    icon: ConstructionIcon,
  },
} as const satisfies Record<
  ItemStatus,
  { label: string; chip: string; icon: typeof CircleCheckIcon }
>;

/**
 * 活动配置总览。
 *
 * **这是一张待办清单，不是入口清单**——原型把它画成了一张 9 行的"配置域总览"
 * 表，每行一个模块入口。那份设计写于活动详情还是单页的时代；现在这些入口
 * 已经是活动详情的标签栏了（见 ed3a38a），再列一遍等于同一层导航出现两次，
 * 而且全配好的时候是 9 行绿色的噪音。
 *
 * 所以这里把「还差什么」放在最上面，已完成的收在下面一栏灰着；**没有待办时
 * 「待处理」整栏直接不渲染**，顶部的绿色 chip 就是全部结论。占半屏画一个
 * "配置齐了"的空状态，本身就是这个页面最该消灭的那种噪音（BR-DEV-011：
 * 活动详情页只作为总入口和配置总览，可展示待处理提示）。
 */
function ConfigOverviewTab() {
  const { projectId, activityId: activityIdParam } = Route.useParams();
  const activityId = Number(activityIdParam);

  const statusQuery = useQuery(configStatusQueryOptions(activityId));

  if (statusQuery.isPending) return <Skeleton className="h-96 w-full" />;

  const items = statusQuery.data?.items ?? [];
  const done = statusQuery.data?.done ?? 0;
  const total = statusQuery.data?.total ?? 0;

  const todos = items.filter((item) => item.status === "missing");
  const rest = items.filter((item) => item.status !== "missing");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-card p-5 shadow-sm">
        <div>
          <p className="text-muted-foreground text-xs">配置项完成情况</p>
          {/* 分数不是百分比：这些项之间不等权，百分比会让它看起来像个 KPI */}
          <p className="font-semibold text-2xl tabular-nums">
            {done}
            <span className="text-muted-foreground"> / {total} 项</span>
          </p>
          <p className="text-muted-foreground text-xs">
            只统计本活动适用的配置项；缺失只提示，不阻断活动发布
          </p>
        </div>
        {/* 有待办报红，没待办报绿。这两个 chip 就是"配齐没有"的全部表达——
            不再额外占半屏画一个空状态：一个只说"没事可做"的大盒子，本身
            就是这个页面最该消灭的那种噪音。 */}
        <Badge
          variant="outline"
          className={
            todos.length > 0
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-success/30 bg-success/10 text-success-foreground"
          }
        >
          {todos.length > 0 ? `${todos.length} 项待处理` : "已全部完成"}
        </Badge>
      </div>

      {todos.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold text-sm">待处理</h2>
          {todos.map((item) => (
            <ItemRow
              key={item.key}
              item={item}
              projectId={projectId}
              activityIdParam={activityIdParam}
              emphasized
            />
          ))}
        </section>
      )}

      <section className="flex flex-col gap-2">
        {/**
         * 标题跟着上面那一栏在不在走：
         * - 有待办时它是「无需处理」，和上面的「待处理」正好对仗，也顺带
         *   解释了为什么"不适用"和"待建设"会混在这一栏里。
         * - 没待办时整个页面只剩这一栏，"无需处理"就没了参照物（原先叫
         *   "其余配置项"，读者会问"其余是相对什么"——那正是这个词的毛病），
         *   直接叫「配置项」。
         */}
        <h2 className="font-semibold text-muted-foreground text-sm">
          {todos.length > 0 ? "无需处理" : "配置项"}
        </h2>
        {rest.map((item) => (
          <ItemRow
            key={item.key}
            item={item}
            projectId={projectId}
            activityIdParam={activityIdParam}
          />
        ))}
      </section>
    </div>
  );
}

/**
 * 跳转按钮用实心蓝（`default` 变体 = `bg-primary`）。
 *
 * 这里不走 crud-page-guide 里"行内操作用 ghost + text-primary"那条：那条针对
 * 的是表格操作列，一行三四个按钮并排，实心底会糊成一片。这个页面每行最多
 * 一个按钮，而且它就是这一行唯一的行动点，实心底才配得上它的分量。
 */
const ENTRY_LINK_CLASS = buttonVariants({ size: "sm" });

function ItemRow({
  item,
  projectId,
  activityIdParam,
  emphasized,
}: {
  item: ConfigItem;
  projectId: string;
  activityIdParam: string;
  emphasized?: boolean;
}) {
  const meta = STATUS_META[item.status];
  const Icon = meta.icon;
  const muted = item.status === "not_applicable" || item.status === "module_pending";

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4 shadow-sm",
        emphasized && "border-destructive/30",
        muted && "opacity-70",
      )}
    >
      <Icon
        className={cn(
          "size-5 shrink-0",
          item.status === "done" && "text-success",
          item.status === "missing" && "text-destructive",
          muted && "text-muted-foreground",
        )}
      />

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

      {/* tab 为 null 的项要么没有对应页面（基础信息在活动概览里改），要么模块
          还没建成——这时不给一个点了没反应的按钮 */}
      {item.tab === "agenda" && (
        <TabLink to="agenda" projectId={projectId} activityId={activityIdParam}>
          进入议程 / 环节
        </TabLink>
      )}
      {item.tab === "members" && (
        <TabLink to="members" projectId={projectId} activityId={activityIdParam}>
          进入活动人员
        </TabLink>
      )}
      {item.tab === "resources" && (
        <TabLink
          to="resources"
          projectId={projectId}
          activityId={activityIdParam}
        >
          进入资源需求
        </TabLink>
      )}
      {item.key === "basic" && item.status === "missing" && (
        <Link
          to="/project/$projectId/activity/$activityId"
          params={{ projectId, activityId: activityIdParam }}
          className={ENTRY_LINK_CLASS}
        >
          去活动概览
        </Link>
      )}
    </div>
  );
}

/**
 * 标签跳转。三个分支写死而不是 `to={\`.../${item.tab}\`}`——TanStack Router
 * 的 `to` 要的是字面量路由，拼出来的字符串拿不到类型检查，改路由时不会报错。
 */
function TabLink({
  to,
  projectId,
  activityId,
  children,
}: {
  to: "agenda" | "members" | "resources";
  projectId: string;
  activityId: string;
  children: React.ReactNode;
}) {
  const className = ENTRY_LINK_CLASS;
  const params = { projectId, activityId };

  if (to === "agenda") {
    return (
      <Link
        to="/project/$projectId/activity/$activityId/agenda"
        params={params}
        className={className}
      >
        {children}
      </Link>
    );
  }
  if (to === "members") {
    return (
      <Link
        to="/project/$projectId/activity/$activityId/members"
        params={params}
        className={className}
      >
        {children}
      </Link>
    );
  }
  return (
    <Link
      to="/project/$projectId/activity/$activityId/resources"
      params={params}
      className={className}
    >
      {children}
    </Link>
  );
}
