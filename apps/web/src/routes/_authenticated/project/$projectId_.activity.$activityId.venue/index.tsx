import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ChevronDownIcon,
  LayoutGridIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { parseSpaceLayout, SpaceMap } from "#/features/venue-editor/space-map";
import { Badge } from "#/shared/components/ui/badge.tsx";
import { Button, buttonVariants } from "#/shared/components/ui/button.tsx";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "#/shared/components/ui/collapsible.tsx";
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
import { ZONE_KIND_LABELS } from "../../venue/-utils";
import { ActivityVenueImportDialog } from "../-components/activity-venue-import-dialog";
import { ActivityZoneDialog } from "../-components/activity-zone-dialog";
import {
  type ActivityVenueRow,
  type ActivityVenueZoneRow,
  activityVenueKeys,
  activityVenueListQueryOptions,
  activityVenueStatsQueryOptions,
  importActivityVenue,
  removeActivityVenue,
  type UpdateActivityVenueZoneInput,
  updateActivityVenueZone,
  zoneUsageQueryOptions,
} from "../-venue-queries";
import {
  ACTIVITY_VENUE_STATUS_CHIP,
  ACTIVITY_VENUE_STATUS_LABELS,
  ZONE_PURPOSE_LABELS,
} from "../-venue-utils";

export const Route = createFileRoute(
  "/_authenticated/project/$projectId_/activity/$activityId/venue/",
)({
  component: ActivityVenuePage,
});

/**
 * 活动场地空间。
 *
 * 三层里的**中间那层**（docs/场地排位模块.md §2）：场地库是跨活动复用的物理
 * 底图，环节排位是"谁坐哪"，这一层回答的是"本活动用哪些空间、每块派什么用途"。
 *
 * 它是**一份拷贝，不是一条关联**：从场地库引用之后，名称、区域、几何全部
 * 独立，场地库那边再改也不影响这里。代价是上游改动不会自动流下来——那正是
 * 要买的东西，否则已确认的排位会静默变形。
 */
