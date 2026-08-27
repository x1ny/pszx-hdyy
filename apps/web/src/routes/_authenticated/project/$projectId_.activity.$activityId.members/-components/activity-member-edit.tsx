import type { QueryClient } from "@tanstack/react-query";
import { AlertCircleIcon, LockKeyholeIcon } from "lucide-react";
import {
  type RelationFormValues,
  toRelationInput,
} from "#/features/member/relation-fields.tsx";
import {
  type ActivityMemberDetail,
  type ActivityMemberFilters,
  type ActivityMemberSegmentOption,
  type ActivityMemberSegmentSyncResult,
  activityMemberKeys,
  segmentMemberKeys,
  syncActivityMemberSegments,
  updateActivityMember,
} from "#/features/member/relation-queries.ts";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "#/shared/components/ui/alert.tsx";
import { Badge } from "#/shared/components/ui/badge.tsx";
import { Checkbox } from "#/shared/components/ui/checkbox.tsx";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "#/shared/components/ui/field.tsx";

type ActivityMemberSyncBlocker = Extract<
  ActivityMemberSegmentSyncResult,
  { applied: false }
>["blocked"][number];

export type ActivityMemberEditIssue =
  | { kind: "blocked"; blockers: ActivityMemberSyncBlocker[] }
  | { kind: "error"; title: string; message: string };

export type ActivityMemberEditSaveResult =
  | {
      kind: "saved";
      syncResult: Extract<ActivityMemberSegmentSyncResult, { applied: true }>;
    }
  | {
      kind: "blocked";
      syncResult: Extract<ActivityMemberSegmentSyncResult, { applied: false }>;
    }
  | {
      kind: "relationFailed";
      message: string;
      participationChanged: boolean;
    };

type ActivityMemberEditActions = {
  syncSegments: (input: {
    activityMemberId: number;
    segmentIds: number[];
  }) => Promise<ActivityMemberSegmentSyncResult>;
  updateRelation: (
    input: ReturnType<typeof toRelationInput> & { id: number },
  ) => Promise<unknown>;
};

const defaultActivityMemberEditActions: ActivityMemberEditActions = {
  syncSegments: syncActivityMemberSegments,
  updateRelation: updateActivityMember,
};

/**
 * 保存顺序固定为参与环节 → 活动关系字段。
 *
 * sync 的 blocker 是正常业务结果，绝不能继续 update；如果第二步失败，则明确
 * 返回局部成功，让弹窗保留并允许用户原样重试关系字段。
 */
export async function submitActivityMemberEdit(
  input: {
    activityMemberId: number;
    segmentIds: number[];
    relation: RelationFormValues;
  },
  actions: ActivityMemberEditActions = defaultActivityMemberEditActions,
): Promise<ActivityMemberEditSaveResult> {
  const syncResult = await actions.syncSegments({
    activityMemberId: input.activityMemberId,
    segmentIds: input.segmentIds,
  });
  if (!syncResult.applied) return { kind: "blocked", syncResult };

  try {
    await actions.updateRelation({
      id: input.activityMemberId,
      ...toRelationInput(input.relation),
    });
  } catch (error) {
    return {
      kind: "relationFailed",
      message: error instanceof Error ? error.message : "关系字段保存失败",
      participationChanged: syncResult.added > 0 || syncResult.removed > 0,
    };
  }

  return { kind: "saved", syncResult };
}

/** 成功或局部成功后，当前列表、详情及所有环节人员缓存必须一起失效。 */
export async function refreshActivityMemberEditQueries(
  queryClient: Pick<QueryClient, "invalidateQueries">,
  filters: ActivityMemberFilters,
  activityMemberId: number,
) {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: activityMemberKeys.list(filters),
      refetchType: "all",
    }),
    queryClient.invalidateQueries({
      queryKey: activityMemberKeys.detail(activityMemberId),
      refetchType: "all",
    }),
    queryClient.invalidateQueries({
      queryKey: segmentMemberKeys.all,
      refetchType: "all",
    }),
  ]);
}

type ActivityMemberSegmentMembership = Pick<
  ActivityMemberDetail["segments"][number],
  "segmentId" | "name" | "status" | "memberEnabled"
>;

type ActivityMemberSegmentChoice = Pick<
  ActivityMemberSegmentOption,
  "id" | "name" | "status" | "memberEnabled"
>;

export function isEditableActivitySegment(
  segment: Pick<ActivityMemberSegmentOption, "status" | "memberEnabled">,
) {
  return segment.status === "active" && segment.memberEnabled;
}

