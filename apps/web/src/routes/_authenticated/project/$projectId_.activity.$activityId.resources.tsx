import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ClipboardListIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import {
  DEMAND_HANDLING_LABELS,
  DEMAND_STATUS_CHIP,
  DEMAND_STATUS_FILTER_ITEMS,
  DEMAND_STATUS_LABELS,
  DEMAND_STATUS_VALUES,
  isOpenTodo,
  RESOURCE_TYPE_BADGE_CLASS,
  RESOURCE_TYPE_FILTER_ITEMS,
  RESOURCE_TYPE_LABELS,
  RESOURCE_TYPE_VALUES,
} from "#/features/resource/labels.ts";
import {
  type DemandStatus,
  type ResourceDemand,
  type ResourceType,
  resourceDemandListQueryOptions,
} from "#/features/resource/queries.ts";
import { FilterActions, FilterBar } from "#/shared/components/filter-bar.tsx";
import { Badge } from "#/shared/components/ui/badge.tsx";
import { buttonVariants } from "#/shared/components/ui/button.tsx";
import { Checkbox } from "#/shared/components/ui/checkbox.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "#/shared/components/ui/empty.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/shared/components/ui/select.tsx";
import { Skeleton } from "#/shared/components/ui/skeleton.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/shared/components/ui/table.tsx";
import { cn } from "#/shared/lib/utils.ts";

/**
 * 筛选走 URL search params，每个字段都带 `.catch()`：别人手改 URL 传乱七八糟
 * 的值时降级成"全部"，而不是崩掉。
 */
const ResourceSummarySearchSchema = z.object({
  resourceType: z.enum(RESOURCE_TYPE_VALUES).optional().catch(undefined),
  status: z.enum(DEMAND_STATUS_VALUES).optional().catch(undefined),
  includeVoidedSegment: z.boolean().default(false).catch(false),
});

export const Route = createFileRoute(
  "/_authenticated/project/$projectId_/activity/$activityId/resources",
)({
  validateSearch: ResourceSummarySearchSchema,
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(
      resourceDemandListQueryOptions(Number(params.activityId)),
    ),
  component: ResourceSummaryTab,
});

const dayTimeFormat = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * 资源需求汇总。
 *
 * 这是一个**只读的衔接页**（BR-DEV-033B：不作为第三套资源录入来源）——它只做
 * 汇总、筛选、状态展示和跳转。声明在议程页的环节弹窗里做，落实在资源台账里做，
 * 这里一个新增按钮都没有，是有意的。
 *
 * 数据和议程页共用同一份缓存（resourceDemandListQueryOptions），全量不分页，
 * 所以筛选和统计都在前端算，没有单独的 stats 接口。
 */
