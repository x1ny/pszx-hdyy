import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  LayoutDashboardIcon,
  Loader2Icon,
  PlusIcon,
  SaveIcon,
  SofaIcon,
  TriangleAlertIcon,
  WandSparklesIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { canvasEditor } from "#/features/venue-editor/canvas";
import type {
  SeatKind,
  SeatRank,
  ZoneKind,
} from "#/features/venue-editor/contract";
import { structuralEditor } from "#/features/venue-editor/structural";
import {
  docFromProjection,
  generateSeats,
  nextExternalId,
  type StructuralDoc,
  validateDoc,
} from "#/features/venue-editor/structural/model";
import { Badge } from "#/shared/components/ui/badge.tsx";
import { Button, buttonVariants } from "#/shared/components/ui/button.tsx";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "#/shared/components/ui/dialog.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "#/shared/components/ui/empty.tsx";
import { Field, FieldLabel } from "#/shared/components/ui/field.tsx";
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
import { CanvasEditorView } from "./-components/canvas-editor-view";
import {
  saveVenueLayout,
  type VenueLayoutBundle,
  venueKeys,
  venueLayoutQueryOptions,
} from "./-queries";
import {
  bundleToProjection,
  SEAT_KIND_LABELS,
  SEAT_KIND_VALUES,
  SEAT_RANK_BADGE_CLASS,
  SEAT_RANK_LABELS,
  SEAT_RANK_VALUES,
  ZONE_KIND_BADGE_CLASS,
  ZONE_KIND_LABELS,
  ZONE_KIND_VALUES,
} from "./-utils";

export const Route = createFileRoute("/_authenticated/venue/$venueId/layout")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(
      venueLayoutQueryOptions(Number(params.venueId)),
    ),
  component: VenueLayoutPage,
});

function VenueLayoutPage() {
  const { venueId } = Route.useParams();
  const id = Number(venueId);
  const queryClient = useQueryClient();
  /** 用户在表单式编辑器里点了"改用平面图"。只能升不能降，所以是个单向开关。 */
  const [upgraded, setUpgraded] = useState(false);

  const layoutQuery = useQuery(venueLayoutQueryOptions(id));

  if (layoutQuery.isPending) {
    return (
      <div className="flex flex-1 flex-col gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!layoutQuery.data) {
    return <div className="text-muted-foreground">场地不存在。</div>;
  }

  const bundle = layoutQuery.data;
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: venueKeys.all });

  /**
   * 用哪个编辑器打开，由场地已存的 `rendererKind` 决定——这就是
   * docs/场地排位底层设计.md §4 那套契约买到的东西：两个实现共存，
   * 核心表、状态机、级联规则一行都不用改。
   *
   * - 画布写的 → 画布
   * - 表单式写的 → 表单（可手动升级到画布，见下）
   * - 全新场地（没有 blob）→ **画布**，它是功能更全的那个
   * - 认不出的 kind → 表单，它同时是降级视图（§9）
   */
  const storedKind = bundle.layout?.rendererKind ?? null;
  const preferCanvas = storedKind === canvasEditor.kind || storedKind === null;

  return preferCanvas || upgraded ? (
    // key 让换场地时整个编辑器重新挂载，草稿不会串到下一个场地。
    <CanvasEditorView
      key={id}
      venueId={id}
      bundle={bundle}
      onSaved={invalidate}
    />
  ) : (
    <LayoutEditorView
      key={id}
      venueId={id}
      bundle={bundle}
      onSaved={invalidate}
      onUpgradeToCanvas={() => setUpgraded(true)}
    />
  );
}

