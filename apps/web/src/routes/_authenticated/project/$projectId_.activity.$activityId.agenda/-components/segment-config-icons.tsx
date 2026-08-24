import {
  ArmchairIcon,
  BedDoubleIcon,
  CarFrontIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  type LucideIcon,
  PackageIcon,
  UsersRoundIcon,
  UtensilsIcon,
} from "lucide-react";
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
import type { Segment } from "../-queries";

type ConfigIconItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  problem: boolean;
};

const RESOURCE_ICONS = {
  transport: CarFrontIcon,
  dining: UtensilsIcon,
  accommodation: BedDoubleIcon,
  material: PackageIcon,
} as const satisfies Record<ResourceType, LucideIcon>;

const PROBLEM_DEMAND_STATUSES = new Set<DemandStatus>([
  "pending",
  "configuring",
]);

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
      icon: UsersRoundIcon,
      problem: !configured,
    });
  }

  if (segment.seatingEnabled) {
    items.push({
      key: "seating",
      label: `排位：${seatingStatus ? PLAN_STATUS_LABELS[seatingStatus] : "未配置"}`,
      icon: ArmchairIcon,
      problem: seatingStatus !== "confirmed",
    });
  }

  for (const demand of demands) {
    items.push({
      key: `resource-${demand.id}`,
      label: `${RESOURCE_TYPE_LABELS[demand.resourceType]}：${DEMAND_STATUS_LABELS[demand.status]}`,
      icon: RESOURCE_ICONS[demand.resourceType],
      problem: PROBLEM_DEMAND_STATUSES.has(demand.status),
    });
  }

  return items;
}

/**
 * 环节已开启能力的紧凑状态图标。
 *
 * 类型图标回答“是什么”，右下角只保留“有问题 / 没问题”两态；有问题时再用
 * Tooltip 给具体原因。时间轴最窄的块里也只占一行，不再塞“人员未配置 /
 * 排位待确认”长句。
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
    <div className={cn("flex shrink-0 items-center gap-1.5", className)}>
      {items.map((item) => {
        const Icon = item.icon;
        const StateIcon = item.problem ? CircleAlertIcon : CircleCheckIcon;
        const trigger = (
          <span
            className={cn(
              "relative inline-flex size-3.5 shrink-0 items-center justify-center rounded-sm border",
              item.problem
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : "border-success/40 bg-success/10 text-success-foreground",
            )}
            aria-label={item.label}
            role="img"
          >
            <Icon className="size-2.5" aria-hidden="true" />
            <StateIcon
              className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-background"
              aria-hidden="true"
            />
          </span>
        );

        if (!item.problem) return <span key={item.key}>{trigger}</span>;

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
