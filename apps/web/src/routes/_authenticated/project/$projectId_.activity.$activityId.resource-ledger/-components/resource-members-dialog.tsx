import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UsersRoundIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { MemberPickerDialog } from "#/features/member/member-picker-dialog.tsx";
import {
  resourceTypeLabel,
} from "#/features/resource/labels.ts";
import {
  activityResourceDetailQueryOptions,
  activityResourceKeys,
  bindResourceMembers,
  resourceDemandKeys,
  unbindResourceMember,
} from "#/features/resource/queries.ts";
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
import { Skeleton } from "#/shared/components/ui/skeleton.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/shared/components/ui/table.tsx";

/**
 * 资源的服务名单。
 *
 * 选人复用 features/member 的 MemberPickerDialog，范围锁死在"本活动人员"
 * ——BR-DEV-033A 要求绑定对象必须来自活动人员关系，不能在资源里新建人。
 * 名单里出现了不在活动人员库的人，正确做法是先去活动人员页把人加进来。
 */
export function ResourceMembersDialog({
  resourceId,
  activityId,
  open,
  onOpenChange,
}: {
  resourceId: number | undefined;
  activityId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);

  const detailQuery = useQuery(activityResourceDetailQueryOptions(resourceId));
  const resource = detailQuery.data;

  // 绑定会改变需求项的派生状态（配置中 → 已配置），所以两个 key 都要失效。
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: activityResourceKeys.all });
    queryClient.invalidateQueries({ queryKey: resourceDemandKeys.all });
  };

  const bindMutation = useMutation({
    mutationFn: (memberIds: number[]) =>
      bindResourceMembers(resourceId as number, memberIds),
    onSuccess: (result) => {
      toast.success(`已绑定 ${result.bound} 人`);
      setPickerOpen(false);
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const unbindMutation = useMutation({
    mutationFn: (bindingId: number) => unbindResourceMember(bindingId),
    onSuccess: () => {
      toast.success("已解除绑定");
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              服务名单：{resource?.name ?? "-"}
            </DialogTitle>
            <DialogDescription>
              {resource
                ? `${resourceTypeLabel(resource)} · 绑定后这条安排就算落实到人，关联的环节需求会从"配置中"变成"已配置"。`
                : "加载中…"}
            </DialogDescription>
          </DialogHeader>

          <DialogBody>
            {detailQuery.isPending ? (
              <Skeleton className="h-48 w-full" />
            ) : !resource || resource.members.length === 0 ? (
              <Empty className="border-0">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <UsersRoundIcon />
                  </EmptyMedia>
                  <EmptyTitle>还没有绑定人员</EmptyTitle>
                  <EmptyDescription>
                    从活动人员库里选人。人不在库里的话，先到「活动人员」标签页
                    把他加进这场活动。
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="rounded-lg border">
                <Table>
                  <TableHeader className="bg-muted/60">
                    <TableRow className="hover:bg-transparent">
                      <TableHead>姓名</TableHead>
                      <TableHead>手机号</TableHead>
                      <TableHead>单位 / 职务</TableHead>
                      <TableHead>分组</TableHead>
                      <TableHead className="text-center">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {resource.members.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">
                          {row.name}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {row.mobile || "-"}
                        </TableCell>
                        <TableCell>{row.companyPosition || "-"}</TableCell>
                        <TableCell>{row.groupName || "-"}</TableCell>
                        <TableCell className="text-center">
                          <div className="inline-flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              // 只禁用正在提交的那一行
                              disabled={
                                unbindMutation.isPending &&
                                unbindMutation.variables === row.id
                              }
                              onClick={() => unbindMutation.mutate(row.id)}
                            >
                              解除
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </DialogBody>

          <DialogFooter>
            <span className="mr-auto text-muted-foreground text-sm">
              共 {resource?.members.length ?? 0} 人
            </span>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
            <Button
              disabled={!resource || resource.status === "voided"}
              onClick={() => setPickerOpen(true)}
            >
              添加人员
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MemberPickerDialog
        open={pickerOpen}
        title="选择服务对象"
        description={`从本活动人员库中选人绑定到「${resource?.name ?? ""}」`}
        scopes={[{ value: "activity", label: "本活动人员", activityId }]}
        // 已绑的人仍然显示但勾不动，比直接过滤掉更好解释
        excludeIds={resource?.members.map((row) => row.memberId) ?? []}
        submitting={bindMutation.isPending}
        onOpenChange={setPickerOpen}
        onConfirm={(memberIds) => bindMutation.mutate(memberIds)}
      />
    </>
  );
}
