import { useQuery } from "@tanstack/react-query";
import { ArmchairIcon, ExternalLinkIcon } from "lucide-react";
import { useMemo } from "react";
import { canvasEditor } from "#/features/venue-editor/canvas";
import { buildPlanSeatStatus } from "#/features/venue-editor/canvas/seat-occupant-visual";
import { buildSeatingPlanSvg } from "#/features/venue-editor/canvas/seating-plan-jpeg";
import { Badge } from "#/shared/components/ui/badge.tsx";
import { Button } from "#/shared/components/ui/button.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "#/shared/components/ui/empty.tsx";
import { Skeleton } from "#/shared/components/ui/skeleton.tsx";
import { cn } from "#/shared/lib/utils.ts";
import { formatDateTime } from "../../../venue/-utils";
import {
  seatingPlanQueryOptions,
  seatingPlansQueryOptions,
} from "../../-venue-queries";
import { PLAN_STATUS_CHIP, PLAN_STATUS_LABELS } from "../../-venue-utils";
import { SectionCard } from "./section-card";

/**
 * 排位配置。**只读**——调座位仍然在排位页做（Q：排位比较特殊，只做展示）。
 *
 * 座位图直接用 `buildSeatingPlanSvg()` 渲染成一张静态 SVG。它本来是给导出
 * JPEG 用的，拿来做只读预览正合适：不用把排位页那套画布交互（选中、拖拽、
 * 团体批量）搬过来，也就不会出现"两个页面上同一个方案长得不一样"。
 *
 * 「去修改」跳走前会先保存整页——那个拦截在页面层做（useBlocker），不在这里。
 */
export function SeatingSection({
  enabled,
  segmentId,
  activityId,
  onToggle,
  onNavigate,
}: {
  enabled: boolean;
  /** 新建环节时还没有 id，这一块只能显示占位。 */
  segmentId: number | null;
  activityId: string;
  onToggle: (checked: boolean) => void;
  onNavigate: (to: { planId: number | null }) => void;
}) {
  const plansQuery = useQuery({
    ...seatingPlansQueryOptions(Number(activityId)),
    enabled: enabled && segmentId !== null,
  });

  const row = plansQuery.data?.list.find(
    (item) => item.segmentId === segmentId,
  );
  const planId = row?.plan?.id ?? null;

  const planQuery = useQuery({
    ...seatingPlanQueryOptions(planId ?? 0),
    enabled: planId !== null,
  });

  const svg = useMemo(() => {
    const bundle = planQuery.data;
    if (!bundle?.layout) return null;

    const doc = canvasEditor.safeParse(bundle.layout.data);
    if (!doc) return null;

    return buildSeatingPlanSvg({
      doc,
      seatStatus: buildPlanSeatStatus({
        seats: bundle.seats,
        assignments: bundle.assignments,
      }),
      title: bundle.plan.segmentName ?? "排位预览",
    }).svg;
  }, [planQuery.data]);

  return (
    <SectionCard
      id="section-seating"
      title="排位配置"
      description="这里只做展示，调整座位请到排位页。"
      toggle={{
        checked: enabled,
        label: "开启排位管理",
        keptSummary: planId === null ? "尚未建方案" : "已有排位方案",
        onChange: onToggle,
      }}
      summary={
        row?.plan ? (
          <Badge
            variant="outline"
            className={cn(PLAN_STATUS_CHIP[row.plan.status])}
          >
            {PLAN_STATUS_LABELS[row.plan.status]}
          </Badge>
        ) : undefined
      }
      actions={
        segmentId === null ? null : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onNavigate({ planId })}
          >
            <ExternalLinkIcon />
            {planId === null ? "去配置排位" : "去修改"}
          </Button>
        )
      }
    >
      {segmentId === null ? (
        <Empty className="border-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ArmchairIcon />
            </EmptyMedia>
            <EmptyTitle>保存后可配置</EmptyTitle>
            <EmptyDescription>
              排位方案要先引用一块场地区域，得等这个环节存在之后才能建。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : plansQuery.isPending || planQuery.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : planId === null ? (
        <Empty className="border-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ArmchairIcon />
            </EmptyMedia>
            <EmptyTitle>还没有排位方案</EmptyTitle>
            <EmptyDescription>
              到排位页选一块活动场地区域，就能把座位复制过来开始排。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-muted-foreground text-sm">
            引用区域：{planQuery.data?.plan.zoneName ?? "-"} ·{" "}
            {planQuery.data?.seats.length ?? 0} 个位置 · 已排{" "}
            {planQuery.data?.assignments.length ?? 0} 人
            {planQuery.data?.plan.savedAt
              ? ` · 最近保存 ${formatDateTime(planQuery.data.plan.savedAt)}`
              : null}
          </p>

          {svg ? (
            <div
              className="overflow-x-auto rounded-lg border bg-muted/20 p-3 [&_svg]:h-auto [&_svg]:max-w-full"
              // 这份 SVG 是本地构造的（buildSeatingPlanSvg 里所有文本都过
              // escapeXml），不是来自用户输入的富文本。
              // biome-ignore lint/security/noDangerouslySetInnerHtml: 本地生成的 SVG
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : (
            <p className="text-muted-foreground text-sm">
              这个方案还没有画布数据，去排位页看看。
            </p>
          )}
        </div>
      )}
    </SectionCard>
  );
}
