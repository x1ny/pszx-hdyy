import type { Segment } from "#/features/agenda/queries";
import {
  DEMAND_STATUS_LABELS,
  RESOURCE_TYPE_LABELS,
} from "#/features/resource/labels.ts";
import type {
  DemandStatus,
  ResourceDemand,
  ResourceType,
} from "#/features/resource/queries.ts";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#/shared/components/ui/tooltip.tsx";
import { cn } from "#/shared/lib/utils.ts";
import type { PlanStatus } from "../../-venue-queries";
import { PLAN_STATUS_LABELS } from "../../-venue-utils";

type ConfigIconItem = {
  key: string;
  label: string;
  mark: string;
  problem: boolean;
};

/** 时间轴上用一个字概括能力类型，留给完整标签和 Tooltip 说明状态。 */
const RESOURCE_MARKS = {
  transport: "车",
  dining: "餐",
  accommodation: "住",
  material: "物",
} as const satisfies Record<ResourceType, string>;

const PROBLEM_DEMAND_STATUSES = new Set<DemandStatus>([
  "pending",
  "configuring",
]);

/** 与参考页 `.res-ico` 保持一致的已就绪 / 待处理底色。 */
const MARK_BACKGROUNDS = {
  ready: "rgb(26, 158, 80)",
  pending: "rgb(179, 185, 194)",
} as const;

function buildItems({
  segment,
  memberCount,
  seatingStatus,
  demands,
}: {
  segment: Pick<Segment, "memberEnabled" | "seatingEnabled">;
  memberCount: number;
  seatingStatus?: PlanStatus | null;
  demands: readonly Pick<ResourceDemand, "id" | "resourceType" | "status">[];
}): ConfigIconItem[] {
  const items: ConfigIconItem[] = [];

  if (segment.memberEnabled) {
    const configured = memberCount > 0;
    items.push({
      key: "members",
      label: configured ? `人员：已配置 ${memberCount} 人` : "人员：未配置",
      mark: "人",
      problem: !configured,
    });
  }

  if (segment.seatingEnabled) {
    items.push({
      key: "seating",
      label: `排位：${seatingStatus ? PLAN_STATUS_LABELS[seatingStatus] : "未配置"}`,
      mark: "位",
      problem: seatingStatus !== "confirmed",
    });
  }

  for (const demand of demands) {
    items.push({
      key: `resource-${demand.id}`,
      label: `${RESOURCE_TYPE_LABELS[demand.resourceType]}：${DEMAND_STATUS_LABELS[demand.status]}`,
      mark: RESOURCE_MARKS[demand.resourceType],
      problem: PROBLEM_DEMAND_STATUSES.has(demand.status),
    });
  }

  return items;
}

/**
 * 环节已开启能力的紧凑状态文字标记。
 *
 * 单字标签回答“是什么”：已就绪为绿色，待处理为灰色；有问题时再用 Tooltip 给
 * 具体原因。时间轴最窄的块里也只占一行，不再塞“人员未配置 / 排位待确认”长句。
 */
export function SegmentConfigIcons({
  segment,
  memberCount = 0,
  seatingStatus,
  demands = [],
  className,
}: {
  segment: Pick<Segment, "memberEnabled" | "seatingEnabled">;
  memberCount?: number;
  seatingStatus?: PlanStatus | null;
  demands?: readonly Pick<ResourceDemand, "id" | "resourceType" | "status">[];
  className?: string;
}) {
  const items = buildItems({
    segment,
    memberCount,
    seatingStatus,
    demands,
  });

  if (items.length === 0) return null;

  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-1 @max-[5.5rem]:gap-[3px]",
        className,
      )}
    >
      {items.map((item) => {
        const trigger = (
          <span
            key={item.key}
            className="inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] font-normal text-[10px] leading-[15px] text-white @max-[5.5rem]:size-3.5 @max-[5.5rem]:rounded-[3px] @max-[5.5rem]:text-[9px] @max-[5.5rem]:leading-[13.5px]"
            style={{
              background: item.problem
                ? MARK_BACKGROUNDS.pending
                : MARK_BACKGROUNDS.ready,
            }}
            aria-label={item.label}
            role="img"
          >
            {item.mark}
          </span>
        );

        if (!item.problem) return trigger;

        return (
          <Tooltip key={item.key}>
            <TooltipTrigger render={trigger} />
            <TooltipContent side="top">{item.label}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