function ActivityVenuePage() {
  const { projectId, activityId: activityIdParam } = Route.useParams();
  const activityId = Number(activityIdParam);
  const queryClient = useQueryClient();

  const listQuery = useQuery(activityVenueListQueryOptions(activityId));
  const statsQuery = useQuery(activityVenueStatsQueryOptions(activityId));
  // 「被排位引用」来自 seating——venue 不认识排位，这个数只能它自己给。
  const usageQuery = useQuery(zoneUsageQueryOptions(activityId));

  const [importOpen, setImportOpen] = useState(false);
  const [editingZone, setEditingZone] = useState<ActivityVenueZoneRow | null>(
    null,
  );
  const [selectedExternalId, setSelectedExternalId] = useState<string | null>(
    null,
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: activityVenueKeys.all });
  };

  const importMutation = useMutation({
    mutationFn: (venueId: number) => importActivityVenue(activityId, venueId),
    onSuccess: (result) => {
      toast.success(
        `已引用「${result.venue.name}」，拷贝了 ${result.zones} 个区域`,
      );
      setImportOpen(false);
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const removeMutation = useMutation({
    mutationFn: removeActivityVenue,
    onSuccess: () => {
      toast.success("已移除这个场地");
      invalidate();
    },
    onError: () =>
      // 数据库那边有排位方案引用时会报外键冲突，翻译成人话。
      toast.error(
        "移除失败。这个场地下面可能还有区域正被环节排位引用，请先作废那些方案",
      ),
  });

  const updateZoneMutation = useMutation({
    mutationFn: (values: UpdateActivityVenueZoneInput) =>
      updateActivityVenueZone(values),
    onSuccess: () => {
      toast.success("活动区域已保存");
      setEditingZone(null);
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const bundle = listQuery.data;

  /** 区域按场地分组，画布那一栏按场地一段段折叠显示。 */
  const zonesByVenue = useMemo(() => {
    const map = new Map<number, ActivityVenueZoneRow[]>();
    for (const zone of bundle?.zones ?? []) {
      const list = map.get(zone.activityVenueId) ?? [];
      list.push(zone);
      map.set(zone.activityVenueId, list);
    }
    return map;
  }, [bundle?.zones]);

  const layoutByVenue = useMemo(
    () =>
      new Map((bundle?.layouts ?? []).map((row) => [row.activityVenueId, row])),
    [bundle?.layouts],
  );

  /** 区域 id → 引用它的环节名。原型那一列叫「引用环节」。 */
  const usageByZone = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const row of usageQuery.data?.list ?? []) {
      const list = map.get(row.activityVenueZoneId) ?? [];
      list.push(row.segmentName);
      map.set(row.activityVenueZoneId, list);
    }
    return map;
  }, [usageQuery.data]);

  const venueNameById = useMemo(
    () => new Map((bundle?.venues ?? []).map((v) => [v.id, v.name])),
    [bundle?.venues],
  );

  if (listQuery.isLoading) {
    return <Skeleton className="h-96 w-full" />;
  }

  const venues = bundle?.venues ?? [];
  const zones = bundle?.zones ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-lg tracking-tight">场地空间</h2>
          <p className="text-muted-foreground text-sm">
            已引用 {venues.length} 个场地 · 共 {zones.length} 个活动区域
          </p>
        </div>
        <Button onClick={() => setImportOpen(true)}>
          <PlusIcon />
          从场地库引用
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="引用场地"
          value={statsQuery.data?.venues ?? 0}
          hint={venues[0] ? `${venues[0].name} 等` : "还没有引用场地"}
        />
        <StatCard
          label="活动区域"
          value={statsQuery.data?.zones ?? 0}
          hint="跨场地汇总，可按活动调整用途"
        />
        <StatCard
          label="可用点位"
          value={statsQuery.data?.capacity ?? 0}
          // 这是**手填的规划值**，不是画布里实际有多少座位——两者可以不一样，
          // 而且改画布不会自动更新它。副标题必须说清楚，否则看统计卡的人会
          // 把它当实测数（评审 §3.12）。
          hint="启用区域的规划值，与实际座位数可能不同"
        />
        <StatCard
          label="被排位引用"
          value={usageByZone.size}
          hint={
            usageQuery.data?.list.length
              ? [...new Set(usageQuery.data.list.map((r) => r.segmentName))]
                  .slice(0, 3)
                  .join("、")
              : "还没有环节引用"
          }
        />
      </div>

      {venues.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <LayoutGridIcon className="size-8 text-muted-foreground/40" />
          <div>
            <p className="font-medium text-sm">还没有引用任何场地</p>
            <p className="text-muted-foreground text-sm">
              普通环节的地点直接在环节里填文本就行；需要排位时再来这里引用场地。
            </p>
          </div>
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <PlusIcon />
            从场地库引用
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* 左：活动空间画布，按场地分段 */}
          <section className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm">
            <h3 className="font-medium text-sm">活动空间画布</h3>
            <div className="flex flex-col gap-3">
              {venues.map((venue) => (
                <VenueSection
                  key={venue.id}
                  venue={venue}
                  zones={zonesByVenue.get(venue.id) ?? []}
                  layout={layoutByVenue.get(venue.id) ?? null}
                  selectedExternalId={selectedExternalId}
                  onSelectZone={setSelectedExternalId}
                  projectId={projectId}
                  activityId={activityIdParam}
                  onRemove={() => {
                    if (
                      !window.confirm(
                        `移除「${venue.name}」？它下面的 ${
                          (zonesByVenue.get(venue.id) ?? []).length
                        } 个活动区域会一起删除。`,
                      )
                    ) {
                      return;
                    }
                    removeMutation.mutate(venue.id);
                  }}
                  removing={removeMutation.isPending}
                />
              ))}
            </div>
          </section>

          {/* 右：区域列表 */}
          <section className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm">
            <h3 className="font-medium text-sm">区域列表</h3>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>活动区域</TableHead>
                    <TableHead>来源</TableHead>
                    <TableHead>活动用途</TableHead>
                    <TableHead className="text-right">可用点位</TableHead>
                    <TableHead>引用环节</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {zones.map((zone) => {
                    const segments = usageByZone.get(zone.id) ?? [];
                    return (
                      <TableRow
                        key={zone.id}
                        data-state={
                          zone.externalId === selectedExternalId
                            ? "selected"
                            : undefined
                        }
                        onClick={() => setSelectedExternalId(zone.externalId)}
                        className="cursor-pointer"
                      >
                        <TableCell className="font-medium">
                          {zone.name}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {venueNameById.get(zone.activityVenueId) ?? "-"}
                          <span className="block">
                            {ZONE_KIND_LABELS[zone.kind]}
                          </span>
                        </TableCell>
                        <TableCell>
                          {ZONE_PURPOSE_LABELS[zone.purpose]}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {zone.capacity}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {segments.length ? segments.join("、") : "-"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn(
                              "border",
                              ACTIVITY_VENUE_STATUS_CHIP[zone.status],
                            )}
                          >
                            {ACTIVITY_VENUE_STATUS_LABELS[zone.status]}
                          </Badge>
                        </TableCell>
                        <TableCell
                          className="text-right"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingZone(zone)}
                            >
                              编辑
                            </Button>
                            {/* 只有正常状态的区域能排位——禁用的区域本活动不用。 */}
                            {zone.status === "active" && (
                              <Link
                                to="/project/$projectId/activity/$activityId/seating"
                                params={{
                                  projectId,
                                  activityId: activityIdParam,
                                }}
                                // 带上区域上下文——排位页会提示来源，选区域的
                                // 弹窗也会把这块区域顶到第一个（评审 §3.6）。
                                search={{ zoneId: zone.id }}
                                className={cn(
                                  buttonVariants({
                                    variant: "ghost",
                                    size: "sm",
                                  }),
                                )}
                              >
                                排位
                              </Link>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </section>
        </div>
      )}

      <ActivityVenueImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        importedVenueIds={venues.flatMap((v) =>
          v.sourceVenueId === null ? [] : [v.sourceVenueId],
        )}
        pending={importMutation.isPending}
        onImport={(venueId) => importMutation.mutate(venueId)}
      />

      <ActivityZoneDialog
        zone={editingZone}
        venueName={
          editingZone
            ? (venueNameById.get(editingZone.activityVenueId) ?? "")
            : ""
        }
        pending={updateZoneMutation.isPending}
        onOpenChange={(open) => !open && setEditingZone(null)}
        onSubmit={(values) => updateZoneMutation.mutate(values)}
      />
    </div>
  );
}

function StatCard({
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
      <p className="text-muted-foreground text-sm">{label}</p>
      <p className="font-semibold text-3xl tabular-nums">{value}</p>
      <p className="truncate text-muted-foreground text-xs">{hint}</p>
    </div>
  );
}

/** 一个场地一段：标题栏 + 可折叠的分布图。 */
function VenueSection({
  venue,
  zones,
  layout,
  selectedExternalId,
  onSelectZone,
  onRemove,
  removing,
  projectId,
  activityId,
}: {
  venue: ActivityVenueRow;
  zones: ActivityVenueZoneRow[];
  layout: { data: unknown } | null;
  selectedExternalId: string | null;
  onSelectZone: (externalId: string) => void;
  onRemove: () => void;
  removing: boolean;
  projectId: string;
  activityId: string;
}) {
  const doc = useMemo(
    () => (layout ? parseSpaceLayout(layout.data) : null),
    [layout],
  );

  const capacity = zones
    .filter((zone) => zone.status === "active")
    .reduce((sum, zone) => sum + zone.capacity, 0);

  return (
    <Collapsible defaultOpen className="group/venue rounded-lg border">
      <div className="flex items-center gap-2 px-3 py-2">
        <CollapsibleTrigger
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "-ml-1 flex-1 justify-start gap-2",
          )}
        >
          {/* 收起时朝右，展开时朝下。data-open 打在 Root 上，所以要靠
              group/venue 跨层选择——同 app/layout/nav-main.tsx 的写法。 */}
          <ChevronDownIcon className="-rotate-90 size-4 transition-transform duration-200 group-data-open/venue:rotate-0" />
          <span className="truncate font-medium text-sm">{venue.name}</span>
          <span className="shrink-0 text-muted-foreground text-xs">
            {zones.length} 个区域 / {capacity} 点位
          </span>
        </CollapsibleTrigger>
        {/* 只读预览到此为止——真要动区域形状、颜色、座位布局，进编辑页。
            那边复用的就是场地库自己的画布编辑器（PencilIcon 打开）。 */}
        <Link
          to="/project/$projectId/activity/$activityId/venue/$activityVenueId"
          params={{ projectId, activityId, activityVenueId: String(venue.id) }}
          className={cn(
            buttonVariants({ variant: "ghost", size: "icon-sm" }),
            "text-muted-foreground",
          )}
          title="编辑这个场地的平面图"
        >
          <PencilIcon className="size-3.5" />
        </Link>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={removing}
          title="移除这个场地"
          onClick={onRemove}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2Icon className="size-3.5" />
        </Button>
      </div>
      <CollapsibleContent>
        <div className="h-56 border-t p-2">
          {doc ? (
            <SpaceMap
              doc={doc}
              zones={zones.map((zone) => ({
                externalId: zone.externalId,
                name: zone.name,
                caption: `${ZONE_PURPOSE_LABELS[zone.purpose]} / ${zone.capacity}`,
                disabled: zone.status === "disabled",
              }))}
              selectedExternalId={selectedExternalId}
              onSelect={onSelectZone}
            />
          ) : (
            // 源场地根本没画过平面图时会走到这里。区域数据都在，只是没有几何
            // 可画——右边的表格照样能用，排位也照常能建。
            <div className="flex h-full items-center justify-center text-center text-muted-foreground text-sm">
              这个场地在场地库里没有平面图，只有区域清单
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
