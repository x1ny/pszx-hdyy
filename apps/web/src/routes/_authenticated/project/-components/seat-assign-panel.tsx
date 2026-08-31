import { useQuery } from "@tanstack/react-query";
import {
  Loader2Icon,
  SearchIcon,
  UserMinusIcon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react";
import { useState } from "react";
import { organizationSeatColor } from "#/features/venue-editor/canvas/seat-occupant-visual";
import { Badge } from "#/shared/components/ui/badge.tsx";
import { Button } from "#/shared/components/ui/button.tsx";
import { Input } from "#/shared/components/ui/input.tsx";
import { cn } from "#/shared/lib/utils.ts";
import {
  type PlanAssignmentRow,
  type PlanSeatRow,
  seatingCandidatesQueryOptions,
} from "../-venue-queries";
import type { OrganizationSeatInfo } from "../-venue-utils";

/**
 * 排位画布右侧的人员面板。
 *
 * 这是**第二条写路径**（docs/场地排位底层设计.md §3.2）：它只调 assign /
 * unassign，一次都不碰画布保存。旧系统把两条揉成一条，于是每拖动一个座位都在
 * 重写全部人员绑定——那正是这份设计要避免的。
 *
 * 候选人只来自当前环节人员。活动人员需要先在环节人员管理中加入当前环节，
 * 这里再使用其 `segmentMemberId` 排位，避免把其他环节的人员显示进来。
 */
export function SeatAssignPanel({
  planId,
  seat,
  assignment,
  readOnly,
  pending,
  organizationSeatInfoById,
  onAssign,
  onUnassign,
}: {
  planId: number;
  seat: PlanSeatRow | null;
  assignment: PlanAssignmentRow | null;
  readOnly: boolean;
  pending: boolean;
  organizationSeatInfoById: ReadonlyMap<number, OrganizationSeatInfo>;
  onAssign: (segmentMemberId: number) => void;
  onUnassign: () => void;
}) {
  const [keyword, setKeyword] = useState("");

  const candidatesQuery = useQuery({
    ...seatingCandidatesQueryOptions(planId, keyword || undefined),
    enabled: seat !== null && !readOnly,
  });
  const isOrganizationAssignment = assignment?.occupantType === "organization";

  if (!seat) {
    return (
      <Shell>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
          <UsersIcon className="size-8 opacity-40" />
          <p className="text-sm">选中一个位置</p>
          <p className="text-xs">点画布上的座位，这里就能给它排人。</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div>
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-sm">位置 {seat.label}</h3>
          {!seat.enabled && (
            <Badge
              variant="outline"
              className="border-border bg-muted text-muted-foreground"
            >
              本环节停用
            </Badge>
          )}
          {seat.rank === "vip" && (
            <Badge
              variant="outline"
              className="border-warning/30 bg-warning/10 text-warning-foreground"
            >
              重要
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground text-xs">
          {assignment
            ? isOrganizationAssignment
              ? "团体占位，可解除"
              : "已排人，可换人或解除"
            : "还没有人"}
        </p>
      </div>

      {assignment && (
        <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/40 p-3">
          <div className="min-w-0">
            <div className="truncate font-medium text-sm">
              {isOrganizationAssignment
                ? assignment.organizationName || "团体占位"
                : assignment.memberName}
            </div>
            <p className="truncate text-muted-foreground text-xs">
              {isOrganizationAssignment
                ? "团体占位，不代表具体个人"
                : assignment.companyPosition || "未填写单位职务"}
            </p>
          </div>
          {!readOnly && (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              className="shrink-0 text-destructive hover:text-destructive"
              onClick={onUnassign}
            >
              <UserMinusIcon />
              解除
            </Button>
          )}
        </div>
      )}

      {readOnly ? (
        <p className="text-muted-foreground text-xs">
          方案已作废，不能再改排位。
        </p>
      ) : !seat.enabled ? (
        <p className="text-muted-foreground text-xs">
          这个位置本环节停用了，要排人先用下方的「本环节启用此位置」把它打开。
        </p>
      ) : isOrganizationAssignment ? (
        <p className="text-muted-foreground text-xs">
          这个位置由团体占用。解除该位置的团体占位后，才能安排具体个人。
        </p>
      ) : (
        <>
          <div className="relative">
            <SearchIcon className="-translate-y-1/2 absolute top-1/2 left-3 size-4 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索姓名或手机号"
              className="pl-9"
            />
          </div>

          {candidatesQuery.isLoading ? (
            <div className="flex justify-center py-6 text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" />
            </div>
          ) : candidatesQuery.data?.list.length ? (
            <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
              {candidatesQuery.data.list.map((person) => {
                const taken = person.takenSeatLabel;
                const organizationInfo =
                  person.organizationId === null
                    ? undefined
                    : organizationSeatInfoById.get(person.organizationId);
                const organizationColor =
                  person.organizationId === null
                    ? undefined
                    : organizationSeatColor(person.organizationId);
                const groupSeatStatus = organizationInfo?.seatLabels.length
                  ? `团体座位 ${organizationInfo.seatLabels.join("、")}`
                  : null;
                const seatStatus = taken ? `在 ${taken}` : groupSeatStatus;
                const isHere =
                  assignment?.segmentMemberId === person.segmentMemberId;
                return (
                  <button
                    key={person.activityMemberId}
                    type="button"
                    disabled={pending || isHere}
                    onClick={() => onAssign(person.segmentMemberId)}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors",
                      isHere
                        ? "cursor-default bg-primary/10 text-primary"
                        : "cursor-pointer hover:bg-muted",
                      pending && "opacity-60",
                    )}
                  >
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-baseline gap-2 leading-5">
                        <div className="min-w-0 truncate font-medium">
                          {person.name}
                        </div>
                        {organizationInfo?.name && organizationColor ? (
                          <span
                            className="max-w-32 shrink truncate font-medium text-xs"
                            style={{ color: organizationColor.stroke }}
                            title={organizationInfo.name}
                          >
                            {organizationInfo.name}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 truncate text-muted-foreground text-xs leading-4">
                        {person.companyPosition || person.mobile || "—"}
                      </p>
                    </div>
                    {/* 已占座的人不藏起来：让人看见"他已经在 A3"比让他凭空
                        消失有用，点一下就是换座。 */}
                    {isHere ? (
                      <span className="shrink-0 text-xs">当前</span>
                    ) : seatStatus ? (
                      <span
                        className="max-w-44 shrink-0 truncate text-muted-foreground text-xs"
                        title={seatStatus}
                      >
                        {seatStatus}
                      </span>
                    ) : (
                      <UserPlusIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                  </button>
                );
              })}
              {/* 服务端 limit 200。到了上限就说出来——否则人数多的活动里，
                  排在后面的人"不搜就看不见"，而用户根本不知道列表被截断了
                  （评审 §3.14）。 */}
              {candidatesQuery.data.list.length >= 200 && (
                <p className="px-2 py-2 text-center text-muted-foreground text-xs">
                  仅显示前 200 人，用上面的搜索框找具体的人。
                </p>
              )}
            </div>
          ) : (
            <p className="py-6 text-center text-muted-foreground text-xs">
              没有匹配的当前环节人员。请先到「环节人员」里添加。
            </p>
          )}
        </>
      )}
    </Shell>
  );
}

/** 固定宽度，跟区域属性面板一致——切换选中时外框不跳。 */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <aside className="flex w-72 shrink-0 flex-col gap-3 overflow-hidden rounded-lg border bg-card p-4 shadow-sm">
      {children}
    </aside>
  );
}
