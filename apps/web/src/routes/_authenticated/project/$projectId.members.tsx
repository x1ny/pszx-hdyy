import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PlusIcon, SearchIcon, UsersRoundIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { MemberPickerDialog } from "#/features/member/member-picker-dialog.tsx";
import { MemberQuickCreateDialog } from "#/features/member/member-quick-create-dialog.tsx";
import {
  addNewProjectMember,
  addProjectMembers,
  type NewMemberFields,
  type ProjectMember,
  projectMemberKeys,
  projectMemberListQueryOptions,
  RELATION_ORIGIN_LABELS,
  removeProjectMember,
} from "#/features/member/relation-queries.ts";
import { FilterActions, FilterBar } from "#/shared/components/filter-bar.tsx";
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
import { Input } from "#/shared/components/ui/input.tsx";
import { Skeleton } from "#/shared/components/ui/skeleton.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/shared/components/ui/table.tsx";

const SearchSchema = z.object({
  name: z.string().optional().catch(undefined),
  page: z.number().int().min(1).default(1).catch(1),
  pageSize: z.number().int().min(1).max(100).default(10).catch(10),
});

export const Route = createFileRoute("/_authenticated/project/$projectId/members")({
  validateSearch: SearchSchema,
  component: ProjectMembersPage,
});

/**
 * 项目人员：三层里最薄的一层，页面也照着薄做。
 *
 * 它只回答"谁在这个项目的范围里"，不维护来源/分组/负责人——那些是活动层的
 * 字段（文档 8.1.1："项目层不直接维护活动层来源、分组、负责人"）。所以这里
 * 没有"编辑关系"，只有加人、看汇总、移出。
 *
 * 作为项目详情布局下的标签页渲染：返回入口、项目名和信息卡都由父布局承担，
 * 这里不自带面包屑和一级标题，标题层级用 h2，跟活动人员页对齐。
 */
function ProjectMembersPage() {
  const { projectId: projectIdParam } = Route.useParams();
  const projectId = Number(projectIdParam);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();

  const [nameInput, setNameInput] = useState(search.name ?? "");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [removing, setRemoving] = useState<ProjectMember>();

  // URL 变了就把草稿拉回来对齐（后退、粘链接进来）。
  useEffect(() => setNameInput(search.name ?? ""), [search.name]);

  const listQuery = useQuery(
    projectMemberListQueryOptions({ projectId, ...search }),
  );
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: projectMemberKeys.all });

  const addMutation = useMutation({
    mutationFn: (memberIds: number[]) =>
      addProjectMembers({ projectId, memberIds }),
    onSuccess: (result) => {
      toast.success(`已新增 ${result.added} 名项目人员`);
      setPickerOpen(false);
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const createMutation = useMutation({
    mutationFn: (fields: NewMemberFields) =>
      addNewProjectMember({ projectId, member: fields }),
    onSuccess: () => {
      toast.success("已录入并加入本项目，同时写入全量人员库");
      setCreateOpen(false);
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const removeMutation = useMutation({
    mutationFn: (target: ProjectMember) => removeProjectMember(target.id),
    onSuccess: () => {
      toast.success("已移出本项目");
      setRemoving(undefined);
      invalidate();
    },
    // 后端在还有活动关系时会拒绝并说明原因（项目层不做级联，见 routes.relation.ts）。
    // 这里原样把那句话弹出来，不自己编一份文案。
    onError: (error) => toast.error(error.message),
  });

  const rangeStart = total === 0 ? 0 : (search.page - 1) * search.pageSize + 1;
  const rangeEnd = Math.min(search.page * search.pageSize, total);

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold text-lg tracking-tight">项目人员</h2>
          <p className="text-muted-foreground text-sm">
            进入本项目范围的人员。加入后可在各场活动的活动人员页分配参与关系。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setCreateOpen(true)}>
            手动录入
          </Button>
          <Button onClick={() => setPickerOpen(true)}>
            <PlusIcon />
            从已有人员选择
          </Button>
        </div>
      </div>

      <FilterBar
        onSubmit={() =>
          navigate({
            search: (prev) => ({
              ...prev,
              name: nameInput.trim() || undefined,
              page: 1,
            }),
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
        <FilterActions
          onReset={() => {
            setNameInput("");
            navigate({ search: { page: 1, pageSize: search.pageSize } });
          }}
        />
      </FilterBar>

      <div className="overflow-x-auto rounded-lg border bg-card shadow-sm">
        <Table className="min-w-[900px]">
          <TableHeader className="bg-muted/60">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-16 text-center">序号</TableHead>
              <TableHead className="min-w-44">人员</TableHead>
              <TableHead className="min-w-28">录入渠道</TableHead>
              <TableHead className="w-28 text-center">关联活动数</TableHead>
              <TableHead className="min-w-40">最近参与活动</TableHead>
              <TableHead className="min-w-32">备注</TableHead>
              <TableHead className="w-24 text-center">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQuery.isPending ? (
              Array.from({ length: 5 }, (_, index) => (
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
                      <EmptyTitle>本项目还没有人员</EmptyTitle>
                      <EmptyDescription>
                        从全量人员库选人进入项目范围，之后可分配到具体活动。
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </TableCell>
              </TableRow>
            ) : (
              list.map((row, index) => (
                <TableRow key={row.id}>
                  <TableCell className="text-center text-muted-foreground">
                    {(search.page - 1) * search.pageSize + index + 1}
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
                    <Badge variant="secondary" className="font-normal">
                      {RELATION_ORIGIN_LABELS[row.sourceType]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center tabular-nums">
                    {row.activityCount}
                  </TableCell>
                  <TableCell className="max-w-48 truncate">
                    {row.latestActivityName || "-"}
                  </TableCell>
                  <TableCell className="max-w-40 truncate text-muted-foreground">
                    {row.remark || "-"}
                  </TableCell>
                  <TableCell className="text-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setRemoving(row)}
                    >
                      移出项目
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
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

      {/* 项目是最上游的一层，没有更上游的范围可选，所以只有全量库一个 scope。 */}
      <MemberPickerDialog
        open={pickerOpen}
        title="从已有人员选择"
        description="选中的人员将进入本项目范围。"
        scopes={[{ value: "all", label: "全量人员库" }]}
        excludeIds={list.map((row) => row.memberId)}
        submitting={addMutation.isPending}
        onOpenChange={setPickerOpen}
        onConfirm={(memberIds) => addMutation.mutate(memberIds)}
        onCreateNew={() => {
          setPickerOpen(false);
          setCreateOpen(true);
        }}
      />

      <MemberQuickCreateDialog
        open={createOpen}
        title="手动录入项目人员"
        description="全量人员库里还没有这个人时用这个入口。"
        submitting={createMutation.isPending}
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
            <DialogTitle>确认移出本项目？</DialogTitle>
            <DialogDescription>
              将解除「{removing?.name}」与本项目的关系。
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="text-muted-foreground">
            人员主档保留在全量人员库，不会被删除。若该人员仍参与本项目下的活动，需要先到对应的活动人员页移除后再移出项目。
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
    </div>
  );
}