function ResourceSummaryTab() {
  const { projectId, activityId: activityIdParam } = Route.useParams();
  const activityId = Number(activityIdParam);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  // 筛选控件全部先落在草稿 state 上，点「查询」才写进 URL——这一页的筛选虽然是
  // 前端算的（不发请求），交互也跟其它列表页保持一致，见 filter-bar.tsx。
  const [resourceTypeDraft, setResourceTypeDraft] = useState<ResourceType | null>(
    search.resourceType ?? null,
  );
  const [statusDraft, setStatusDraft] = useState<DemandStatus | null>(
    search.status ?? null,
  );
  const [includeVoidedDraft, setIncludeVoidedDraft] = useState(
    search.includeVoidedSegment,
  );

  // URL 变了就把草稿拉回来对齐（后退、粘链接进来）。
  useEffect(() => {
    setResourceTypeDraft(search.resourceType ?? null);
    setStatusDraft(search.status ?? null);
    setIncludeVoidedDraft(search.includeVoidedSegment);
  }, [search.resourceType, search.status, search.includeVoidedSegment]);

  const demandQuery = useQuery(resourceDemandListQueryOptions(activityId));

  // hooks 全部在这条早退之前声明，别往下挪。
  if (demandQuery.isPending) return <Skeleton className="h-96 w-full" />;

  const all = demandQuery.data?.list ?? [];

  // 作废环节的需求默认不看：环节都不在议程上了，它的用车需求不该再催人配。
  // 但也不能直接丢掉——万一是误作废，得有地方能看见。
  const scoped = search.includeVoidedSegment
    ? all
    : all.filter((demand) => demand.segmentStatus === "active");

  const rows = scoped.filter(
    (demand) =>
      (!search.resourceType || demand.resourceType === search.resourceType) &&
      (!search.status || demand.status === search.status),
  );

  const countOf = (status: DemandStatus) =>
    scoped.filter((demand) => demand.status === status).length;

  const voidedSegmentCount = all.length - scoped.length;

  const setFilter = (patch: Partial<typeof search>) =>
    navigate({ search: (prev) => ({ ...prev, ...patch }) });

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="待配置"
          value={countOf("pending")}
          hint="已声明需落实，台账里还没有记录"
          tone="alert"
        />
        <StatTile
          label="配置中"
          value={countOf("configuring")}
          hint="已有资源记录，服务名单还没定"
          tone="warn"
        />
        <StatTile
          label="已配置"
          value={countOf("configured")}
          hint="资源和名单都已落实"
        />
        <StatTile
          label="仅记录"
          value={countOf("recorded")}
          hint="只留需求说明，不进待办"
        />
      </div>

      <FilterBar
        className="justify-between gap-3 p-4"
        onSubmit={() =>
          setFilter({
            resourceType: resourceTypeDraft ?? undefined,
            status: statusDraft ?? undefined,
            includeVoidedSegment: includeVoidedDraft,
          })
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-xs">资源类型</span>
            {/* items 必传，否则 SelectValue 渲染的是原始枚举值 */}
            <Select
              items={RESOURCE_TYPE_FILTER_ITEMS}
              value={resourceTypeDraft}
              onValueChange={(value) =>
                setResourceTypeDraft(value as ResourceType | null)
              }
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RESOURCE_TYPE_FILTER_ITEMS.map((item) => (
                  <SelectItem key={item.value ?? "all"} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-xs">配置状态</span>
            <Select
              items={DEMAND_STATUS_FILTER_ITEMS}
              value={statusDraft}
              onValueChange={(value) =>
                setStatusDraft(value as DemandStatus | null)
              }
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEMAND_STATUS_FILTER_ITEMS.map((item) => (
                  <SelectItem key={item.value ?? "all"} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <label className="flex h-9 cursor-pointer items-center gap-2 text-muted-foreground text-sm">
            <Checkbox
              checked={includeVoidedDraft}
              onCheckedChange={(checked) => setIncludeVoidedDraft(!!checked)}
            />
            含作废环节
            {/* 隐藏条数说的是**当前生效**的筛选结果，所以读 search 不读草稿 */}
            {voidedSegmentCount > 0 && !search.includeVoidedSegment && (
              <span className="text-xs">（{voidedSegmentCount} 项已隐藏）</span>
            )}
          </label>

          <FilterActions
            onReset={() => {
              setResourceTypeDraft(null);
              setStatusDraft(null);
              setIncludeVoidedDraft(false);
              navigate({ search: {} });
            }}
          />
        </div>

        <Link
          to="/project/$projectId/activity/$activityId/resource-ledger"
          params={{ projectId, activityId: activityIdParam }}
          className={buttonVariants({ variant: "outline" })}
        >
          进入资源台账
        </Link>
      </FilterBar>

      <div className="rounded-lg border bg-card shadow-sm">
        <Table>
          <TableHeader className="bg-muted/60">
            <TableRow className="hover:bg-transparent">
              <TableHead className="min-w-40">来源环节</TableHead>
              <TableHead>环节时间</TableHead>
              <TableHead>资源类型</TableHead>
              <TableHead>处理要求</TableHead>
              <TableHead className="min-w-48">需求说明</TableHead>
              <TableHead>预计数量</TableHead>
              <TableHead>负责人</TableHead>
              <TableHead>落实情况</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-center">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10}>
                  <Empty className="border-0">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <ClipboardListIcon />
                      </EmptyMedia>
                      <EmptyTitle>
                        {all.length === 0 ? "还没有资源需求" : "没有匹配的需求"}
                      </EmptyTitle>
                      <EmptyDescription>
                        {all.length === 0
                          ? "资源需求由环节声明产生。到「议程 / 环节」标签页，在环节行上点「资源需求」按需开启用车、用餐、住宿或物料。"
                          : "换个筛选条件试试，或点上面的重置。"}
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((demand) => (
                <DemandRow
                  key={demand.id}
                  demand={demand}
                  projectId={projectId}
                  activityIdParam={activityIdParam}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function DemandRow({
  demand,
  projectId,
  activityIdParam,
}: {
  demand: ResourceDemand;
  projectId: string;
  activityIdParam: string;
}) {
  const voidedSegment = demand.segmentStatus === "voided";

  return (
    <TableRow className={cn(voidedSegment && "text-muted-foreground")}>
      <TableCell className="font-medium">
        {demand.segmentName}
        {voidedSegment && (
          <span className="ml-1 text-muted-foreground text-xs">（已作废）</span>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap tabular-nums">
        {dayTimeFormat.format(new Date(demand.segmentStartTime))}
      </TableCell>
      <TableCell>
        <Badge
          variant="outline"
          className={RESOURCE_TYPE_BADGE_CLASS[demand.resourceType]}
        >
          {RESOURCE_TYPE_LABELS[demand.resourceType]}
        </Badge>
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {DEMAND_HANDLING_LABELS[demand.handling]}
      </TableCell>
      <TableCell className="text-muted-foreground text-sm">
        {demand.description || "-"}
      </TableCell>
      <TableCell className="tabular-nums">
        {demand.estimatedCount ?? "-"}
      </TableCell>
      <TableCell>{demand.ownerName || "-"}</TableCell>
      <TableCell className="whitespace-nowrap text-sm">
        {demand.handling === "record_only" ? (
          <span className="text-muted-foreground">不需落实</span>
        ) : demand.activeResourceCount === 0 ? (
          <span className="text-muted-foreground">尚未关联资源</span>
        ) : (
          <span>
            {demand.activeResourceCount} 条资源
            {demand.boundMemberCount > 0 && ` · ${demand.boundMemberCount} 人`}
          </span>
        )}
      </TableCell>
      <TableCell>
        <Badge
          variant="outline"
          className={cn("border", DEMAND_STATUS_CHIP[demand.status])}
        >
          {DEMAND_STATUS_LABELS[demand.status]}
        </Badge>
      </TableCell>
      <TableCell className="text-center">
        <div className="inline-flex items-center gap-1">
          {/* 待办项直接给"去配置"：带上资源类型和需求 id，台账页会开着预填好
              的新增弹窗接住（BR-DEV-033C 要求跳转时带入类型和需求说明）。 */}
          {isOpenTodo(demand) && demand.activeResourceCount === 0 && (
            <Link
              to="/project/$projectId/activity/$activityId/resource-ledger"
              params={{ projectId, activityId: activityIdParam }}
              search={{ newForDemandId: demand.id }}
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              去配置
            </Link>
          )}
          {demand.activeResourceCount > 0 && (
            <Link
              to="/project/$projectId/activity/$activityId/resource-ledger"
              params={{ projectId, activityId: activityIdParam }}
              search={{ demandId: demand.id }}
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              查看安排
            </Link>
          )}
          <Link
            to="/project/$projectId/activity/$activityId/agenda"
            params={{ projectId, activityId: activityIdParam }}
            search={{ view: "list", includeVoided: voidedSegment }}
            className={buttonVariants({
              variant: "ghost",
              size: "sm",
              className: "text-muted-foreground hover:text-foreground",
            })}
          >
            回到环节
          </Link>
        </div>
      </TableCell>
    </TableRow>
  );
}

function StatTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint: string;
  tone?: "alert" | "warn";
}) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p
        className={cn(
          "font-semibold text-2xl tabular-nums",
          // 只有真缺口才上色。全绿的时候页面上一个高亮都没有，正是想要的效果。
          value > 0 && tone === "alert" && "text-destructive",
          value > 0 && tone === "warn" && "text-warning-foreground",
        )}
      >
        {value}
      </p>
      <p className="text-muted-foreground text-xs">{hint}</p>
    </div>
  );
}
