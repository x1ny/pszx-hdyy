import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PackageIcon, PlusIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
  bindable,
  formatResourceTime,
  RESOURCE_STATUS_CHIP,
  RESOURCE_STATUS_FILTER_ITEMS,
  RESOURCE_STATUS_LABELS,
  RESOURCE_STATUS_VALUES,
  RESOURCE_TYPE_BADGE_CLASS,
  RESOURCE_TYPE_FILTER_ITEMS,
  RESOURCE_TYPE_LABELS,
  RESOURCE_TYPE_VALUES,
  resourceTypeLabel,
  TRANSPORT_SCENE_FILTER_ITEMS,
  TRANSPORT_SCENE_VALUES,
} from "#/features/resource/labels.ts";
import {
  type ActivityResource,
  activityResourceDetailQueryOptions,
  activityResourceKeys,
  activityResourceListQueryOptions,
  activityResourceStatsQueryOptions,
  createResource,
  resourceDemandKeys,
  resourceDemandListQueryOptions,
  setResourceStatus,
  updateResource,
} from "#/features/resource/queries.ts";
import { Badge } from "#/shared/components/ui/badge.tsx";
import { Button, buttonVariants } from "#/shared/components/ui/button.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "#/shared/components/ui/empty.tsx";
import { Input } from "#/shared/components/ui/input.tsx";
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
import {
  ResourceFormDialog,
  type ResourceFormSubmitValues,
} from "./-components/resource-form-dialog";
import { ResourceMembersDialog } from "./-components/resource-members-dialog";

/**
 * 筛选走 URL，每个字段 `.catch()` 兜底。
 *
 * `demandId` / `newForDemandId` 是从资源需求汇总页跳过来时带的：前者只看某条
 * 需求关联的资源，后者直接开一个预填好的新增弹窗（BR-DEV-033C 要求跳转时
 * 带入活动、环节、资源类型和需求说明）。
 */
const LedgerSearchSchema = z.object({
  resourceType: z.enum(RESOURCE_TYPE_VALUES).optional().catch(undefined),
  transportScene: z.enum(TRANSPORT_SCENE_VALUES).optional().catch(undefined),
  status: z.enum(RESOURCE_STATUS_VALUES).optional().catch(undefined),
  keyword: z.string().optional().catch(undefined),
  demandId: z.number().int().positive().optional().catch(undefined),
  newForDemandId: z.number().int().positive().optional().catch(undefined),
  page: z.number().int().min(1).default(1).catch(1),
  pageSize: z.number().int().min(1).max(100).default(10).catch(10),
});

export const Route = createFileRoute(
  "/_authenticated/project/$projectId_/activity/$activityId/resource-ledger/",
)({
  validateSearch: LedgerSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ context, params, deps }) => {
    const activityId = Number(params.activityId);
    return Promise.all([
      context.queryClient.ensureQueryData(
        activityResourceListQueryOptions({
          activityId,
          resourceType: deps.resourceType,
          transportScene: deps.transportScene,
          status: deps.status,
          keyword: deps.keyword,
          demandId: deps.demandId,
          page: deps.page,
          pageSize: deps.pageSize,
        }),
      ),
      // 关联需求的多选要用；和汇总页、议程页共用同一份缓存。
      context.queryClient.ensureQueryData(
        resourceDemandListQueryOptions(activityId),
      ),
    ]);
  },
  component: ResourceLedgerTab,
});

