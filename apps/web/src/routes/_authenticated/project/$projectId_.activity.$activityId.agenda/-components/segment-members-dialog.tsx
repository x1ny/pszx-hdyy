import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { InfoIcon, PlusIcon, UsersRoundIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { MemberPickerDialog } from "#/features/member/member-picker-dialog.tsx";
import { MemberQuickCreateDialog } from "#/features/member/member-quick-create-dialog.tsx";
import { SegmentRoleField } from "#/features/member/relation-fields.tsx";
import {
  addNewSegmentMember,
  addSegmentMembers,
  type NewMemberFields,
  RELATION_ORIGIN_LABELS,
  removeSegmentMember,
  SEGMENT_MEMBER_ROLE_VALUES,
  type SegmentMember,
  segmentMemberKeys,
  segmentMemberListQueryOptions,
  updateSegmentMember,
} from "#/features/member/relation-queries.ts";
import { Badge } from "#/shared/components/ui/badge.tsx";
import { Button } from "#/shared/components/ui/button.tsx";
import {
  Dialog,
  DialogBody,
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

const ROLE_ITEMS = SEGMENT_MEMBER_ROLE_VALUES.map((value) => ({
  value,
  label: value,
}));

/**
 * 环节人员维护。
 *
 * 这个弹窗是补齐链路（BR-DEV-026）在界面上的验收点：从这里选一个全新的人，
 * 后端会在一个事务里把项目关系、活动关系、环节关系一次建齐，运营不需要先去
 * 上两层页面配置。所以顶部那句提示不是装饰，它是在告诉运营"你不用先去别处"。
 *
 * 来源/分组/负责人三列展示的是 COALESCE 之后的值——环节层没填就显示活动层的，
 * 并标一个"继承"。这三个字段的编辑本期只在活动人员页做：环节级覆盖是少数
 * 情况，先不给入口，避免运营在两层之间反复横跳还搞不清哪个生效。
 */
export function SegmentMembersDialog({
  segmentId,
  segmentName,
  projectId,
  activityId,
  open,
  onOpenChange,
}: {
  segmentId: number | undefined;
  segmentName: string | undefined;
  projectId: number;
  activityId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createRole, setCreateRole] = useState<string>("");
  const [removing, setRemoving] = useState<SegmentMember>();

  const listQuery = useQuery({
    ...segmentMemberListQueryOptions(segmentId ?? 0),
    enabled: open && !!segmentId,
  });
  const list = listQuery.data?.list ?? [];

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: segmentMemberKeys.all });

  const addMutation = useMutation({
    mutationFn: (memberIds: number[]) =>
      addSegmentMembers({
        segmentId: segmentId ?? 0,
        originType: "manual",
        entries: memberIds.map((memberId) => ({ memberId })),
      }),
    onSuccess: (result) => {
      toast.success(`已加入 ${result.added} 人，并已补齐活动 / 项目关系`);
      setPickerOpen(false);
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const createMutation = useMutation({
    mutationFn: (fields: NewMemberFields) =>
      addNewSegmentMember({
        segmentId: segmentId ?? 0,
        member: fields,
        segmentRole:
          (createRole as (typeof SEGMENT_MEMBER_ROLE_VALUES)[number]) ||
          undefined,
      }),
    onSuccess: () => {
      toast.success("已录入并加入本环节，同时补齐活动 / 项目关系和全量人员库");
      setCreateOpen(false);
      setCreateRole("");
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const roleMutation = useMutation({
    mutationFn: (input: { row: SegmentMember; role: string }) =>
      updateSegmentMember({
        id: input.row.id,
        segmentRole: input.role as (typeof SEGMENT_MEMBER_ROLE_VALUES)[number],
      }),
    onSuccess: () => {
      toast.success("环节身份已保存");
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const removeMutation = useMutation({
    mutationFn: (row: SegmentMember) => removeSegmentMember(row.id),
    onSuccess: () => {
      toast.success("已移出本环节");
      setRemoving(undefined);
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>环节人员维护</DialogTitle>
            <DialogDescription>
              {segmentName ? `环节：${segmentName}` : null}
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="flex flex-col gap-4">
          <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-muted-foreground text-sm">
            <InfoIcon className="mt-0.5 size-4 shrink-0" />
            <p>
              可以直接从全量人员库选人，不需要先到活动人员页配置。选中的人若还不在本活动或本项目内，系统会自动补齐这两层关系，并把录入渠道记为「环节入口补齐」。
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setCreateRole("");
                setCreateOpen(true);
              }}
            >
              手动录入
            </Button>
            <Button size="sm" onClick={() => setPickerOpen(true)}>
              <PlusIcon />
              从已有人员选择
            </Button>
          </div>

          {/* 滚动交给 DialogBody，这里不再套一层容器（见 ui/dialog.tsx）。 */}
          <div className="rounded-lg border">
            <Table>
              <TableHeader className="sticky top-0 bg-muted/60">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="min-w-40">人员</TableHead>
                  <TableHead className="w-40">环节身份</TableHead>
                  <TableHead className="min-w-28">来源</TableHead>
                  <TableHead className="min-w-28">分组</TableHead>
                  <TableHead className="min-w-24">负责人</TableHead>
                  <TableHead className="min-w-28">录入渠道</TableHead>
                  <TableHead className="w-20 text-center">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listQuery.isPending ? (
                  Array.from({ length: 3 }, (_, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: 骨架屏没有身份
                    <TableRow key={index}>
                      {Array.from({ length: 7 }, (_, cell) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: 骨架屏没有身份
                        <TableCell key={cell}>
                          <Skeleton className="h-5 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : list.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <Empty className="border-0">
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <UsersRoundIcon />
                          </EmptyMedia>
                          <EmptyTitle>本环节还没有人员</EmptyTitle>
                          <EmptyDescription>
                            从全量人员库选人加入本环节。
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    </TableCell>
                  </TableRow>
                ) : (
                  list.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <div className="font-medium">{row.name}</div>
                        <div className="text-muted-foreground text-xs">
                          {[row.companyPosition, row.mobile]
                            .filter(Boolean)
                            .join(" · ") || "-"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Select
                          items={ROLE_ITEMS}
                          value={row.segmentRole}
                          onValueChange={(value) =>
                            value &&
                            roleMutation.mutate({ row, role: String(value) })
                          }
                        >
                          <SelectTrigger size="sm" className="w-36">
                            <SelectValue placeholder="未设置" />
                          </SelectTrigger>
                          <SelectContent>
                            {ROLE_ITEMS.map((item) => (
                              <SelectItem key={item.value} value={item.value}>
                                {item.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>{row.source || "-"}</TableCell>
                      <TableCell>{row.groupName || "-"}</TableCell>
                      <TableCell>{row.ownerName || "-"}</TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          <Badge variant="secondary" className="font-normal">
                            {RELATION_ORIGIN_LABELS[row.originType]}
                          </Badge>
                          {!row.hasOwnRelationFields &&
                          (row.source || row.groupName || row.ownerName) ? (
                            <span className="text-muted-foreground text-xs">
                              关系字段继承自活动
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setRemoving(row)}
                        >
                          移出
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          </DialogBody>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 三个范围从近到远排：本活动人员是最常用的（环节人员本来就该是活动
          人员的子集），项目人员次之，全量库兜底。 */}
      <MemberPickerDialog
        open={pickerOpen}
        title="从已有人员选择"
        description="选中的人员将加入本环节；不在本活动 / 本项目内的会自动补齐上层关系。"
        scopes={[
          { value: "activity", label: "本活动人员", activityId },
          { value: "project", label: "本项目人员", projectId },
          { value: "all", label: "全量人员库" },
        ]}
        excludeIds={list.map((row) => row.memberId)}
        submitting={addMutation.isPending}
        onOpenChange={setPickerOpen}
        onConfirm={(memberIds) => addMutation.mutate(memberIds)}
        onCreateNew={() => {
          setPickerOpen(false);
          setCreateRole("");
          setCreateOpen(true);
        }}
      />

      <MemberQuickCreateDialog
        open={createOpen}
        title="手动录入环节人员"
        description="全量人员库里还没有这个人时用这个入口。保存后一次建齐主档、项目关系、活动关系和本环节关系。"
        submitting={createMutation.isPending}
        extraFields={
          <SegmentRoleField
            id="qc-segment-role"
            value={createRole}
            onChange={setCreateRole}
          />
        }
        onOpenChange={setCreateOpen}
        onSubmit={(fields) => createMutation.mutate(fields)}
      />

      <Dialog
        open={!!removing}
        onOpenChange={(open) => {
          if (!open) setRemoving(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认移出本环节？</DialogTitle>
            <DialogDescription>
              将解除「{removing?.name}」与本环节的关系。
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="text-muted-foreground">
            该人员仍保留在本活动和本项目中，随时可以重新加入本环节。
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(undefined)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={removeMutation.isPending}
              onClick={() => removing && removeMutation.mutate(removing)}
            >
              确认移出
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
