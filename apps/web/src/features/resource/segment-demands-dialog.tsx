import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "#/shared/components/ui/badge.tsx";
import { Button } from "#/shared/components/ui/button.tsx";
import { Checkbox } from "#/shared/components/ui/checkbox.tsx";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/shared/components/ui/dialog.tsx";
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
import { Textarea } from "#/shared/components/ui/textarea.tsx";
import { cn } from "#/shared/lib/utils.ts";
import {
  DEMAND_HANDLING_HINTS,
  DEMAND_HANDLING_ITEMS,
  DEMAND_STATUS_CHIP,
  DEMAND_STATUS_LABELS,
  RESOURCE_TYPE_BADGE_CLASS,
  RESOURCE_TYPE_LABELS,
  RESOURCE_TYPE_VALUES,
} from "./labels";
import {
  type DemandHandling,
  type ResourceType,
  resourceDemandKeys,
  resourceDemandListQueryOptions,
  saveSegmentDemands,
} from "./queries";

/** 一个资源类型在表单里的状态。enabled=false 时其余字段保留，方便误关后撤回。 */
type Draft = {
  enabled: boolean;
  handling: DemandHandling;
  description: string;
  estimatedCount: string;
  ownerName: string;
};

const emptyDraft = (): Draft => ({
  enabled: false,
  handling: "arrange",
  description: "",
  estimatedCount: "",
  ownerName: "",
});

type Drafts = Record<ResourceType, Draft>;

const emptyDrafts = (): Drafts =>
  Object.fromEntries(
    RESOURCE_TYPE_VALUES.map((type) => [type, emptyDraft()]),
  ) as Drafts;

/**
 * 环节资源需求声明。
 *
 * 入口是议程页环节行的独立按钮，**不内嵌在环节表单里**——环节表单已经有十来个
 * 字段，而且 BR-DEV-031A 的口径是"基础字段和议程线合法即可保存环节"，新建
 * 环节时不该被迫面对还不确定的资源问题。
 *
 * 交互是四个资源类型的开关一起提交（后端 saveForSegment 是整体替换语义）：
 * 勾掉某一类 = 删掉那条需求项。删除会连带解除它和台账记录的关联，所以有
 * 二次确认。
 *
 * ⚠️ 这里**没有用 TanStack Form**，是个有意的偏离（仓库默认表单都用它）。
 * 这不是一张字段表单，是「4 个类型 × 4 个字段」的矩阵，字段之间没有跨字段
 * 校验，唯一的约束（数量是非负整数）交给 input type=number + 服务端兜底就够。
 * 套 form 库要为每个格子拼一个 `demands.transport.description` 这样的路径名，
 * 换来的只是同一份必填校验——而这里一个必填项都没有。
 */
