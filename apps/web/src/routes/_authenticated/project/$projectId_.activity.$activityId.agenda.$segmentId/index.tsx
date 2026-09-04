import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  useBlocker,
  useNavigate,
} from "@tanstack/react-router";
import { ArrowLeftIcon, Loader2Icon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { agendaKeys, agendaQueryOptions } from "#/features/agenda/queries";
import { segmentMemberKeys } from "#/features/member/relation-queries.ts";
import { activityDetailQueryOptions } from "#/features/project/queries";
import {
  activityResourceKeys,
  resourceDemandKeys,
} from "#/features/resource/queries.ts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "#/shared/components/ui/alert-dialog.tsx";
import { Button } from "#/shared/components/ui/button.tsx";
import { Skeleton } from "#/shared/components/ui/skeleton.tsx";
import { seatingKeys } from "../-venue-queries";
import { BasicSection } from "./-components/basic-section";
import { DemandsSection } from "./-components/demands-section";
import { MembersSection } from "./-components/members-section";
import { SeatingSection } from "./-components/seating-section";
import {
  addManualMember,
  addNewResource,
  addPickedMembers,
  bindMemberToResource,
  buildSavePayload,
  type ConfigDraft,
  createEmptyDraft,
  detachResource,
  draftFromConfig,
  isDirty,
  linkExistingResource,
  removeMember,
  setDemandField,
  setMemberRole,
  setResourceField,
  unbindMemberFromResource,
  voidResource,
} from "./-draft";
import {
  saveSegmentConfig,
  segmentConfigKeys,
  segmentConfigQueryOptions,
} from "./-queries";

/**
 * 环节配置页：基础信息 / 环节人员 / 需求与资源安排 / 排位（只读），
 * **整页原子保存**。
 *
 * `$segmentId` 传字面量 `new` 就是新建。用同一个页面而不是两套，是因为除了
 * 排位那一块（新建时没有 id，显示占位），四块内容和保存路径完全一样——维护
 * 两份"精简版新增页 + 完整版编辑页"只会让它们慢慢长歪。
 *
 * ⚠️ 这个页面和旧的四个弹窗**同时存在**（议程页的入口没动）。两边写的是同一
 * 批表、过同一套约束，所以并存是安全的——**前提是这边发的是"意图"而不是
 * "目标状态"**，见 -draft.ts 顶部那段。
 */
export const Route = createFileRoute(
  "/_authenticated/project/$projectId_/activity/$activityId/agenda/$segmentId/",
)({
  loader: ({ context, params }) => {
    const activityId = Number(params.activityId);
    const segmentId = Number(params.segmentId);

    return Promise.all([
      // 议程线（选议程线要用）和活动信息（提示环节时间超范围）两个前置数据，
      // 和配置本身一起预取——分开取等于给首屏排了条瀑布。
      context.queryClient.ensureQueryData(agendaQueryOptions(activityId)),
      context.queryClient.ensureQueryData(
        activityDetailQueryOptions(activityId),
      ),
      Number.isFinite(segmentId)
        ? context.queryClient.ensureQueryData(
            segmentConfigQueryOptions(segmentId),
          )
        : null,
    ]);
  },
  component: SegmentConfigPage,
});

function SegmentConfigPage() {
  const params = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const activityId = Number(params.activityId);
  const projectId = Number(params.projectId);
  const isNew = params.segmentId === "new";
  const segmentId = isNew ? null : Number(params.segmentId);

  const agendaQuery = useQuery(agendaQueryOptions(activityId));
  const activityQuery = useQuery(activityDetailQueryOptions(activityId));
  const configQuery = useQuery({
    ...segmentConfigQueryOptions(segmentId ?? 0),
    enabled: segmentId !== null,
  });

  const lines = useMemo(
    () => agendaQuery.data?.lines ?? [],
    [agendaQuery.data],
  );
  const mainLineId = lines.find((line) => line.lineType === "main")?.id ?? null;

  /**
   * 服务端当前状态翻成的草稿形状。
   *
   * 它**不是**"未改动的基准"——基准是下面的 `seed`。两者要分开，是因为保存
   * 成功后要重新载入一份权威数据，而那次 refetch 是异步的：如果直接拿 initial
   * 当基准，保存完的一瞬间 initial 还是旧数据，页面就会一直显示"有未保存的
   * 改动"，而且用户刚存进去的值会被旧数据冲掉。
   */
  const loaded = useMemo<ConfigDraft | null>(() => {
    if (isNew) return createEmptyDraft();
    if (!configQuery.data) return null;

    const lineId = configQuery.data.segment.agendaLineId;
    const lineKey = lineId === mainLineId ? "main" : String(lineId);
    return draftFromConfig(configQuery.data, lineKey);
  }, [isNew, configQuery.data, mainLineId]);

  const [draft, setDraft] = useState<ConfigDraft | null>(null);
  /** 当前草稿是从哪一版服务端数据长出来的。`dirty` 和「取消」都以它为基准。 */
  const [seed, setSeed] = useState<ConfigDraft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);

  /**
   * 数据到了就灌草稿。两条守卫缺一不可：
   *
   * 1. **用户正在改就不动。** 后台 refetch（别人改了、窗口重新聚焦）不能把他
   *    正在填的东西冲掉。
   * 2. **数据没变就不动。** 按值比而不是按引用比——refetch 每次都给新对象，
   *    按引用比会变成每轮都重灌一次草稿，光标和滚动位置全丢。
   *
   * 保存成功后把 draft/seed 一起清空，就会走这里重新灌一次；服务端那次
   * refetch 晚一点回来也没关系——那时草稿是干净的，第 2 条会放它进来。
   */
  useEffect(() => {
    if (!loaded) return;
    if (draft !== null && seed !== null && isDirty(draft, seed)) return;
    if (seed !== null && !isDirty(loaded, seed)) return;
    setSeed(loaded);
    setDraft(loaded);
  }, [loaded, draft, seed]);

  const dirty = draft !== null && seed !== null && isDirty(draft, seed);

  const saveMutation = useMutation({
    mutationFn: saveSegmentConfig,
    onSuccess: (result) => {
      // 「需要确认」不是失败：入参合法，只是会连带解除排位，得让用户点头。
      if (result.status === "needsConfirm") {
        setConfirmMessage(result.message);
        return;
      }

      toast.success("已保存");
      setErrors({});
      setConfirmMessage(null);

      // 这一次保存可能碰了 8 张表，相关的缓存一次全清——只失效议程的话，
      // 议程页的人员冲突提示和资源 chip 会停在旧数字上。
      queryClient.invalidateQueries({ queryKey: agendaKeys.all });
      queryClient.invalidateQueries({ queryKey: segmentConfigKeys.all });
      queryClient.invalidateQueries({ queryKey: segmentMemberKeys.all });
      queryClient.invalidateQueries({ queryKey: resourceDemandKeys.all });
      queryClient.invalidateQueries({ queryKey: activityResourceKeys.all });
      queryClient.invalidateQueries({ queryKey: seatingKeys.all });

      if (isNew) {
        navigate({
          to: "/project/$projectId/activity/$activityId/agenda/$segmentId",
          params: {
            projectId: params.projectId,
            activityId: params.activityId,
            segmentId: String(result.segmentId),
          },
          replace: true,
        });
        return;
      }

      // 重新载入一份权威数据，草稿跟着重建。清掉 seed 是关键——不清的话
      // 上面那条"用户正在改就不动"的守卫会一直认为草稿是脏的，页面永远显示
      // "有未保存的改动"，而且刚存进去的值会被下一次 refetch 冲回旧值。
      setSeed(null);
      setDraft(null);
    },
    onError: (error) => {
      const message = error.message || "保存失败";
      toast.error(message);
      // 服务端会带上出错的区块，滚过去——四块合一之后一句"保存失败"没法用。
      const path = (error as { path?: string }).path;
      if (path) scrollToSection(path);
    },
  });

  /**
   * 离开拦截。有未保存改动时不直接放行，也不只是警告——警告等于把"你刚填的
   * 半小时白填了"的选择权交给一个正在赶时间的运营。这里是「先保存再走」。
   *
   * 同一套同时管路由跳转和关标签页（enableBeforeUnload）。
   */
  const blocker = useBlocker({
    shouldBlockFn: () => dirty && !saveMutation.isPending,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  });

  if (agendaQuery.isPending || (segmentId !== null && configQuery.isPending)) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (draft === null) {
    return (
      <div className="p-6">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const update = (next: ConfigDraft) => setDraft(next);

  const validate = () => {
    const found: Record<string, string> = {};
    if (!draft.base.name.trim()) found.name = "环节名称不能为空";
    if (!draft.base.startTime) found.startTime = "开始时间不能为空";
    if (!draft.base.endTime) found.endTime = "结束时间不能为空";
    if (
      draft.base.startTime &&
      draft.base.endTime &&
      new Date(draft.base.startTime) > new Date(draft.base.endTime)
    ) {
      found.endTime = "结束时间不能早于开始时间";
    }
    if (draft.base.lineKey === "new" && !draft.base.newLineName.trim()) {
      found.newLineName = "新建并行线必须填写线路名称";
    }
    setErrors(found);
    if (Object.keys(found).length > 0) scrollToSection("base");
    return Object.keys(found).length === 0;
  };

  const submit = (cascadeSeats: boolean) => {
    if (!validate()) return;
    saveMutation.mutate(
      buildSavePayload({
        draft,
        activityId,
        segmentId,
        mainLineId,
        cascadeSeats,
      }),
    );
  };

  const handleCancel = () => {
    if (!dirty) {
      navigate({
        to: "/project/$projectId/activity/$activityId/agenda",
        params: {
          projectId: params.projectId,
          activityId: params.activityId,
        },
      });
      return;
    }

    setCancelConfirmOpen(true);
  };

  const activityRange = activityQuery.data
    ? {
        start: activityQuery.data.startTime,
        end: activityQuery.data.endTime,
      }
    : null;

  return (
    <div className="flex flex-col gap-4 p-6 pb-24">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            navigate({
              to: "/project/$projectId/activity/$activityId/agenda",
              params: {
                projectId: params.projectId,
                activityId: params.activityId,
              },
            })
          }
        >
          <ArrowLeftIcon />
          返回议程
        </Button>
      </div>

      <div>
        <h1 className="font-semibold text-xl">
          {isNew ? "新增环节" : `环节配置：${draft.base.name || "未命名"}`}
        </h1>
        <p className="mt-1 text-muted-foreground text-sm">
          所属活动：{activityQuery.data?.name ?? "-"}
        </p>
      </div>

      <BasicSection
        base={draft.base}
        lines={lines}
        activityRange={activityRange}
        errors={errors}
        onChange={(field, value) =>
          update({ ...draft, base: { ...draft.base, [field]: value } })
        }
      />

      <MembersSection
        enabled={draft.base.memberEnabled}
        members={draft.members}
        projectId={projectId}
        activityId={activityId}
        onToggle={(checked) =>
          update({
            ...draft,
            base: { ...draft.base, memberEnabled: checked },
          })
        }
        onAddPicked={(rows) => update(addPickedMembers(draft, rows))}
        onAddManual={(member) => update(addManualMember(draft, member))}
        onRemove={(key) => update(removeMember(draft, key))}
        onRoleChange={(key, role) => update(setMemberRole(draft, key, role))}
      />

      <DemandsSection
        demands={draft.demands}
        members={draft.members}
        activityId={activityId}
        onToggleType={(type, enabled) =>
          update(setDemandField(draft, type, "enabled", enabled))
        }
        onFieldChange={(type, field, value) =>
          update(setDemandField(draft, type, field, value))
        }
        onAddResource={(type) => update(addNewResource(draft, type))}
        onLinkResource={(type, resource) =>
          update(linkExistingResource(draft, type, resource))
        }
        onResourceFieldChange={(type, key, field, value) =>
          update(setResourceField(draft, type, key, field, value))
        }
        onDetachResource={(type, key) =>
          update(detachResource(draft, type, key))
        }
        onVoidResource={(type, key) => update(voidResource(draft, type, key))}
        onBindMember={(type, resourceKey, member) =>
          update(bindMemberToResource(draft, type, resourceKey, member))
        }
        onUnbindMember={(type, resourceKey, bindingKey) =>
          update(unbindMemberFromResource(draft, type, resourceKey, bindingKey))
        }
      />

      <SeatingSection
        enabled={draft.base.seatingEnabled}
        segmentId={segmentId}
        activityId={params.activityId}
        onToggle={(checked) =>
          update({
            ...draft,
            base: { ...draft.base, seatingEnabled: checked },
          })
        }
        onNavigate={({ planId }) =>
          navigate(
            planId === null
              ? {
                  to: "/project/$projectId/activity/$activityId/seating",
                  params: {
                    projectId: params.projectId,
                    activityId: params.activityId,
                  },
                }
              : {
                  to: "/project/$projectId/activity/$activityId/seating/$planId",
                  params: {
                    projectId: params.projectId,
                    activityId: params.activityId,
                    planId: String(planId),
                  },
                },
          )
        }
      />

      {/* 底部操作条固定住：这一页在真实数据下会很长，保存按钮不能只在最底下 */}
      <div className="-mx-6 sticky bottom-0 flex items-center justify-between gap-3 border-t bg-background/95 px-6 py-3 backdrop-blur">
        <span className="text-muted-foreground text-sm">
          {dirty ? "有未保存的改动" : "没有未保存的改动"}
        </span>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleCancel}
            disabled={saveMutation.isPending}
          >
            取消
          </Button>
          <Button
            type="button"
            onClick={() => submit(false)}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending && <Loader2Icon className="animate-spin" />}
            保存
          </Button>
        </div>
      </div>

      <AlertDialog
        open={cancelConfirmOpen}
        onOpenChange={setCancelConfirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认取消编辑？</AlertDialogTitle>
            <AlertDialogDescription>
              当前页面有未保存的内容，取消后这些内容将会丢失。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setCancelConfirmOpen(false);
                navigate({
                  to: "/project/$projectId/activity/$activityId/agenda",
                  params: {
                    projectId: params.projectId,
                    activityId: params.activityId,
                  },
                  ignoreBlocker: true,
                });
              }}
            >
              确认取消
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 移除已排座的人 → 服务端拒绝并点名到座位号，确认后带 cascadeSeats 重来 */}
      <AlertDialog
        open={confirmMessage !== null}
        onOpenChange={(open) => !open && setConfirmMessage(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认继续保存？</AlertDialogTitle>
            <AlertDialogDescription>{confirmMessage}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmMessage(null)}>
              再想想
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmMessage(null);
                submit(true);
              }}
            >
              确认并保存
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 离开拦截：可选择先保存再走，也可直接放弃改动前往目标页面。 */}
      <AlertDialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open && blocker.status === "blocked") blocker.reset();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>还有未保存的改动</AlertDialogTitle>
            <AlertDialogDescription>
              保存成功后会继续前往目标页面；直接前往会放弃当前未保存的改动。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                if (blocker.status === "blocked") blocker.reset();
              }}
            >
              留在本页
            </AlertDialogCancel>
            <AlertDialogAction
              variant="outline"
              onClick={() => {
                if (blocker.status === "blocked") blocker.proceed();
              }}
            >
              直接前往
            </AlertDialogAction>
            <AlertDialogAction
              onClick={() => {
                if (blocker.status !== "blocked") return;
                if (!validate()) {
                  blocker.reset();
                  return;
                }
                saveMutation.mutate(
                  buildSavePayload({
                    draft,
                    activityId,
                    segmentId,
                    mainLineId,
                    cascadeSeats: false,
                  }),
                  {
                    onSuccess: (result) => {
                      if (result.status === "needsConfirm") {
                        setConfirmMessage(result.message);
                        blocker.reset();
                        return;
                      }
                      blocker.proceed();
                    },
                    onError: () => blocker.reset(),
                  },
                );
              }}
            >
              保存并离开
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** 把服务端返回的错误路径（`demands.transport.resources.0`）映射到区块锚点。 */
function scrollToSection(path: string) {
  const head = path.split(".")[0];
  const id =
    head === "members"
      ? "section-members"
      : head === "demands"
        ? "section-demands"
        : "section-base";
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
}
