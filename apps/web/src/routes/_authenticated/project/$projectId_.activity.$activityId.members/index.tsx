import {
  DragDropProvider,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertCircleIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  GripVerticalIcon,
  PlusIcon,
  SearchIcon,
  UsersRoundIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { MemberDetailDialog } from "#/features/member/member-detail-dialog.tsx";
import { MemberPickerDialog } from "#/features/member/member-picker-dialog.tsx";
import { formatOrganizationBatchSummary } from "#/features/member/member-picker-state.ts";
import { MemberQuickCreateDialog } from "#/features/member/member-quick-create-dialog.tsx";
import {
  emptyRelationForm,
  RelationFields,
  type RelationFormValues,
  toRelationInput,
} from "#/features/member/relation-fields.tsx";
import {
  type ActivityMember,
  type ActivityMemberDetail,
  type ActivityMemberFilters,
  activityMemberDetailQueryOptions,
  activityMemberKeys,
  activityMemberListQueryOptions,
  activityMemberSegmentOptionsQueryOptions,
  activityMemberSnapshotQueryOptions,
  addActivityMembers,
  addActivityMembersByOrganization,
  addNewActivityMember,
  getActivityMemberImpact,
  moveActivityMember,
  type NewMemberFields,
  organizationOptionsQueryOptions,
  projectMemberKeys,
  RELATION_ORIGIN_LABELS,
  refreshActivityMemberOrderingQueries,
  removeActivityMember,
  setActivityMemberOrder,
} from "#/features/member/relation-queries.ts";
import { formatNativePlace } from "#/features/member/utils.ts";
import {
  FilterActions,
  FilterBar,
  isSameFilter,
} from "#/shared/components/filter-bar.tsx";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "#/shared/components/ui/alert.tsx";
import { Badge } from "#/shared/components/ui/badge.tsx";
import { Button } from "#/shared/components/ui/button.tsx";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "#/shared/components/ui/card.tsx";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/shared/components/ui/dialog.tsx";
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
  SelectGroup,
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
import {
  type ActivityMemberEditIssue,
  ActivityMemberEditIssueAlert,
  ActivityMemberParticipationFields,
  isEditableActivitySegment,
  refreshActivityMemberEditQueries,
  submitActivityMemberEdit,
} from "./-components/activity-member-edit";
import {
  type ActivityMemberMoveIntent,
  ActivityMemberSortableRow,
  createActivityMemberAdjacentMoveIntent,
  createActivityMemberMoveIntent,
  createActivityMemberMoveIntentFromSequences,
  createActivityMemberMoveIntentFromSortableIndex,
  formatActivityMemberSortOrder,
  parseActivityMemberSortOrder,
  resolveActivityMemberDragPlacement,
} from "./-components/activity-member-ordering";

const SearchSchema = z.object({
  name: z.string().optional().catch(undefined),
  ownerName: z.string().optional().catch(undefined),
  organizationId: z.number().int().positive().optional().catch(undefined),
  page: z.number().int().min(1).default(1).catch(1),
  pageSize: z.number().int().min(1).max(100).default(10).catch(10),
});

type ActivityMemberDragSession = {
  initialIds: readonly number[];
  currentIds: readonly number[];
  sourceId: number;
  targetId?: number;
  placement?: "before" | "after";
  /**
   * dnd-kit only emits dragover when the target ID changes. Keep the latest
   * pointer and target center so crossing the same row's midpoint still
   * updates before/after placement.
   */
  pointerY?: number;
  targetCenterY?: number;
  keyboardActive?: boolean;
};

export const Route = createFileRoute(
  "/_authenticated/project/$projectId_/activity/$activityId/members/",
)({
  validateSearch: SearchSchema,
  component: ActivityMembersPage,
});

function ActivityMembersPage() {
  const { projectId: projectIdParam, activityId: activityIdParam } =
    Route.useParams();
  const activityId = Number(activityIdParam);
  const projectId = Number(projectIdParam);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();

  const [nameInput, setNameInput] = useState(search.name ?? "");
  const [ownerInput, setOwnerInput] = useState(search.ownerName ?? "");
  const [organizationInput, setOrganizationInput] = useState<number | null>(
    search.organizationId ?? null,
  );

  // URL 变了就把草稿拉回来对齐（后退、粘链接进来）。
  useEffect(() => {
    setNameInput(search.name ?? "");
    setOwnerInput(search.ownerName ?? "");
    setOrganizationInput(search.organizationId ?? null);
  }, [search.name, search.ownerName, search.organizationId]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] =
    useState<RelationFormValues>(emptyRelationForm);
  const [createOwnerPhone, setCreateOwnerPhone] = useState("");
  const [pendingIds, setPendingIds] = useState<number[]>([]);
  const [addForm, setAddForm] = useState<RelationFormValues>(emptyRelationForm);
  const [addOwnerPhone, setAddOwnerPhone] = useState("");

  const [editing, setEditing] = useState<ActivityMember>();
  const [editForm, setEditForm] =
    useState<RelationFormValues>(emptyRelationForm);
  const [editOwnerPhone, setEditOwnerPhone] = useState("");
  const [editSegmentIds, setEditSegmentIds] = useState<number[]>([]);
  const [editSelectionFor, setEditSelectionFor] = useState<number>();
  const [editIssue, setEditIssue] = useState<ActivityMemberEditIssue>();

  const [viewing, setViewing] = useState<ActivityMember>();
  const [removing, setRemoving] = useState<ActivityMember>();
  const [orderDrafts, setOrderDrafts] = useState<Record<number, string>>({});
  const [orderingRenderKey, setOrderingRenderKey] = useState(0);
  const dragSessionRef = useRef<ActivityMemberDragSession | null>(null);

  const filters: ActivityMemberFilters = { activityId, ...search };
  const listQuery = useQuery(activityMemberListQueryOptions(filters));
  const organizationOptionsQuery = useQuery(organizationOptionsQueryOptions());
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const visibleIds = useMemo(() => list.map((row) => row.id), [list]);
  const hasAppliedFilter = Boolean(
    search.name?.trim() ||
      search.organizationId !== undefined ||
      search.ownerName?.trim(),
  );
  const hasUnsavedOrderEdits = Object.keys(orderDrafts).length > 0;
  const memberSnapshotQuery = useQuery({
    ...activityMemberSnapshotQueryOptions(activityId),
    enabled: pickerOpen,
  });
  const editDetailQuery = useQuery({
    ...activityMemberDetailQueryOptions(editing?.id ?? 0),
    enabled: !!editing,
  });
  const editSegmentOptionsQuery = useQuery({
    ...activityMemberSegmentOptionsQueryOptions(activityId),
    enabled: !!editing,
  });

  // 详情接口包含作废/关闭人员管理的历史关系；初始化时只把仍可编辑的关系放进
  // checkbox 集合，只读关系由服务端 sync 自动保留，不送进期望集合。
  useEffect(() => {
    if (
      !editing ||
      !editDetailQuery.data ||
      !editSegmentOptionsQuery.data ||
      editSelectionFor === editing.id
    ) {
      return;
    }

    const editableIds = new Set(
      editSegmentOptionsQuery.data
        .filter(isEditableActivitySegment)
        .map((segment) => segment.id),
    );
    setEditSegmentIds(
      editDetailQuery.data.segments.flatMap((segment) =>
        editableIds.has(segment.segmentId) ? [segment.segmentId] : [],
      ),
    );
    setEditSelectionFor(editing.id);
  }, [
    editing,
    editDetailQuery.data,
    editSegmentOptionsQuery.data,
    editSelectionFor,
  ]);
  const organizationFilterItems = [
    {
      value: null,
      label: organizationOptionsQuery.isPending
        ? "团体加载中…"
        : organizationOptionsQuery.isError
          ? "团体加载失败"
          : "全部团体",
    },
    ...(organizationOptionsQuery.data ?? []).map((item) => ({
      value: item.id,
      label: item.name,
    })),
  ];

  // 移除前的受影响清单。只在确认弹窗打开时才查——它是"点了移除之后"才需要的
  // 信息，提前查会给每一行都发一个请求。
  const impactQuery = useQuery({
    queryKey: ["activityMember", "impact", removing?.id],
    queryFn: () => getActivityMemberImpact(removing?.id ?? 0),
    enabled: !!removing,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: activityMemberKeys.all });

  const resetDragPreview = () => setOrderingRenderKey((value) => value + 1);

  const applyFilter = (patch: Partial<typeof search>) => {
    const next = { ...search, ...patch, page: 1 };
    // 条件没变时 navigate 是空操作，显式重拉一次，让「查询」同时承担刷新
    // 语义（理由见 filter-bar.tsx）。
    if (isSameFilter(search, next)) return invalidate();
    navigate({ search: next });
  };

  const addMutation = useMutation({
    mutationFn: (memberIds: number[]) =>
      addActivityMembers({
        activityId,
        memberIds,
        originType: "manual",
        ownerPhone: addOwnerPhone || undefined,
        ...toRelationInput(addForm),
      }),
    onSuccess: (result) => {
      toast.success(`已新增 ${result.added} 名活动人员`);
      setPendingIds([]);
      setAddForm(emptyRelationForm);
      setAddOwnerPhone("");
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const organizationAddMutation = useMutation({
    mutationFn: (input: { organizationId: number; memberIds: number[] }) =>
      addActivityMembersByOrganization({ activityId, ...input }),
    onSuccess: (result) => {
      toast.success(formatOrganizationBatchSummary(result));
      queryClient.invalidateQueries({ queryKey: activityMemberKeys.all });
      queryClient.invalidateQueries({ queryKey: projectMemberKeys.all });
    },
    onError: (error) => toast.error(error.message),
  });

  const createMutation = useMutation({
    mutationFn: (fields: NewMemberFields) =>
      addNewActivityMember({
        activityId,
        member: fields,
        ownerPhone: createOwnerPhone || undefined,
        ...toRelationInput(createForm),
      }),
    onSuccess: () => {
      toast.success("已录入并加入本活动，同时写入全量人员库");
      setCreateOpen(false);
      setCreateForm(emptyRelationForm);
      setCreateOwnerPhone("");
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const editMutation = useMutation({
    mutationFn: () =>
      submitActivityMemberEdit({
        activityMemberId: editing?.id ?? 0,
        segmentIds: editSegmentIds,
        relation: editForm,
        ownerPhone: editOwnerPhone,
      }),
    onMutate: () => setEditIssue(undefined),
    onSuccess: async (result) => {
      if (!editing) return;

      if (result.kind === "blocked") {
        setEditIssue({
          kind: "blocked",
          blockers: result.syncResult.blocked,
        });
        return;
      }

      if (result.kind === "relationFailed") {
        if (result.participationChanged) {
          await refreshActivityMemberEditQueries(
            queryClient,
            filters,
            editing.id,
          );
        }
        setEditIssue({
          kind: "error",
          title: result.participationChanged
            ? "参与环节已保存，关系字段未保存"
            : "关系字段保存失败",
          message: `${result.message}。请保留弹窗并重试。`,
        });
        return;
      }

      await refreshActivityMemberEditQueries(queryClient, filters, editing.id);
      toast.success("活动关系与参与环节已保存");
      setEditing(undefined);
    },
    onError: (error) => {
      setEditIssue({
        kind: "error",
        title: "保存失败，未继续保存关系字段",
        message: error.message,
      });
    },
  });

  const removeMutation = useMutation({
    // cascade 恒为 true：这个弹窗本身就是 BR-DEV-029 要求的那次二次确认，
    // 用户看着受影响清单点的"确认移除"。带 false 再来一轮只是多一个往返。
    mutationFn: (target: ActivityMember) =>
      removeActivityMember(target.id, true),
    onSuccess: () => {
      toast.success("已解除该人员在本活动下的关系");
      setRemoving(undefined);
      if (list.length === 1 && search.page > 1) {
        navigate({ search: (prev) => ({ ...prev, page: prev.page - 1 }) });
      }
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const setOrderMutation = useMutation({
    mutationFn: (input: { id: number; sortOrder: number | null }) =>
      setActivityMemberOrder({ activityId, ...input }),
    onSuccess: async (result, input) => {
      setOrderDrafts((current) => withoutOrderDraft(current, input.id));

      if (!result.changed) {
        toast.success("排序未变化");
        return;
      }

      try {
        await refreshActivityMemberOrderingQueries(queryClient);
        toast.success("排序已保存");
      } catch (error) {
        toast.error(
          `排序已保存，列表刷新失败：${
            error instanceof Error ? error.message : "请稍后重试"
          }`,
        );
      }
    },
    onError: (error) => toast.error(`排序保存失败：${error.message}`),
  });

  const moveMutation = useMutation({
    mutationFn: (intent: ActivityMemberMoveIntent) =>
      moveActivityMember({
        activityId,
        id: intent.sourceId,
        targetId: intent.targetId,
        placement: intent.placement,
      }),
    onSuccess: async (result) => {
      if (!result.changed) {
        toast.success("顺序未变化");
        return;
      }

      try {
        await refreshActivityMemberOrderingQueries(queryClient);
        toast.success("顺序已保存");
      } catch (error) {
        toast.error(
          `排序已保存，列表刷新失败：${
            error instanceof Error ? error.message : "请稍后重试"
          }`,
        );
      }
    },
    onError: async (error) => {
      // @dnd-kit/react 的 OptimisticSortingPlugin 会在 dragover 期间直接调节
      // 行 DOM。失败时仅刷新 React 状态可能复用这批已经换位的 <tr>，所以先
      // 强制重建拖拽树恢复缓存顺序，再从服务端重读，避免页面显示与后端分叉。
      dragSessionRef.current = null;
      resetDragPreview();
      toast.error(`移动保存失败：${error.message}`);

      try {
        await refreshActivityMemberOrderingQueries(queryClient);
      } catch (refreshError) {
        toast.error(
          `移动失败后的列表刷新也失败：${
            refreshError instanceof Error ? refreshError.message : "请稍后重试"
          }`,
        );
      }
    },
  });

  const mutationsPending =
    addMutation.isPending ||
    organizationAddMutation.isPending ||
    createMutation.isPending ||
    editMutation.isPending ||
    removeMutation.isPending ||
    setOrderMutation.isPending ||
    moveMutation.isPending;

  const movementDisabled =
    hasAppliedFilter ||
    hasUnsavedOrderEdits ||
    Boolean(editing) ||
    mutationsPending ||
    listQuery.isPending ||
    listQuery.isFetching ||
    listQuery.isPlaceholderData ||
    listQuery.isError;

  const handleDragStart = (event: DragStartEvent) => {
    if (movementDisabled) return;

    const sourceId = readActivityMemberRelationId(event.operation.source?.id);
    if (sourceId === undefined || !visibleIds.includes(sourceId)) return;

    dragSessionRef.current = {
      initialIds: [...visibleIds],
      currentIds: [...visibleIds],
      sourceId,
      pointerY: readDragPointerY(
        event.nativeEvent,
        event.operation.position.current.y,
      ),
    };
  };

  const handleDragMove = (event: DragMoveEvent) => {
    const session = dragSessionRef.current;
    if (!session) return;

    const pointerY = readDragPointerY(
      event.nativeEvent,
      event.operation.position.current.y,
    );
    const sessionWithPointer =
      pointerY === undefined ? session : { ...session, pointerY };
    const keyboardDirection = readKeyboardDirection(event.nativeEvent);
    if (keyboardDirection) {
      const sourceId = readActivityMemberRelationId(event.operation.source?.id);
      if (sourceId !== sessionWithPointer.sourceId) return;

      const sourceIndex = sessionWithPointer.currentIds.indexOf(sourceId);
      const targetIndex = sourceIndex + (keyboardDirection === "down" ? 1 : -1);
      if (
        sourceIndex < 0 ||
        targetIndex < 0 ||
        targetIndex >= sessionWithPointer.currentIds.length
      ) {
        return;
      }

      const currentIds = [...sessionWithPointer.currentIds];
      const [movedId] = currentIds.splice(sourceIndex, 1);
      currentIds.splice(targetIndex, 0, movedId);
      dragSessionRef.current = {
        ...sessionWithPointer,
        currentIds,
        keyboardActive: true,
        targetId: undefined,
        placement: undefined,
        targetCenterY: undefined,
      };
      return;
    }

    if (event.operation.target == null) {
      dragSessionRef.current = {
        ...sessionWithPointer,
        targetId: undefined,
        placement: undefined,
        targetCenterY: undefined,
      };
      return;
    }

    const operationTargetId = readActivityMemberRelationId(
      event.operation.target.id,
    );
    const operationTargetCenterY = event.operation.target.shape?.center.y;
    const sessionWithTargetCenter =
      operationTargetId === sessionWithPointer.targetId &&
      operationTargetCenterY !== undefined
        ? { ...sessionWithPointer, targetCenterY: operationTargetCenterY }
        : sessionWithPointer;

    // The optimistic sorting plugin can make the dragged row the current
    // operation target after it reorders the DOM. In that state no new
    // dragover is emitted while the pointer crosses the target row, so derive
    // the placement from the latest pointer position on every dragmove.
    if (
      sessionWithTargetCenter.targetId !== undefined &&
      sessionWithTargetCenter.targetCenterY !== undefined &&
      pointerY !== undefined
    ) {
      const sourceIndex = sessionWithTargetCenter.initialIds.indexOf(
        sessionWithTargetCenter.sourceId,
      );
      const targetIndex = sessionWithTargetCenter.initialIds.indexOf(
        sessionWithTargetCenter.targetId,
      );
      if (sourceIndex >= 0 && targetIndex >= 0) {
        dragSessionRef.current = {
          ...sessionWithTargetCenter,
          placement: resolveActivityMemberDragPlacement({
            sourceIndex,
            targetIndex,
            positionY: pointerY,
            targetCenterY: sessionWithTargetCenter.targetCenterY,
          }),
        };
        return;
      }
    }

    dragSessionRef.current = sessionWithTargetCenter;
  };

  const handleDragOver = (event: DragOverEvent) => {
    const session = dragSessionRef.current;
    if (!session || session.keyboardActive) return;

    const sourceId = readActivityMemberRelationId(event.operation.source?.id);
    const targetId = readActivityMemberRelationId(event.operation.target?.id);
    if (
      sourceId !== session.sourceId ||
      targetId === undefined ||
      targetId === sourceId ||
      !session.initialIds.includes(targetId)
    ) {
      if (targetId === undefined) {
        dragSessionRef.current = {
          ...session,
          pointerY: readDragPointerY(
            undefined,
            event.operation.position.current.y,
          ),
          targetId: undefined,
          placement: undefined,
          targetCenterY: undefined,
        };
      }
      return;
    }

    const sourceIndex = session.initialIds.indexOf(sourceId);
    const targetIndex = session.initialIds.indexOf(targetId);
    const targetCenterY = event.operation.target?.shape?.center.y;
    const pointerY = readDragPointerY(
      undefined,
      event.operation.position.current.y,
    );
    const placement = resolveActivityMemberDragPlacement({
      sourceIndex,
      targetIndex,
      positionY: pointerY,
      targetCenterY,
    });

    dragSessionRef.current = {
      ...session,
      targetId,
      placement,
      pointerY: pointerY ?? session.pointerY,
      targetCenterY,
    };
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const session = dragSessionRef.current;
    dragSessionRef.current = null;
    // Once a drag session has started, a query/mutation state change must not
    // silently discard the drop. The rows may become disabled while the final
    // event is being delivered, but the session still contains the user's
    // intended move and can be saved safely.
    if (!session || event.canceled) return;

    const sourceId = readActivityMemberRelationId(event.operation.source?.id);
    if (sourceId !== session.sourceId) {
      resetDragPreview();
      return;
    }

    if (session.keyboardActive) {
      const intent = createActivityMemberMoveIntentFromSequences(
        session.initialIds,
        session.currentIds,
        sourceId,
      );
      if (intent) {
        moveMutation.mutate(intent);
      } else if (
        !session.initialIds.every(
          (id, index) => id === session.currentIds[index],
        )
      ) {
        resetDragPreview();
      }
      return;
    }

    const sortableIndex = readActivityMemberSortableIndex(
      event.operation.source,
    );
    const initialIndex = session.initialIds.indexOf(sourceId);
    const eventTargetId = readActivityMemberRelationId(
      event.operation.target?.id,
    );
    const pointerDrop = readActivityMemberDropTarget(event.nativeEvent);
    const targetId = pointerDrop
      ? pointerDrop.id === sourceId
        ? (session.targetId ??
          (eventTargetId !== sourceId ? eventTargetId : undefined))
        : pointerDrop.id
      : (session.targetId ??
        (eventTargetId !== sourceId ? eventTargetId : undefined));
    // A known pointer position outside every sortable row is an explicit
    // cancel. Do not fall back to an older target or a plugin index in that
    // case, otherwise dragging out of the table could save a stale move.
    if (pointerDrop && pointerDrop.id === undefined) {
      resetDragPreview();
      return;
    }
    let intent: ActivityMemberMoveIntent | undefined;
    if (targetId !== undefined) {
      const sourceIndex = session.initialIds.indexOf(sourceId);
      const targetIndex = session.initialIds.indexOf(targetId);
      if (sourceIndex >= 0 && targetIndex >= 0) {
        const pointerY = readDragPointerY(
          event.nativeEvent,
          session.pointerY ?? event.operation.position.current.y,
        );
        const targetCenterY =
          (pointerDrop?.id === targetId ? pointerDrop.centerY : undefined) ??
          session.targetCenterY ??
          event.operation.target?.shape?.center.y;
        const placement =
          pointerY !== undefined && targetCenterY !== undefined
            ? resolveActivityMemberDragPlacement({
                sourceIndex,
                targetIndex,
                positionY: pointerY,
                targetCenterY,
              })
            : (session.placement ??
              resolveActivityMemberDragPlacement({
                sourceIndex,
                targetIndex,
                positionY: pointerY,
                targetCenterY,
              }));
        intent = createActivityMemberMoveIntent(
          session.initialIds,
          sourceId,
          targetId,
          placement,
        );
      }
    }

    // OptimisticSortingPlugin updates the source sortable's index when it has
    // already moved the row in the DOM. Prefer that final index whenever it
    // differs from the initial index: it remains available even if the last
    // collision target was cleared before dragend.
    if (sortableIndex !== undefined && sortableIndex !== initialIndex) {
      intent =
        createActivityMemberMoveIntentFromSortableIndex(
          session.initialIds,
          sourceId,
          sortableIndex,
        ) ?? intent;
    }

    if (intent) {
      moveMutation.mutate(intent);
    } else if (sortableIndex !== initialIndex || targetId !== undefined) {
      // The sortable plugin may have already moved the DOM even when the
      // release resolves to a no-op. Restore the React order immediately so a
      // canceled/invalid drop cannot leave a misleading visual preview.
      resetDragPreview();
    }
  };

  const saveOrder = (row: ActivityMember) => {
    const value = parseActivityMemberSortOrder(
      orderDrafts[row.id] ?? formatActivityMemberSortOrder(row.sortOrder),
    );
    if (value === undefined) {
      toast.error("排序必须是非负整数，留空表示未设置");
      return;
    }

    if (value === row.sortOrder) {
      cancelOrder(row.id);
      toast.success("排序未变化");
      return;
    }

    setOrderMutation.mutate({ id: row.id, sortOrder: value });
  };

  const cancelOrder = (id: number) => {
    setOrderDrafts((current) => withoutOrderDraft(current, id));
  };

  const rangeStart = total === 0 ? 0 : (search.page - 1) * search.pageSize + 1;
  const rangeEnd = Math.min(search.page * search.pageSize, total);

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold text-lg tracking-tight">人员名单</h2>
          <p className="text-muted-foreground text-sm">
            维护本场活动的参与人员及其所属团体、负责人等活动关系。人员基础信息在全量人员库维护，这里只管当前活动的参与关系。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setCreateForm(emptyRelationForm);
              setCreateOwnerPhone("");
              setCreateOpen(true);
            }}
          >
            手动录入
          </Button>
          <Button
            onClick={() => {
              setAddForm(emptyRelationForm);
              setAddOwnerPhone("");
              setPickerOpen(true);
            }}
          >
            <PlusIcon />
            从已有人员选择
          </Button>
        </div>
      </div>

      <FilterBar
        onSubmit={() =>
          applyFilter({
            name: nameInput.trim() || undefined,
            ownerName: ownerInput.trim() || undefined,
            organizationId: organizationInput ?? undefined,
          })
        }
      >
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="w-52 pl-8"
            placeholder="搜索姓名"
            value={nameInput}
            onChange={(event) => setNameInput(event.target.value)}
          />
        </div>
        <Select
          items={organizationFilterItems}
          value={organizationInput}
          disabled={
            organizationOptionsQuery.isPending ||
            organizationOptionsQuery.isError
          }
          onValueChange={(value) =>
            setOrganizationInput(value == null ? null : Number(value))
          }
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {organizationFilterItems.map((item) => (
                <SelectItem key={item.value ?? "all"} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {organizationOptionsQuery.isError && (
          <Button
            type="button"
            variant="destructive"
            onClick={() => organizationOptionsQuery.refetch()}
          >
            团体选项加载失败，重试
          </Button>
        )}
        <Input
          className="w-44"
          placeholder="搜索负责人"
          value={ownerInput}
          onChange={(event) => setOwnerInput(event.target.value)}
        />
        <FilterActions
          onReset={() => {
            setNameInput("");
            setOwnerInput("");
            setOrganizationInput(null);
            navigate({ search: { page: 1, pageSize: search.pageSize } });
          }}
        />
      </FilterBar>

      {(hasAppliedFilter ||
        hasUnsavedOrderEdits ||
        listQuery.isPlaceholderData ||
        (listQuery.isFetching && !listQuery.isPending)) &&
        !listQuery.isError && (
          <Alert>
            <AlertDescription>
              {hasUnsavedOrderEdits
                ? "存在未保存的排序编辑，请先保存或取消后再移动人员。"
                : hasAppliedFilter
                  ? "已应用筛选，暂不支持上移、下移或拖拽；仍可编辑排序数字。清除筛选后可移动。"
                  : "正在读取当前页，完成后恢复移动操作。"}
            </AlertDescription>
          </Alert>
        )}

      <div className="overflow-x-auto rounded-lg border bg-card shadow-sm">
        <DragDropProvider
          key={orderingRenderKey}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <Table className="min-w-[1340px]">
            <TableHeader className="bg-muted/60">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-16 text-center">序号</TableHead>
                <TableHead className="w-40 text-center">排序</TableHead>
                <TableHead className="min-w-44">人员</TableHead>
                <TableHead className="min-w-36">所属团体</TableHead>
                <TableHead className="min-w-24">负责人</TableHead>
                <TableHead className="min-w-28">录入渠道</TableHead>
                <TableHead className="min-w-52">参与环节</TableHead>
                <TableHead className="min-w-32">备注</TableHead>
                <TableHead className="min-w-80 text-center">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listQuery.isPending ? (
                Array.from({ length: 5 }, (_, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: 骨架屏没有身份
                  <TableRow key={index}>
                    {Array.from({ length: 9 }, (_, cell) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: 骨架屏没有身份
                      <TableCell key={cell}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : listQuery.isError ? (
                <TableRow>
                  <TableCell colSpan={9}>
                    <Alert variant="destructive">
                      <AlertCircleIcon />
                      <AlertTitle>人员列表加载失败</AlertTitle>
                      <AlertDescription className="flex flex-wrap items-center gap-3">
                        <span>{listQuery.error.message}</span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => listQuery.refetch()}
                        >
                          重试
                        </Button>
                      </AlertDescription>
                    </Alert>
                  </TableCell>
                </TableRow>
              ) : list.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9}>
                    <Empty className="border-0">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <UsersRoundIcon />
                        </EmptyMedia>
                        <EmptyTitle>本场活动还没有人员</EmptyTitle>
                        <EmptyDescription>
                          从全量人员库选人加入本活动，加入后可继续分配到具体环节。
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  </TableCell>
                </TableRow>
              ) : (
                list.map((row, index) => {
                  const orderDraft = orderDrafts[row.id];
                  const hasOrderDraft = orderDraft !== undefined;

                  return (
                    <ActivityMemberSortableRow
                      key={row.id}
                      id={row.id}
                      index={index}
                      disabled={movementDisabled}
                    >
                      {({ handleRef, isDragging }) => (
                        <>
                          <TableCell className="text-center text-muted-foreground">
                            {(search.page - 1) * search.pageSize + index + 1}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-center gap-1.5">
                              <Input
                                aria-label={`排序 ${row.name}`}
                                className="h-8 w-20 text-center tabular-nums"
                                inputMode="numeric"
                                placeholder="-"
                                value={
                                  orderDraft ??
                                  formatActivityMemberSortOrder(row.sortOrder)
                                }
                                disabled={setOrderMutation.isPending}
                                onChange={(event) =>
                                  setOrderDrafts((current) =>
                                    event.target.value ===
                                    formatActivityMemberSortOrder(row.sortOrder)
                                      ? withoutOrderDraft(current, row.id)
                                      : {
                                          ...current,
                                          [row.id]: event.target.value,
                                        },
                                  )
                                }
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    saveOrder(row);
                                  }
                                  if (event.key === "Escape") {
                                    event.preventDefault();
                                    cancelOrder(row.id);
                                  }
                                }}
                              />
                              {hasOrderDraft && (
                                <div className="flex items-center gap-0.5">
                                  <Button
                                    variant="ghost"
                                    size="xs"
                                    disabled={setOrderMutation.isPending}
                                    onClick={() => saveOrder(row)}
                                  >
                                    保存
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="xs"
                                    disabled={setOrderMutation.isPending}
                                    onClick={() => cancelOrder(row.id)}
                                  >
                                    取消
                                  </Button>
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{row.name}</div>
                            <div className="text-muted-foreground text-xs">
                              {[row.companyPosition, row.mobile]
                                .filter(Boolean)
                                .join(" · ") || "-"}
                            </div>
                          </TableCell>
                          <TableCell>
                            {row.organizationName || "未加入团体"}
                          </TableCell>
                          <TableCell>{row.ownerName || "-"}</TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="font-normal">
                              {RELATION_ORIGIN_LABELS[row.originType]}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {row.segments.length > 0 ? (
                              <ol className="flex min-w-48 flex-col gap-1">
                                {row.segments.map((segment, segmentIndex) => (
                                  <li
                                    key={segment.id}
                                    className="flex items-baseline gap-1.5"
                                  >
                                    <span className="w-4 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
                                      {segmentIndex + 1}.
                                    </span>
                                    <span>{segment.name}</span>
                                  </li>
                                ))}
                              </ol>
                            ) : (
                              "-"
                            )}
                          </TableCell>
                          <TableCell className="max-w-40 truncate text-muted-foreground">
                            {row.remark || "-"}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-center">
                            <div className="inline-flex items-center gap-1">
                              <Button
                                ref={handleRef}
                                variant="ghost"
                                size="icon-xs"
                                type="button"
                                disabled={movementDisabled}
                                aria-label={`拖动 ${row.name}`}
                                title={`拖动 ${row.name}`}
                              >
                                <GripVerticalIcon />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                type="button"
                                disabled={movementDisabled || index === 0}
                                aria-label={`上移 ${row.name}`}
                                title="上移"
                                onClick={() => {
                                  const intent =
                                    createActivityMemberAdjacentMoveIntent(
                                      visibleIds,
                                      row.id,
                                      "up",
                                    );
                                  if (intent) moveMutation.mutate(intent);
                                }}
                              >
                                <ArrowUpIcon />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                type="button"
                                disabled={
                                  movementDisabled || index === list.length - 1
                                }
                                aria-label={`下移 ${row.name}`}
                                title="下移"
                                onClick={() => {
                                  const intent =
                                    createActivityMemberAdjacentMoveIntent(
                                      visibleIds,
                                      row.id,
                                      "down",
                                    );
                                  if (intent) moveMutation.mutate(intent);
                                }}
                              >
                                <ArrowDownIcon />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-primary hover:text-primary"
                                disabled={isDragging}
                                onClick={() => setViewing(row)}
                              >
                                详情
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-primary hover:text-primary"
                                disabled={isDragging}
                                onClick={() => {
                                  setEditSegmentIds([]);
                                  setEditSelectionFor(undefined);
                                  setEditIssue(undefined);
                                  setEditing(row);
                                  setEditForm({
                                    source: row.source ?? "",
                                    groupName: row.groupName ?? "",
                                    ownerName: row.ownerName ?? "",
                                    remark: row.remark ?? "",
                                  });
                                  setEditOwnerPhone(row.ownerPhone ?? "");
                                }}
                              >
                                编辑关系
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                disabled={isDragging}
                                onClick={() => setRemoving(row)}
                              >
                                移除
                              </Button>
                            </div>
                          </TableCell>
                        </>
                      )}
                    </ActivityMemberSortableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </DragDropProvider>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-muted-foreground text-sm">
          第 {rangeStart}-{rangeEnd} 条 / 共 {total} 条
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
            disabled={rangeEnd >= total}
            onClick={() =>
              navigate({ search: (prev) => ({ ...prev, page: prev.page + 1 }) })
            }
          >
            下一页
          </Button>
        </div>
      </div>

      <ActivityMemberDetailDialog
        member={viewing}
        onOpenChange={(open) => {
          if (!open) setViewing(undefined);
        }}
      />

      {/* 「本项目人员」放在前面当默认：加活动人员时绝大多数时候是从本项目
          已有的人里挑，全量库是名单上确实来了新人时才翻的兜底。 */}
      <MemberPickerDialog
        open={pickerOpen}
        title="从已有人员选择"
        description="选中的人员将加入本场活动；若他们还不在本项目内，系统会自动补齐项目人员关系。"
        scopes={[
          { value: "project", label: "本项目人员", projectId },
          { value: "all", label: "全量人员库" },
        ]}
        excludeIds={memberSnapshotQuery.data ?? list.map((row) => row.memberId)}
        excludeIdsPending={memberSnapshotQuery.isPending}
        excludeIdsError={memberSnapshotQuery.error?.message}
        organization={{
          hint: "按团体添加会把最终勾选人员加入本活动；尚未进入本项目的人员会自动补齐项目关系，并分别记录范围团体快照。",
          submitting: organizationAddMutation.isPending,
          onConfirm: (input) => organizationAddMutation.mutateAsync(input),
        }}
        onOpenChange={setPickerOpen}
        onConfirm={(memberIds) => {
          setPendingIds(memberIds);
          setPickerOpen(false);
        }}
        onCreateNew={() => {
          setPickerOpen(false);
          setCreateForm(emptyRelationForm);
          setCreateOwnerPhone("");
          setCreateOpen(true);
        }}
      />

      <MemberQuickCreateDialog
        open={createOpen}
        title="手动录入活动人员"
        description="全量人员库里还没有这个人时用这个入口。保存后会同时建立主档、项目关系和本活动关系。"
        submitting={createMutation.isPending}
        extraFields={
          <RelationFields
            value={createForm}
            onChange={setCreateForm}
            idPrefix="new"
            ownerPhone={{
              value: createOwnerPhone,
              onChange: setCreateOwnerPhone,
            }}
          />
        }
        onOpenChange={setCreateOpen}
        onSubmit={(fields) => createMutation.mutate(fields)}
      />

      {/* 选完人再填关系字段：原型 activity-members.html 就是一组表单配一次
          多选，负责人/备注整批套用；来源、分组暂时隐藏，已有值仍由接口保留。 */}
      <Dialog
        open={pendingIds.length > 0}
        onOpenChange={(open) => {
          if (!open) setPendingIds([]);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>设置活动关系</DialogTitle>
            <DialogDescription>
              这 {pendingIds.length} 人将套用同一组关系字段，加入后可逐条调整。
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <RelationFields
              value={addForm}
              onChange={setAddForm}
              idPrefix="add"
              ownerPhone={{ value: addOwnerPhone, onChange: setAddOwnerPhone }}
            />
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingIds([])}>
              取消
            </Button>
            <Button
              disabled={addMutation.isPending}
              onClick={() => addMutation.mutate(pendingIds)}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open && !editMutation.isPending) setEditing(undefined);
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>编辑活动关系</DialogTitle>
            <DialogDescription>
              {`配置「${editing?.name}」的关系字段与参与环节。保存时先同步环节；若被座位或行程阻断，关系字段不会提交。`}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-6">
            {editDetailQuery.isPending ||
            editSegmentOptionsQuery.isPending ||
            editSelectionFor !== editing?.id ? (
              <div className="flex flex-col gap-4">
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-56 w-full" />
              </div>
            ) : editDetailQuery.isError || editSegmentOptionsQuery.isError ? (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertTitle>参与环节加载失败</AlertTitle>
                <AlertDescription>
                  {editDetailQuery.error?.message ??
                    editSegmentOptionsQuery.error?.message ??
                    "请关闭弹窗后重试"}
                </AlertDescription>
              </Alert>
            ) : editDetailQuery.data && editSegmentOptionsQuery.data ? (
              <>
                <RelationFields
                  value={editForm}
                  onChange={setEditForm}
                  idPrefix="edit"
                  ownerPhone={{
                    value: editOwnerPhone,
                    onChange: setEditOwnerPhone,
                  }}
                />
                <ActivityMemberParticipationFields
                  segments={editSegmentOptionsQuery.data}
                  memberships={editDetailQuery.data.segments}
                  selectedIds={editSegmentIds}
                  disabled={editMutation.isPending}
                  onChange={(next) => {
                    setEditSegmentIds(next);
                    if (editIssue?.kind === "blocked") {
                      setEditIssue(undefined);
                    }
                  }}
                />
                {editIssue && (
                  <ActivityMemberEditIssueAlert issue={editIssue} />
                )}
              </>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={editMutation.isPending}
              onClick={() => setEditing(undefined)}
            >
              取消
            </Button>
            <Button
              disabled={
                editMutation.isPending ||
                editDetailQuery.isPending ||
                editSegmentOptionsQuery.isPending ||
                editDetailQuery.isError ||
                editSegmentOptionsQuery.isError ||
                editSelectionFor !== editing?.id
              }
              onClick={() => editMutation.mutate()}
            >
              {editMutation.isPending ? "保存中…" : "保存关系与参与环节"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* BR-DEV-029 的二次确认。清单由后端 /impact 给，前端不自己拼文案——
          将来排位、资源绑定、邀请函接进去时，这里一个字都不用改。 */}
      <Dialog
        open={!!removing}
        onOpenChange={(open) => {
          if (!open) setRemoving(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认移除该活动人员？</DialogTitle>
            <DialogDescription>
              {`将解除「${removing?.name}」在本场活动下的参与关系。人员主档和项目人员关系保留，之后仍可重新加入。`}
            </DialogDescription>
          </DialogHeader>

          <DialogBody>
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              {impactQuery.isPending ? (
                <Skeleton className="h-5 w-2/3" />
              ) : impactQuery.data && impactQuery.data.items.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <p className="font-medium text-destructive">
                    以下关联内容会被一并解除，且不支持复原：
                  </p>
                  {impactQuery.data.items.map((item) => (
                    <div key={item.kind}>
                      <span className="text-muted-foreground">
                        {item.label}：
                      </span>
                      {item.names.join("、")}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">
                  该人员暂无其他关联内容。
                </p>
              )}
            </div>
          </DialogBody>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(undefined)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={removeMutation.isPending || impactQuery.isPending}
              onClick={() => removing && removeMutation.mutate(removing)}
            >
              确认移除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type ActivityMemberDetailDialogProps = {
  member?: ActivityMember;
  onOpenChange: (open: boolean) => void;
};

function ActivityMemberDetailDialog({
  member,
  onOpenChange,
}: ActivityMemberDetailDialogProps) {
  return (
    <Dialog open={!!member} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl" showCloseButton={false}>
        <DialogHeader className="flex-row items-center justify-between pr-6">
          <DialogTitle>活动人员详情</DialogTitle>
          <DialogClose render={<Button variant="ghost" size="sm" />}>
            关闭
          </DialogClose>
        </DialogHeader>
        {member && <ActivityMemberDetailContent id={member.id} />}
      </DialogContent>
    </Dialog>
  );
}

function ActivityMemberDetailContent({ id }: { id: number }) {
  const detailQuery = useQuery(activityMemberDetailQueryOptions(id));
  const [masterMemberId, setMasterMemberId] = useState<number>();

  if (detailQuery.isPending) {
    return (
      <DialogBody className="flex flex-col gap-4">
        {Array.from({ length: 3 }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 骨架屏没有身份
          <Skeleton className="h-44 w-full" key={index} />
        ))}
      </DialogBody>
    );
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <DialogBody>
        <Empty className="rounded-lg border border-dashed py-10">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UsersRoundIcon />
            </EmptyMedia>
            <EmptyTitle>活动人员详情加载失败</EmptyTitle>
            <EmptyDescription>请关闭弹窗后重试。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </DialogBody>
    );
  }

  const detail = detailQuery.data;
  const contact = [detail.mobile, detail.phone].filter(Boolean).join(" / ");

  return (
    <DialogBody className="flex flex-col gap-4">
      <DetailCard
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMasterMemberId(detail.memberId)}
          >
            查看主档
          </Button>
        }
        title="人员主档摘要"
      >
        <dl className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
          <DetailField label="姓名">{displayValue(detail.name)}</DetailField>
          <DetailField label="性别">{displayValue(detail.gender)}</DetailField>
          <DetailField label="国别/地区">
            {displayValue(detail.countryRegion)}
          </DetailField>
          <DetailField label="籍贯">
            {formatNativePlace(detail.nativeProvince, detail.nativeCity)}
          </DetailField>
          <DetailField label="职务">
            {displayValue(detail.companyPosition)}
          </DetailField>
          <DetailField label="证件类型">
            {displayValue(detail.idType)}
          </DetailField>
          <DetailField label="证件号码">
            {maskIdNumber(detail.idNumber)}
          </DetailField>
          <DetailField label="联系方式">{contact || "-"}</DetailField>
          <DetailField label="邮箱">{displayValue(detail.email)}</DetailField>
          <DetailField label="语种">
            {displayValue(detail.language)}
          </DetailField>
        </dl>
      </DetailCard>

      <DetailCard title="当前活动关系">
        <dl className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
          <DetailField label="负责人">
            {displayValue(detail.ownerName)}
          </DetailField>
          <DetailField label="负责人电话">
            {displayValue(detail.ownerPhone)}
          </DetailField>
          <DetailField label="数据来源">
            {RELATION_ORIGIN_LABELS[detail.originType]}
          </DetailField>
          <div className="sm:col-span-2 lg:col-span-4">
            <dt className="font-medium text-sm">备注</dt>
            <dd className="mt-1 whitespace-pre-wrap text-sm leading-6">
              {displayValue(detail.remark)}
            </dd>
          </div>
        </dl>
      </DetailCard>

      <DetailCard title="环节参与">
        <SegmentParticipationTable detail={detail} />
      </DetailCard>

      <MemberDetailDialog
        memberId={masterMemberId}
        hideActivityRelationFields
        onOpenChange={(open) => {
          if (!open) setMasterMemberId(undefined);
        }}
      />
    </DialogBody>
  );
}

function DetailCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card size="sm" className="shrink-0">
      <CardHeader className="border-b">
        <CardTitle>{title}</CardTitle>
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function DetailField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <dt className="font-medium text-sm">{label}</dt>
      <dd className="mt-1 break-words text-sm leading-6">{children}</dd>
    </div>
  );
}

function SegmentParticipationTable({
  detail,
}: {
  detail: ActivityMemberDetail;
}) {
  // 详情沿用“当前参与”口径；作废历史只在编辑弹窗的只读区展示。
  const currentSegments = detail.segments.filter(
    (segment) => segment.status === "active",
  );

  if (currentSegments.length === 0) {
    return (
      <Empty className="border-0 py-8">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UsersRoundIcon />
          </EmptyMedia>
          <EmptyTitle>暂未参与任何环节</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Table>
      <TableHeader className="bg-muted/60">
        <TableRow className="hover:bg-transparent">
          <TableHead className="min-w-32">环节</TableHead>
          <TableHead className="min-w-24">环节身份</TableHead>
          <TableHead className="min-w-24">负责人</TableHead>
          <TableHead className="min-w-24">排位状态</TableHead>
          <TableHead className="min-w-40">座位</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {currentSegments.map((segment) => (
          <TableRow key={segment.id}>
            <TableCell className="font-medium">{segment.name}</TableCell>
            <TableCell>{displayValue(segment.segmentRole)}</TableCell>
            <TableCell>{displayValue(segment.ownerName)}</TableCell>
            <TableCell>
              <SeatingStatusBadge status={segment.seatingStatus} />
            </TableCell>
            <TableCell>{formatSeat(segment)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

type SeatingStatus = NonNullable<
  ActivityMemberDetail["segments"][number]["seatingStatus"]
>;

const SEATING_STATUS_LABELS = {
  pending: "待确认",
  confirmed: "已确认",
  rejected: "已退回",
  voided: "已作废",
} as const satisfies Record<SeatingStatus, string>;

function SeatingStatusBadge({ status }: { status: SeatingStatus | null }) {
  if (!status) return <Badge variant="outline">未配置</Badge>;

  return (
    <Badge variant={status === "confirmed" ? "default" : "secondary"}>
      {SEATING_STATUS_LABELS[status]}
    </Badge>
  );
}

function formatSeat(segment: ActivityMemberDetail["segments"][number]) {
  if (segment.seatLabel && segment.seatingStatus !== "confirmed") {
    return "待确认后展示";
  }

  return (
    [segment.venueName, segment.zoneName, segment.seatLabel]
      .filter(Boolean)
      .join(" ") || "-"
  );
}

function maskIdNumber(value: string | null) {
  if (!value) return "-";
  if (value.length <= 8) return value;

  const headLength = value.length >= 14 ? 6 : 2;
  const tailLength = 4;
  return `${value.slice(0, headLength)}${"*".repeat(
    value.length - headLength - tailLength,
  )}${value.slice(-tailLength)}`;
}

function displayValue(value: string | null | undefined) {
  return value || "-";
}

function readActivityMemberRelationId(id: string | number | undefined) {
  return typeof id === "number" && Number.isSafeInteger(id) ? id : undefined;
}

function readActivityMemberSortableIndex(
  source: DragEndEvent["operation"]["source"],
) {
  if (!source || !("index" in source)) return undefined;

  const index = (source as { index?: unknown }).index;
  return typeof index === "number" && Number.isInteger(index)
    ? index
    : undefined;
}

function readKeyboardDirection(event: Event | undefined) {
  const code =
    event && "code" in event
      ? String((event as KeyboardEvent).code)
      : undefined;
  if (code === "ArrowUp") return "up" as const;
  if (code === "ArrowDown") return "down" as const;
  return undefined;
}

function readDragPointerY(event: Event | undefined, fallback?: number) {
  const clientY =
    event && "clientY" in event
      ? (event as Event & { clientY?: unknown }).clientY
      : undefined;
  if (typeof clientY === "number" && Number.isFinite(clientY)) {
    return clientY;
  }

  return typeof fallback === "number" && Number.isFinite(fallback)
    ? fallback
    : undefined;
}

function readActivityMemberDropTarget(event: Event | undefined) {
  const position = readDragPointerPosition(event);
  if (!position) return undefined;

  const eventTarget = event?.target as
    | (EventTarget & { ownerDocument?: Document })
    | null
    | undefined;
  const ownerDocument =
    eventTarget?.ownerDocument ??
    (typeof document === "undefined" ? undefined : document);
  if (!ownerDocument) return { id: undefined };

  const element = ownerDocument.elementFromPoint(position.x, position.y);
  // Table hit testing can return the TABLE element while the sortable plugin is
  // moving a row. Fall back to its live rectangles so a fast pointerup still
  // resolves the row that visually contains the pointer.
  const row =
    element?.closest<HTMLElement>("[data-activity-member-id]") ??
    Array.from(
      ownerDocument.querySelectorAll<HTMLElement>("[data-activity-member-id]"),
    ).find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return (
        position.x >= rect.left &&
        position.x <= rect.right &&
        position.y >= rect.top &&
        position.y <= rect.bottom
      );
    });
  const idValue = row?.getAttribute("data-activity-member-id");
  const id =
    idValue === null || idValue === undefined ? undefined : Number(idValue);
  if (id === undefined || !Number.isSafeInteger(id) || !row) {
    return { id: undefined };
  }

  const rect = row.getBoundingClientRect();
  const centerY = rect.top + rect.height / 2;
  return {
    id,
    centerY: Number.isFinite(centerY) ? centerY : undefined,
  };
}

function readDragPointerPosition(event: Event | undefined) {
  const clientX =
    event && "clientX" in event
      ? (event as Event & { clientX?: unknown }).clientX
      : undefined;
  const clientY =
    event && "clientY" in event
      ? (event as Event & { clientY?: unknown }).clientY
      : undefined;
  if (
    typeof clientX !== "number" ||
    !Number.isFinite(clientX) ||
    typeof clientY !== "number" ||
    !Number.isFinite(clientY)
  ) {
    return undefined;
  }

  return { x: clientX, y: clientY };
}

function withoutOrderDraft(drafts: Record<number, string>, id: number) {
  if (drafts[id] === undefined) return drafts;

  const next = { ...drafts };
  delete next[id];
  return next;
}