function ResourceLedgerTab() {
  const { projectId, activityId: activityIdParam } = Route.useParams();
  const activityId = Number(activityIdParam);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number>();
  const [memberResourceId, setMemberResourceId] = useState<number>();
  // 名称搜索本地暂存，回车或点"搜索"才写进 URL——每敲一个字母 push 一条
  // history 的话，后退键就废了。
  const [keywordDraft, setKeywordDraft] = useState(search.keyword ?? "");

  const filters = {
    activityId,
    resourceType: search.resourceType,
    transportScene: search.transportScene,
    status: search.status,
    keyword: search.keyword,
    demandId: search.demandId,
    page: search.page,
    pageSize: search.pageSize,
  };

  const listQuery = useQuery(activityResourceListQueryOptions(filters));
  const statsQuery = useQuery(activityResourceStatsQueryOptions(activityId));
  const demandQuery = useQuery(resourceDemandListQueryOptions(activityId));
  const editingQuery = useQuery(activityResourceDetailQueryOptions(editingId));

  const demands = demandQuery.data?.list ?? [];
  // 只有"需落实"的需求项能被关联——"仅记录"按定义就不产生台账记录，
  // 摆在多选里只会让人以为漏配了。作废环节的需求也不列。
  const linkableDemands = demands.filter(
    (demand) => demand.handling === "arrange" && demand.segmentStatus === "active",
  );

  const prefillDemand = search.newForDemandId
    ? demands.find((demand) => demand.id === search.newForDemandId)
    : undefined;

  // 从汇总页带 newForDemandId 跳进来时自动开新增弹窗，并把参数从 URL 上抹掉
  // ——否则关掉弹窗再刷新，它又会自己弹出来。
  useEffect(() => {
    if (!search.newForDemandId) return;
    setEditingId(undefined);
    setFormOpen(true);
  }, [search.newForDemandId]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: activityResourceKeys.all });
    // 资源变动会改变需求项的派生状态，两个 key 一起失效。
    queryClient.invalidateQueries({ queryKey: resourceDemandKeys.all });
  };

  const saveMutation = useMutation({
    mutationFn: (values: ResourceFormSubmitValues) =>
      editingId
        ? updateResource({ ...values, id: editingId })
        : createResource({ ...values, activityId }),
    onSuccess: () => {
      toast.success(editingId ? "修改成功" : "新增成功");
      setFormOpen(false);
      setEditingId(undefined);
      if (search.newForDemandId) {
        navigate({ search: (prev) => ({ ...prev, newForDemandId: undefined }) });
      }
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const statusMutation = useMutation({
    mutationFn: (resource: ActivityResource) =>
      setResourceStatus(
        resource.id,
        resource.status === "active" ? "voided" : "active",
      ),
    onSuccess: (_data, resource) => {
      toast.success(
        resource.status === "active" ? "资源已作废" : "资源已恢复",
      );
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const setFilter = (patch: Record<string, unknown>) =>
    // 改任何筛选都把 page 重置成 1：停在第 5 页而筛选结果只有 2 页的话，
    // 页面会看起来"筛没了"。
    navigate({ search: (prev) => ({ ...prev, ...patch, page: 1 }) });

  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const stats = statsQuery.data;
  const totalPages = Math.max(1, Math.ceil(total / search.pageSize));

  const closeForm = (open: boolean) => {
    setFormOpen(open);
    if (!open) {
      setEditingId(undefined);
      if (search.newForDemandId) {
        navigate({ search: (prev) => ({ ...prev, newForDemandId: undefined }) });
      }
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {RESOURCE_TYPE_VALUES.map((type) => (
          <StatTile
            key={type}
            label={RESOURCE_TYPE_LABELS[type]}
            value={stats?.[type] ?? 0}
            hint={
              type === "transport"
                ? "可按场景拆多辆车"
                : type === "material"
                  ? "只做清单记录，不绑人"
                  : "可绑定服务名单"
            }
          />
        ))}
        <StatTile
          label="已作废"
          value={stats?.voided ?? 0}
          hint="不计入需求配置状态"
        />
      </div>

      {search.demandId && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
          <span>正在查看某一条环节资源需求关联的安排。</span>
          <Button
            variant="ghost"
            size="sm"
            className="text-primary hover:text-primary"
            onClick={() => setFilter({ demandId: undefined })}
          >
            查看全部资源
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-xs">资源类型</span>
            {/* items 必传，否则 SelectValue 渲染的是原始枚举值 */}
            <Select
              items={RESOURCE_TYPE_FILTER_ITEMS}
              value={search.resourceType ?? null}
              onValueChange={(value) =>
                setFilter({
                  resourceType: value ?? undefined,
                  // 换成非用车类型时把用车场景一起清掉，否则会筛出空列表
                  transportScene:
                    value === "transport" ? search.transportScene : undefined,
                })
              }
            >
              <SelectTrigger className="w-32">
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

          {search.resourceType === "transport" && (
            <div className="flex flex-col gap-1.5">
              <span className="text-muted-foreground text-xs">用车场景</span>
              <Select
                items={TRANSPORT_SCENE_FILTER_ITEMS}
                value={search.transportScene ?? null}
                onValueChange={(value) =>
                  setFilter({ transportScene: value ?? undefined })
                }
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRANSPORT_SCENE_FILTER_ITEMS.map((item) => (
                    <SelectItem key={item.value ?? "all"} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-xs">状态</span>
            <Select
              items={RESOURCE_STATUS_FILTER_ITEMS}
              value={search.status ?? null}
              onValueChange={(value) => setFilter({ status: value ?? undefined })}
            >
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RESOURCE_STATUS_FILTER_ITEMS.map((item) => (
                  <SelectItem key={item.value ?? "all"} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-xs">
              名称 / 地点 / 车辆 / 司机
            </span>
            <Input
              className="w-56"
              placeholder="回车搜索"
              value={keywordDraft}
              onChange={(event) => setKeywordDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  setFilter({ keyword: keywordDraft || undefined });
                }
              }}
            />
          </div>

          <Button
            variant="ghost"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => {
              setKeywordDraft("");
              navigate({
                search: () => ({ page: 1, pageSize: search.pageSize }),
              });
            }}
          >
            重置
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/project/$projectId/activity/$activityId/resources"
            params={{ projectId, activityId: activityIdParam }}
            className={buttonVariants({ variant: "outline" })}
          >
            返回资源需求
          </Link>
          <Button
            onClick={() => {
              setEditingId(undefined);
              setFormOpen(true);
            }}
          >
            <PlusIcon />
            新增资源安排
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-card shadow-sm">
        <Table>
          <TableHeader className="bg-muted/60">
            <TableRow className="hover:bg-transparent">
              <TableHead className="min-w-40">资源名称</TableHead>
              <TableHead>类型 / 场景</TableHead>
              <TableHead>数量</TableHead>
              <TableHead>时间</TableHead>
              <TableHead>地点</TableHead>
              <TableHead>车辆 / 司机</TableHead>
              <TableHead>关联需求</TableHead>
              <TableHead>服务名单</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-center">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQuery.isPending ? (
              <TableRow>
                <TableCell colSpan={10}>
                  <Skeleton className="h-40 w-full" />
                </TableCell>
              </TableRow>
            ) : list.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10}>
                  <Empty className="border-0">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <PackageIcon />
                      </EmptyMedia>
                      <EmptyTitle>还没有资源记录</EmptyTitle>
                      <EmptyDescription>
                        资源安排归属活动，不归属环节——一辆接站车可以同时服务
                        多个环节。点右上角新增，或从「资源需求」页的待办直接
                        带参过来。
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </TableCell>
              </TableRow>
            ) : (
              list.map((resource) => {
                const voided = resource.status === "voided";
                return (
                  <TableRow
                    key={resource.id}
                    className={cn(voided && "text-muted-foreground")}
                  >
                    <TableCell className="font-medium">
                      {resource.name}
                      {resource.remark && (
                        <span className="block text-muted-foreground text-xs">
                          {resource.remark}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Badge
                        variant="outline"
                        className={
                          RESOURCE_TYPE_BADGE_CLASS[resource.resourceType]
                        }
                      >
                        {resourceTypeLabel(resource)}
                      </Badge>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {resource.quantity ?? "-"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {formatResourceTime(resource)}
                    </TableCell>
                    <TableCell>{resource.location || "-"}</TableCell>
                    <TableCell className="text-sm">
                      {resource.vehicleInfo || resource.driverName ? (
                        <>
                          <span className="block">
                            {resource.vehicleInfo || "-"}
                          </span>
                          <span className="block text-muted-foreground text-xs">
                            {resource.driverName || "-"}
                            {resource.driverPhone && ` ${resource.driverPhone}`}
                          </span>
                        </>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {resource.linkedDemandCount > 0 ? (
                        `${resource.linkedDemandCount} 条`
                      ) : (
                        <span className="text-muted-foreground text-xs">
                          活动通用
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {bindable(resource.resourceType) ? (
                        `${resource.boundMemberCount} 人`
                      ) : (
                        <span className="text-muted-foreground text-xs">
                          不绑人
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          "border",
                          RESOURCE_STATUS_CHIP[resource.status],
                        )}
                      >
                        {RESOURCE_STATUS_LABELS[resource.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-primary hover:text-primary"
                          onClick={() => {
                            setEditingId(resource.id);
                            setFormOpen(true);
                          }}
                        >
                          修改
                        </Button>
                        {bindable(resource.resourceType) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-primary hover:text-primary"
                            onClick={() => setMemberResourceId(resource.id)}
                          >
                            服务名单
                          </Button>
                        )}
                        {/* 只禁用正在提交的那一行 */}
                        <Button
                          variant="ghost"
                          size="sm"
                          className={cn(
                            voided
                              ? "text-primary hover:text-primary"
                              : "text-destructive hover:text-destructive",
                          )}
                          disabled={
                            statusMutation.isPending &&
                            statusMutation.variables?.id === resource.id
                          }
                          onClick={() => statusMutation.mutate(resource)}
                        >
                          {voided ? "恢复" : "作废"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-muted-foreground text-sm">
            共 {total} 条 · 第 {search.page} / {totalPages} 页
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={search.page <= 1}
              onClick={() =>
                navigate({ search: (prev) => ({ ...prev, page: prev.page - 1 }) })
              }
            >
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={search.page >= totalPages}
              onClick={() =>
                navigate({ search: (prev) => ({ ...prev, page: prev.page + 1 }) })
              }
            >
              下一页
            </Button>
          </div>
        </div>
      )}

      <ResourceFormDialog
        open={formOpen}
        resource={editingId ? editingQuery.data : undefined}
        demands={linkableDemands}
        prefillDemand={editingId ? undefined : prefillDemand}
        submitting={saveMutation.isPending}
        onOpenChange={closeForm}
        onSubmit={(values) => saveMutation.mutate(values)}
      />

      <ResourceMembersDialog
        resourceId={memberResourceId}
        activityId={activityId}
        open={!!memberResourceId}
        onOpenChange={(open) => {
          if (!open) setMemberResourceId(undefined);
        }}
      />
    </div>
  );
}

function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="font-semibold text-2xl tabular-nums">{value}</p>
      <p className="text-muted-foreground text-xs">{hint}</p>
    </div>
  );
}
