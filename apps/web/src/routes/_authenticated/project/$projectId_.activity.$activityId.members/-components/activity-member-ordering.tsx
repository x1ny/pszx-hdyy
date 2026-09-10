import { useSortable } from "@dnd-kit/react/sortable";
import type { ReactNode } from "react";
import { TableRow } from "#/shared/components/ui/table.tsx";
import { cn } from "#/shared/lib/utils.ts";

export type ActivityMemberMovePlacement = "before" | "after";

export type ActivityMemberMoveIntent = {
  sourceId: number;
  targetId: number;
  placement: ActivityMemberMovePlacement;
};

export const ACTIVITY_MEMBER_SORTABLE_GROUP = "activity-members";

/**
 * 只在当前已渲染的 ID 序列上生成移动意图。它用于判断按钮/拖拽是否真的
 * 改变了顺序；排序数值与隐藏 sortIndex 仍由服务端根据稳定关系 ID 决定。
 */
export function createActivityMemberMoveIntent(
  ids: readonly number[],
  sourceId: number,
  targetId: number,
  placement: ActivityMemberMovePlacement,
): ActivityMemberMoveIntent | undefined {
  const sourceIndex = ids.indexOf(sourceId);
  const targetIndex = ids.indexOf(targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceId === targetId) {
    return undefined;
  }

  const withoutSource = ids.filter((id) => id !== sourceId);
  const anchorIndex = withoutSource.indexOf(targetId);
  if (anchorIndex < 0) return undefined;

  const insertionIndex = placement === "after" ? anchorIndex + 1 : anchorIndex;
  withoutSource.splice(insertionIndex, 0, sourceId);
  if (withoutSource.every((id, index) => id === ids[index])) {
    return undefined;
  }

  return { sourceId, targetId, placement };
}

/**
 * 把键盘拖放期间维护的完整序列压缩成一次稳定锚点请求。键盘传感器会直接
 * 调整行 DOM，不能用 drag start 的 index 或指针坐标推断最终方向；由当前序列
 * 的最终相邻行决定 before/after，服务端再按完整活动范围重编隐藏位置。
 */
export function createActivityMemberMoveIntentFromSequences(
  initialIds: readonly number[],
  currentIds: readonly number[],
  sourceId: number,
): ActivityMemberMoveIntent | undefined {
  const initialIndex = initialIds.indexOf(sourceId);
  const currentIndex = currentIds.indexOf(sourceId);
  if (
    initialIndex < 0 ||
    currentIndex < 0 ||
    initialIds.length !== currentIds.length ||
    initialIds.every((id, index) => id === currentIds[index])
  ) {
    return undefined;
  }

  const movedDown = currentIndex > initialIndex;
  const targetId = currentIds[movedDown ? currentIndex - 1 : currentIndex + 1];
  if (targetId === undefined) return undefined;

  return createActivityMemberMoveIntent(
    initialIds,
    sourceId,
    targetId,
    movedDown ? "after" : "before",
  );
}

/**
 * 在 dragend 事件没有目标（例如指针刚好离开目标行、或释放发生在一次
 * collision 更新之前）时，使用 sortable 实例维护的最终 index 兜底生成锚点。
 * OptimisticSortingPlugin 会在视觉换位后同步这个 index，因此它比最后一次
 * dragover 的 target/placement 更接近用户实际看到的结果。
 */
export function createActivityMemberMoveIntentFromSortableIndex(
  initialIds: readonly number[],
  sourceId: number,
  currentIndex: number,
): ActivityMemberMoveIntent | undefined {
  const initialIndex = initialIds.indexOf(sourceId);
  if (
    initialIndex < 0 ||
    !Number.isInteger(currentIndex) ||
    currentIndex < 0 ||
    currentIndex >= initialIds.length ||
    currentIndex === initialIndex
  ) {
    return undefined;
  }

  const withoutSource = initialIds.filter((id) => id !== sourceId);
  const movedDown = currentIndex > initialIndex;
  const targetId = withoutSource[movedDown ? currentIndex - 1 : currentIndex];
  if (targetId === undefined) return undefined;

  return createActivityMemberMoveIntent(
    initialIds,
    sourceId,
    targetId,
    movedDown ? "after" : "before",
  );
}

export function createActivityMemberAdjacentMoveIntent(
  ids: readonly number[],
  sourceId: number,
  direction: "up" | "down",
) {
  const sourceIndex = ids.indexOf(sourceId);
  if (sourceIndex < 0) return undefined;

  const targetId = ids[direction === "up" ? sourceIndex - 1 : sourceIndex + 1];
  if (targetId === undefined) return undefined;

  return createActivityMemberMoveIntent(
    ids,
    sourceId,
    targetId,
    direction === "up" ? "before" : "after",
  );
}

/** Convert the nullable server value into the editable input representation. */
export function formatActivityMemberSortOrder(value: number | null) {
  return value === null ? "" : String(value);
}

/**
 * 输入保留为字符串，直到用户显式保存。空串或单独的 `-` 表示清除排序，
 * 负数和超范围整数仍然会被拒绝，避免被 `Number(value) || 0` 静默变成合法的 0。
 */
export function parseActivityMemberSortOrder(value: string) {
  const normalized = value.trim();
  if (normalized === "" || normalized === "-") return null;
  if (!/^\d+$/.test(normalized)) return undefined;

  const order = Number(normalized);
  return Number.isSafeInteger(order) && order <= 2_147_483_647
    ? order
    : undefined;
}

export function resolveActivityMemberDragPlacement(input: {
  sourceIndex: number;
  targetIndex: number;
  positionY?: number;
  targetCenterY?: number;
}): ActivityMemberMovePlacement {
  if (
    input.positionY !== undefined &&
    input.targetCenterY !== undefined &&
    Number.isFinite(input.positionY) &&
    Number.isFinite(input.targetCenterY)
  ) {
    return input.positionY > input.targetCenterY ? "after" : "before";
  }

  // KeyboardSensor may not expose a useful pointer position. Its direction is
  // represented by the target's position in the confirmed visible sequence.
  return input.sourceIndex < input.targetIndex ? "after" : "before";
}

type ActivityMemberSortableRowProps = {
  id: number;
  index: number;
  disabled: boolean;
  children: (input: {
    handleRef: (element: Element | null) => void;
    isDragging: boolean;
    isDropTarget: boolean;
  }) => ReactNode;
};

/**
 * @dnd-kit/react 0.5.0 的 sortable 适配。Hook 固定在行组件内调用，避免在
 * `.map()` 回调里调用 Hook；渲染出来的 DOM 仍保持 `<tbody>` 直接子项为 `<tr>`。
 */
export function ActivityMemberSortableRow({
  id,
  index,
  disabled,
  children,
}: ActivityMemberSortableRowProps) {
  const { ref, handleRef, isDragging, isDropTarget } = useSortable({
    id,
    index,
    group: ACTIVITY_MEMBER_SORTABLE_GROUP,
    disabled,
  });

  return (
    <TableRow
      ref={ref}
      data-activity-member-id={id}
      data-dragging={isDragging ? "true" : undefined}
      data-drop-target={isDropTarget ? "true" : undefined}
      className={cn(
        "transition-[transform,background-color,opacity]",
        isDragging && "opacity-50",
        isDropTarget && "bg-primary/5",
      )}
    >
      {children({ handleRef, isDragging, isDropTarget })}
    </TableRow>
  );
}