function LayoutEditorView({
  venueId,
  bundle,
  onSaved,
  onUpgradeToCanvas,
}: {
  venueId: number;
  bundle: VenueLayoutBundle;
  onSaved: () => void;
  onUpgradeToCanvas: () => void;
}) {
  /**
   * 初始文档的来源有三条，优先级从高到低：
   *
   * 1. blob 是本编辑器写的，且能解析 → 直接用
   * 2. 其它情况（blob 为空、是别的渲染器写的、解析失败）→ **从服务端返回的
   *    区域和位置反推**
   *
   * 第 2 条就是降级视图（docs/场地排位底层设计.md §9）：核心表里的结构足够重建
   * 这个编辑器的全部状态，不依赖 blob 里的任何一个字节。这正是"结构落成关系行、
   * 不只留在 blob 里"换来的能力，也是整份可替换性设计的验收标准。
   */
  const storedKind = bundle.layout?.rendererKind ?? null;
  const parsed =
    storedKind === structuralEditor.kind
      ? structuralEditor.safeParse(bundle.layout?.data)
      : null;
  const fellBack = parsed === null && (bundle.zones.length > 0 || !!storedKind);

  const initialDoc = parsed ?? docFromProjection(bundleToProjection(bundle));

  const [doc, setDoc] = useState<StructuralDoc>(initialDoc);
  const [dirty, setDirty] = useState(false);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(
    initialDoc.zones[0]?.externalId ?? null,
  );
  const [generateOpen, setGenerateOpen] = useState(false);

  const update = (next: StructuralDoc) => {
    setDoc(next);
    setDirty(true);
  };

  const issues = useMemo(() => validateDoc(doc), [doc]);

  const seatsByZone = useMemo(() => {
    const map = new Map<string, typeof doc.seats>();
    for (const seat of doc.seats) {
      const list = map.get(seat.zoneExternalId) ?? [];
      list.push(seat);
      map.set(seat.zoneExternalId, list);
    }
    return map;
  }, [doc.seats]);

  const selectedZone = doc.zones.find(
    (zone) => zone.externalId === selectedZoneId,
  );
  const selectedSeats = selectedZoneId
    ? (seatsByZone.get(selectedZoneId) ?? [])
    : [];

  const saveMutation = useMutation({
    mutationFn: () => {
      const projection = structuralEditor.project(doc);
      return saveVenueLayout({
        venueId,
        layout: {
          rendererKind: structuralEditor.kind,
          rendererVersion: structuralEditor.version,
          data: doc,
        },
        zones: projection.zones,
        seats: projection.seats,
      });
    },
    onSuccess: (result) => {
      setDirty(false);
      const { zones, seats } = result;
      toast.success(
        `已保存：区域 +${zones.added}/~${zones.updated}/-${zones.removed}，` +
          `位置 +${seats.added}/~${seats.updated}/-${seats.removed}`,
      );
      onSaved();
    },
    onError: (error) => toast.error(error.message),
  });

  const addZone = () => {
    const externalId = nextExternalId("z");
    update({
      ...doc,
      zones: [
        ...doc.zones,
        {
          externalId,
          name: `区域 ${doc.zones.length + 1}`,
          kind: "seating",
          ordinal: doc.zones.length,
        },
      ],
    });
    setSelectedZoneId(externalId);
  };

  const patchZone = (
    externalId: string,
    patch: Partial<StructuralDoc["zones"][number]>,
  ) =>
    update({
      ...doc,
      zones: doc.zones.map((zone) =>
        zone.externalId === externalId ? { ...zone, ...patch } : zone,
      ),
    });

  const removeZone = (externalId: string) => {
    // 区域下的位置一起走：数据库那边是 cascade，这里保持一致，
    // 否则保存时会因为"位置指向了不存在的区域"被服务端挡回来。
    update({
      ...doc,
      zones: doc.zones.filter((zone) => zone.externalId !== externalId),
      seats: doc.seats.filter((seat) => seat.zoneExternalId !== externalId),
    });
    if (selectedZoneId === externalId) setSelectedZoneId(null);
  };

  const patchSeat = (
    externalId: string,
    patch: Partial<StructuralDoc["seats"][number]>,
  ) =>
    update({
      ...doc,
      seats: doc.seats.map((seat) =>
        seat.externalId === externalId ? { ...seat, ...patch } : seat,
      ),
    });

  const removeSeat = (externalId: string) =>
    update({
      ...doc,
      seats: doc.seats.filter((seat) => seat.externalId !== externalId),
    });

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            to="/venue"
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon" }),
              "text-muted-foreground",
            )}
            aria-label="返回场地列表"
          >
            <ArrowLeftIcon />
          </Link>
          <div>
            <h1 className="font-semibold text-xl tracking-tight">
              {bundle.venue.name}
            </h1>
            <p className="text-muted-foreground text-sm">
              区域与位置 · {doc.zones.length} 个区域 · {doc.seats.length} 个位置
              {dirty && (
                <span className="ml-2 text-warning-foreground">
                  有未保存的修改
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* 表单 → 画布是唯一允许的 rendererKind 变更方向（底层设计 §4）：
              结构里没有几何，画布可以给它编一套。反过来会丢掉全部坐标，所以
              画布页没有"改用表单"这个按钮。 */}
          <Button
            variant="outline"
            disabled={dirty}
            title={dirty ? "先保存当前修改" : undefined}
            onClick={onUpgradeToCanvas}
          >
            <LayoutDashboardIcon />
            改用平面图
          </Button>
          <Button
            disabled={saveMutation.isPending || issues.length > 0 || !dirty}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <SaveIcon />
            )}
            保存
          </Button>
        </div>
      </div>

      {fellBack && (
        <Banner>
          这个场地的画布数据不是本编辑器写的（渲染器：{storedKind ?? "无"}），
          当前显示的是从已保存的区域和位置反推出来的结构。在这里保存会把画布改写成表单式结构。
        </Banner>
      )}

      {issues.length > 0 && (
        <Banner tone="error">
          <ul className="list-inside list-disc">
            {issues.slice(0, 5).map((issue) => (
              <li key={issue.message}>{issue.message}</li>
            ))}
            {issues.length > 5 && <li>还有 {issues.length - 5} 处问题…</li>}
          </ul>
        </Banner>
      )}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[20rem_1fr]">
        {/* 区域列表 */}
        <div className="flex flex-col rounded-lg border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <span className="font-medium text-sm">区域</span>
            <Button
              variant="ghost"
              size="sm"
              className="text-primary hover:text-primary"
              onClick={addZone}
            >
              <PlusIcon />
              新增
            </Button>
          </div>
          <div className="flex flex-col gap-1 overflow-y-auto p-2">
            {doc.zones.length === 0 ? (
              <p className="px-2 py-6 text-center text-muted-foreground text-sm">
                还没有区域，先新增一个。
              </p>
            ) : (
              doc.zones.map((zone) => {
                const count = seatsByZone.get(zone.externalId)?.length ?? 0;
                const active = zone.externalId === selectedZoneId;
                return (
                  <button
                    key={zone.externalId}
                    type="button"
                    onClick={() => setSelectedZoneId(zone.externalId)}
                    className={cn(
                      "flex cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
                      active ? "bg-primary/10 text-primary" : "hover:bg-muted",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{zone.name}</span>
                    <Badge className={ZONE_KIND_BADGE_CLASS[zone.kind]}>
                      {ZONE_KIND_LABELS[zone.kind]}
                    </Badge>
                    <span className="tabular-nums text-muted-foreground text-xs">
                      {count}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* 选中区域的明细 */}
        <div className="flex min-w-0 flex-col rounded-lg border bg-card shadow-sm">
          {!selectedZone ? (
            <Empty className="border-0 py-16">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SofaIcon />
                </EmptyMedia>
                <EmptyTitle>选一个区域</EmptyTitle>
                <EmptyDescription>
                  左边选中区域后，在这里维护它的名称、类型和位置。
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-3 border-b p-4">
                <Field className="w-56">
                  <FieldLabel htmlFor="zone-name">区域名称</FieldLabel>
                  <Input
                    id="zone-name"
                    value={selectedZone.name}
                    onChange={(event) =>
                      patchZone(selectedZone.externalId, {
                        name: event.target.value,
                      })
                    }
                  />
                </Field>
                <Field className="w-36">
                  <FieldLabel>区域类型</FieldLabel>
                  <Select
                    items={ZONE_KIND_LABELS}
                    value={selectedZone.kind}
                    onValueChange={(value) =>
                      patchZone(selectedZone.externalId, {
                        kind: value as ZoneKind,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ZONE_KIND_VALUES.map((value) => (
                        <SelectItem key={value} value={value}>
                          {ZONE_KIND_LABELS[value]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <div className="ml-auto flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-primary hover:text-primary"
                    onClick={() => setGenerateOpen(true)}
                  >
                    <WandSparklesIcon />
                    批量生成位置
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => removeZone(selectedZone.externalId)}
                  >
                    删除区域
                  </Button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {selectedSeats.length === 0 ? (
                  <Empty className="border-0 py-12">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <SofaIcon />
                      </EmptyMedia>
                      <EmptyTitle>这个区域还没有位置</EmptyTitle>
                      <EmptyDescription>
                        用「批量生成位置」按编号规则一次建好，比一个个加快得多。
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : (
                  <Table>
                    <TableHeader className="sticky top-0 bg-muted/60">
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="w-40">编号</TableHead>
                        <TableHead className="w-32">种类</TableHead>
                        <TableHead className="w-32">等级</TableHead>
                        <TableHead className="w-20">顺序</TableHead>
                        <TableHead className="text-center">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedSeats.map((seat) => (
                        <TableRow key={seat.externalId}>
                          <TableCell>
                            <Input
                              className="h-8"
                              value={seat.label}
                              onChange={(event) =>
                                patchSeat(seat.externalId, {
                                  label: event.target.value,
                                })
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Select
                              items={SEAT_KIND_LABELS}
                              value={seat.kind}
                              onValueChange={(value) =>
                                patchSeat(seat.externalId, {
                                  kind: value as SeatKind,
                                })
                              }
                            >
                              <SelectTrigger size="sm">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {SEAT_KIND_VALUES.map((value) => (
                                  <SelectItem key={value} value={value}>
                                    {SEAT_KIND_LABELS[value]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Select
                              items={SEAT_RANK_LABELS}
                              value={seat.rank}
                              onValueChange={(value) =>
                                patchSeat(seat.externalId, {
                                  rank: value as SeatRank,
                                })
                              }
                            >
                              <SelectTrigger size="sm">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {SEAT_RANK_VALUES.map((value) => (
                                  <SelectItem key={value} value={value}>
                                    {SEAT_RANK_LABELS[value]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="tabular-nums text-muted-foreground">
                            {seat.ordinal}
                          </TableCell>
                          <TableCell className="text-center">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => removeSeat(seat.externalId)}
                            >
                              删除
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {selectedZone && (
        <GenerateSeatsDialog
          open={generateOpen}
          zoneName={selectedZone.name}
          onOpenChange={setGenerateOpen}
          onSubmit={(input) => {
            const created = generateSeats({
              zoneExternalId: selectedZone.externalId,
              ...input,
              existing: doc.seats,
            });
            if (created.length === 0) {
              toast.warning("这些编号都已经存在了，没有新增");
              return;
            }
            update({ ...doc, seats: [...doc.seats, ...created] });
            setGenerateOpen(false);
            toast.success(`已生成 ${created.length} 个位置`);
          }}
        />
      )}
    </div>
  );
}

function Banner({
  children,
  tone = "warning",
}: {
  children: React.ReactNode;
  tone?: "warning" | "error";
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border px-4 py-3 text-sm",
        tone === "error"
          ? "border-destructive/30 bg-destructive/5 text-destructive"
          : "border-warning/30 bg-warning/10 text-warning-foreground",
      )}
    >
      <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function GenerateSeatsDialog({
  open,
  zoneName,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  zoneName: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: {
    prefix: string;
    start: number;
    count: number;
    kind: SeatKind;
    rank: SeatRank;
  }) => void;
}) {
  const [prefix, setPrefix] = useState("A");
  const [start, setStart] = useState(1);
  const [count, setCount] = useState(20);
  const [kind, setKind] = useState<SeatKind>("seat");
  const [rank, setRank] = useState<SeatRank>("normal");

  const preview =
    count > 0 ? `${prefix}${start} … ${prefix}${start + count - 1}` : "-";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader
          title="批量生成位置"
          description={`在「${zoneName}」里按编号规则一次生成多个位置。`}
        />
        <DialogBody className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-3">
            <Field>
              <FieldLabel htmlFor="gen-prefix">编号前缀</FieldLabel>
              <Input
                id="gen-prefix"
                value={prefix}
                onChange={(event) => setPrefix(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="gen-start">起始序号</FieldLabel>
              <Input
                id="gen-start"
                type="number"
                min={0}
                value={start}
                onChange={(event) => setStart(Number(event.target.value) || 0)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="gen-count">数量</FieldLabel>
              <Input
                id="gen-count"
                type="number"
                min={1}
                max={2000}
                value={count}
                onChange={(event) => setCount(Number(event.target.value) || 0)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel>种类</FieldLabel>
              <Select
                items={SEAT_KIND_LABELS}
                value={kind}
                onValueChange={(value) => setKind(value as SeatKind)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEAT_KIND_VALUES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {SEAT_KIND_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>等级</FieldLabel>
              <Select
                items={SEAT_RANK_LABELS}
                value={rank}
                onValueChange={(value) => setRank(value as SeatRank)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEAT_RANK_VALUES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {SEAT_RANK_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <p className="text-muted-foreground text-sm">
            将生成{" "}
            <span className="font-medium text-foreground">{preview}</span>
            ，已存在的编号会自动跳过。
            <Badge className={cn("ml-2", SEAT_RANK_BADGE_CLASS[rank])}>
              {SEAT_RANK_LABELS[rank]}
            </Badge>
          </p>
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            type="button"
            disabled={count <= 0 || !prefix.trim()}
            onClick={() =>
              onSubmit({ prefix: prefix.trim(), start, count, kind, rank })
            }
          >
            生成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