export function SegmentDemandsDialog({
  segmentId,
  segmentName,
  activityId,
  open,
  onOpenChange,
}: {
  segmentId: number | undefined;
  segmentName: string | undefined;
  activityId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Drafts>(emptyDrafts);

  const demandQuery = useQuery(resourceDemandListQueryOptions(activityId));

  const current = (demandQuery.data?.list ?? []).filter(
    (demand) => demand.segmentId === segmentId,
  );

  // 弹窗打开时把已有需求灌进草稿。依赖里带上 demandQuery.data 是必要的：
  // 打开时列表可能还在飞，数据回来之后要再灌一次，否则表单是空的。
  useEffect(() => {
    if (!open || !segmentId) return;
    const next = emptyDrafts();
    for (const demand of current) {
      next[demand.resourceType] = {
        enabled: true,
        handling: demand.handling,
        description: demand.description ?? "",
        estimatedCount:
          demand.estimatedCount === null ? "" : String(demand.estimatedCount),
        ownerName: demand.ownerName ?? "",
      };
    }
    setDrafts(next);
  }, [open, segmentId, demandQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (id: number) =>
      saveSegmentDemands({
        segmentId: id,
        demands: RESOURCE_TYPE_VALUES.filter(
          (type) => drafts[type].enabled,
        ).map((type) => {
          const draft = drafts[type];
          return {
            resourceType: type,
            handling: draft.handling,
            description: draft.description || undefined,
            estimatedCount:
              draft.estimatedCount === "" ? null : Number(draft.estimatedCount),
            ownerName: draft.ownerName || undefined,
          };
        }),
      }),
    onSuccess: () => {
      toast.success("资源需求已保存");
      queryClient.invalidateQueries({ queryKey: resourceDemandKeys.all });
      onOpenChange(false);
    },
    onError: (error) => toast.error(error.message),
  });

  const patch = (type: ResourceType, changes: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [type]: { ...prev[type], ...changes } }));

  /**
   * 关掉一类需求前先确认——保存后这条需求项会被删除，连带解除它和台账记录的
   * 关联（link 表上是 cascade）。填过的说明和负责人也一起没了。
   */
  const toggle = (type: ResourceType, next: boolean) => {
    if (!next) {
      const existing = current.find((demand) => demand.resourceType === type);
      const linked = existing && existing.activeResourceCount > 0;
      const confirmed = window.confirm(
        linked
          ? `关闭「${RESOURCE_TYPE_LABELS[type]}」需求后，它与 ${existing.activeResourceCount} 条资源记录的关联会一并解除（资源记录本身保留）。确定关闭？`
          : `关闭「${RESOURCE_TYPE_LABELS[type]}」需求后，已填写的说明和负责人不再保留。确定关闭？`,
      );
      if (!confirmed) return;
    }
    patch(type, { enabled: next });
  };

  const enabledCount = RESOURCE_TYPE_VALUES.filter(
    (type) => drafts[type].enabled,
  ).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>资源需求：{segmentName ?? "-"}</DialogTitle>
          <DialogDescription>
            按资源类型分别开启，不是一个总开关。这里只做需求声明，具体的车辆、
            酒店、物料明细在活动资源台账里维护。
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-3">
          {demandQuery.isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            RESOURCE_TYPE_VALUES.map((type) => {
              const draft = drafts[type];
              const existing = current.find(
                (demand) => demand.resourceType === type,
              );
              return (
                <div
                  key={type}
                  className={cn(
                    "rounded-lg border p-4 transition-colors",
                    draft.enabled ? "bg-card" : "bg-muted/40",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex cursor-pointer items-center gap-2">
                      <Checkbox
                        checked={draft.enabled}
                        onCheckedChange={(checked) => toggle(type, !!checked)}
                      />
                      <Badge
                        variant="outline"
                        className={RESOURCE_TYPE_BADGE_CLASS[type]}
                      >
                        {RESOURCE_TYPE_LABELS[type]}
                      </Badge>
                    </label>

                    {/* 已保存的需求才有派生状态可看——草稿还没进库，算不出来 */}
                    {existing && (
                      <Badge
                        variant="outline"
                        className={cn(
                          "border",
                          DEMAND_STATUS_CHIP[existing.status],
                        )}
                      >
                        {DEMAND_STATUS_LABELS[existing.status]}
                      </Badge>
                    )}
                    {existing && existing.activeResourceCount > 0 && (
                      <span className="text-muted-foreground text-xs">
                        已关联 {existing.activeResourceCount} 条资源记录
                        {existing.boundMemberCount > 0 &&
                          ` · 已绑 ${existing.boundMemberCount} 人`}
                      </span>
                    )}
                  </div>

                  {draft.enabled && (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Field>
                        <FieldLabel htmlFor={`${type}-handling`}>
                          处理要求
                        </FieldLabel>
                        {/* items 必传，否则 SelectValue 渲染的是 "arrange" */}
                        <Select
                          items={DEMAND_HANDLING_ITEMS}
                          value={draft.handling}
                          onValueChange={(value) =>
                            patch(type, { handling: value as DemandHandling })
                          }
                        >
                          <SelectTrigger id={`${type}-handling`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {DEMAND_HANDLING_ITEMS.map((item) => (
                              <SelectItem key={item.value} value={item.value}>
                                {item.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-muted-foreground text-xs">
                          {DEMAND_HANDLING_HINTS[draft.handling]}
                        </p>
                      </Field>

                      <div className="grid grid-cols-2 gap-3">
                        <Field>
                          <FieldLabel htmlFor={`${type}-count`}>
                            预计数量
                          </FieldLabel>
                          <Input
                            id={`${type}-count`}
                            type="number"
                            min={0}
                            value={draft.estimatedCount}
                            onChange={(e) =>
                              patch(type, { estimatedCount: e.target.value })
                            }
                            placeholder="选填"
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor={`${type}-owner`}>
                            需求负责人
                          </FieldLabel>
                          <Input
                            id={`${type}-owner`}
                            value={draft.ownerName}
                            onChange={(e) =>
                              patch(type, { ownerName: e.target.value })
                            }
                            placeholder="选填"
                          />
                        </Field>
                      </div>

                      <Field className="sm:col-span-2">
                        <FieldLabel htmlFor={`${type}-desc`}>
                          需求说明
                        </FieldLabel>
                        <Textarea
                          id={`${type}-desc`}
                          rows={2}
                          value={draft.description}
                          onChange={(e) =>
                            patch(type, { description: e.target.value })
                          }
                          placeholder="例如：演讲嘉宾 3 人从机场接站；全体参会人员闭幕后轻食茶歇"
                        />
                      </Field>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </DialogBody>

        <DialogFooter>
          <span className="mr-auto text-muted-foreground text-sm">
            已开启 {enabledCount} / {RESOURCE_TYPE_VALUES.length} 类
          </span>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={saveMutation.isPending || !segmentId}
            onClick={() => segmentId && saveMutation.mutate(segmentId)}
          >
            保存资源需求
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