export function readOnlyActivitySegmentReason(
  segment: Pick<ActivityMemberSegmentMembership, "status" | "memberEnabled">,
) {
  return segment.status === "voided" ? "环节已作废" : "未开启人员管理";
}

export function ActivityMemberParticipationFields({
  segments,
  memberships,
  selectedIds,
  disabled = false,
  onChange,
}: {
  segments: readonly ActivityMemberSegmentChoice[];
  memberships: readonly ActivityMemberSegmentMembership[];
  selectedIds: readonly number[];
  disabled?: boolean;
  onChange: (next: number[]) => void;
}) {
  const editableSegments = segments.filter(isEditableActivitySegment);
  const readOnlyMemberships = memberships.filter(
    (segment) => !isEditableActivitySegment(segment),
  );
  const selected = new Set(selectedIds);

  const toggle = (segmentId: number, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(segmentId);
    else next.delete(segmentId);
    onChange(
      editableSegments.flatMap((segment) =>
        next.has(segment.id) ? [segment.id] : [],
      ),
    );
  };

  return (
    <FieldSet className="gap-4">
      <FieldLegend variant="label">参与环节</FieldLegend>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FieldDescription>
          仅正常且已开启人员管理的环节可编辑；此处不设置环节身份。
        </FieldDescription>
        <Badge variant="secondary">已选 {selectedIds.length} 个</Badge>
      </div>

      {editableSegments.length > 0 ? (
        <FieldGroup data-slot="checkbox-group" className="gap-3">
          {editableSegments.map((segment) => {
            const checkboxId = `edit-participation-${segment.id}`;
            return (
              <Field key={segment.id} orientation="horizontal">
                <Checkbox
                  id={checkboxId}
                  checked={selected.has(segment.id)}
                  disabled={disabled}
                  onCheckedChange={(checked) => toggle(segment.id, !!checked)}
                />
                <FieldLabel htmlFor={checkboxId} className="font-normal">
                  {segment.name}
                </FieldLabel>
              </Field>
            );
          })}
        </FieldGroup>
      ) : (
        <Alert>
          <AlertTitle>暂无可编辑环节</AlertTitle>
          <AlertDescription>
            请先在议程中创建正常环节并开启人员管理。
          </AlertDescription>
        </Alert>
      )}

      {readOnlyMemberships.length > 0 && (
        <Alert>
          <LockKeyholeIcon />
          <AlertTitle>
            只读保留 {readOnlyMemberships.length} 个历史关系
          </AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <p>以下关系不可选择，也不会被本次保存删除：</p>
            <ul className="flex flex-col gap-1.5">
              {readOnlyMemberships.map((segment) => (
                <li
                  key={segment.segmentId}
                  className="flex flex-wrap items-center gap-2"
                >
                  <span>{segment.name}</span>
                  <Badge variant="outline">
                    {readOnlyActivitySegmentReason(segment)}
                  </Badge>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </FieldSet>
  );
}

export function ActivityMemberEditIssueAlert({
  issue,
}: {
  issue: ActivityMemberEditIssue;
}) {
  if (issue.kind === "error") {
    return (
      <Alert variant="destructive">
        <AlertCircleIcon />
        <AlertTitle>{issue.title}</AlertTitle>
        <AlertDescription>{issue.message}</AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert variant="destructive">
      <AlertCircleIcon />
      <AlertTitle>参与环节未变更，关系字段也尚未保存</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <p>请先处理以下座位或行程关联，再取消对应环节：</p>
        <ul className="flex list-disc flex-col gap-3 pl-5">
          {issue.blockers.map((blocker) => (
            <li key={blocker.segmentMemberId}>
              <span className="font-medium">{blocker.segmentName}</span>
              <ul className="mt-1 flex flex-col gap-1">
                {blocker.seats.length > 0 && (
                  <li>
                    个人座位：
                    {blocker.seats.map((seat) => seat.seatLabel).join("、")}
                  </li>
                )}
                {blocker.organizationSeats.length > 0 && (
                  <li>
                    团体占位：
                    {blocker.organizationSeats
                      .map(
                        (seat) =>
                          `${seat.seatLabel}（团体 #${seat.organizationId}）`,
                      )
                      .join("、")}
                  </li>
                )}
                {blocker.trips.length > 0 && (
                  <li>
                    行程：
                    {blocker.trips.map(formatBlockedTrip).join("；")}
                  </li>
                )}
              </ul>
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

function formatBlockedTrip(trip: ActivityMemberSyncBlocker["trips"][number]) {
  const service = trip.serviceNumber ? `${trip.serviceNumber}，` : "";
  const departureTime = new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(trip.departureTime));
  return `${service}${trip.departureLocation} → ${trip.destination}，${departureTime}`;
}
