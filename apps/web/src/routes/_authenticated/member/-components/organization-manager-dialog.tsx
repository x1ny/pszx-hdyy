import {
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Building2Icon, PlusIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { formatDateTime } from "#/features/member/utils.ts";
import { FilterActions, FilterBar } from "#/shared/components/filter-bar.tsx";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "#/shared/components/ui/alert.tsx";
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
import { Badge } from "#/shared/components/ui/badge.tsx";
import { Button } from "#/shared/components/ui/button.tsx";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
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
import {
  createOrganization,
  deleteOrganization,
  memberKeys,
  type OrganizationDetail,
  type OrganizationFormValues,
  type OrganizationListItem,
  organizationDetailQueryOptions,
  organizationKeys,
  organizationListQueryOptions,
  organizationOptionsQueryOptions,
  updateOrganization,
} from "../-queries";
import { OrganizationForm } from "./organization-form";

const PAGE_SIZE = 8;

type ManagerView =
  | { kind: "list" }
  | { kind: "detail"; id: number }
  | { kind: "create" }
  | { kind: "edit"; id: number };

type SaveVariables =
  | { kind: "create"; values: OrganizationFormValues }
  | { kind: "edit"; id: number; values: OrganizationFormValues };

type OrganizationManagerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function OrganizationManagerDialog({
  open,
  onOpenChange,
}: OrganizationManagerDialogProps) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<ManagerView>({ kind: "list" });
  const [nameInput, setNameInput] = useState("");
  const [appliedName, setAppliedName] = useState("");
  const [page, setPage] = useState(1);
  const [pendingDelete, setPendingDelete] = useState<OrganizationListItem>();

  useEffect(() => {
    if (!open) {
      setView({ kind: "list" });
      setPendingDelete(undefined);
    }
  }, [open]);

  const filters = {
    name: appliedName || undefined,
    page,
    pageSize: PAGE_SIZE,
  };
  const listQuery = useQuery({
    ...organizationListQueryOptions(filters),
    enabled: open && view.kind === "list",
  });
  const selectedId =
    view.kind === "detail" || view.kind === "edit" ? view.id : 0;
  const detailQuery = useQuery({
    ...organizationDetailQueryOptions(selectedId),
    enabled: open && selectedId > 0,
  });
  const optionsQuery = useQuery({
    ...organizationOptionsQueryOptions(),
    enabled: open,
  });

  const invalidateOrganizationsAndMembers = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: organizationKeys.all }),
      queryClient.invalidateQueries({ queryKey: memberKeys.all }),
    ]);

  const saveMutation = useMutation({
    mutationFn: (variables: SaveVariables) =>
      variables.kind === "create"
        ? createOrganization(variables.values)
        : updateOrganization({ id: variables.id, ...variables.values }),
    onSuccess: (_organization, variables) => {
      toast.success(
        variables.kind === "create" ? "团体创建成功" : "团体修改成功",
      );
      setView({ kind: "list" });
      invalidateOrganizationsAndMembers();
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (organization: OrganizationListItem) =>
      deleteOrganization(organization.id),
    onSuccess: () => {
      toast.success("团体删除成功");
      setPendingDelete(undefined);
      if ((listQuery.data?.list.length ?? 0) === 1 && page > 1) {
        setPage((current) => current - 1);
      }
      invalidateOrganizationsAndMembers();
    },
    // 删除可能被当前成员或业务范围快照阻止。保留确认框，让用户能看清原因后
    // 自行取消，而不是把服务端约束误表现成“已经删除”。
    onError: (error) => toast.error(error.message),
  });

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && (saveMutation.isPending || deleteMutation.isPending))
      return;
    onOpenChange(nextOpen);
  };

  const openCreate = () => {
    saveMutation.reset();
    setView({ kind: "create" });
  };

  const openEdit = (id: number) => {
    saveMutation.reset();
    setView({ kind: "edit", id });
  };

  const openDelete = (organization: OrganizationListItem) => {
    deleteMutation.reset();
    setPendingDelete(organization);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader
            title={getViewTitle(view)}
            description={getViewDescription(view)}
          />

          {view.kind === "list" ? (
            <OrganizationList
              nameInput={nameInput}
              page={page}
              listQuery={listQuery}
              onNameInputChange={setNameInput}
              onApplyName={(name) => {
                setAppliedName(name);
                setPage(1);
                if (name === appliedName && page === 1) listQuery.refetch();
              }}
              onPageChange={setPage}
              onCreate={openCreate}
              onDetail={(id) => setView({ kind: "detail", id })}
              onEdit={openEdit}
              onDelete={openDelete}
              onClose={() => handleOpenChange(false)}
            />
          ) : view.kind === "create" ? (
            <OrganizationForm
              organizationOptions={optionsQuery.data ?? []}
              organizationOptionsError={optionsQuery.error?.message}
              submitting={saveMutation.isPending}
              onCancel={() => setView({ kind: "list" })}
              onSubmit={(values) =>
                saveMutation.mutate({ kind: "create", values })
              }
            />
          ) : detailQuery.isPending ? (
            <DetailLoading onBack={() => setView({ kind: "list" })} />
          ) : detailQuery.isError || !detailQuery.data ? (
            <DetailError
              message={detailQuery.error?.message ?? "团体不存在或已被删除"}
              onRetry={() => detailQuery.refetch()}
              onBack={() => setView({ kind: "list" })}
            />
          ) : view.kind === "detail" ? (
            <OrganizationDetailView
              organization={detailQuery.data}
              onBack={() => setView({ kind: "list" })}
              onEdit={() => openEdit(detailQuery.data.id)}
            />
          ) : (
            <OrganizationForm
              key={detailQuery.data.id}
              organization={detailQuery.data}
              organizationOptions={optionsQuery.data ?? []}
              organizationOptionsError={optionsQuery.error?.message}
              submitting={saveMutation.isPending}
              onCancel={() => setView({ kind: "list" })}
              onSubmit={(values) =>
                saveMutation.mutate({
                  kind: "edit",
                  id: detailQuery.data.id,
                  values,
                })
              }
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !deleteMutation.isPending) {
            setPendingDelete(undefined);
            deleteMutation.reset();
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除该团体？</AlertDialogTitle>
            <AlertDialogDescription>
              「{pendingDelete?.name}
              」将被永久删除。若仍有关联成员或业务范围快照，系统会阻止删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteMutation.isError && (
            <Alert variant="destructive">
              <AlertTitle>删除失败</AlertTitle>
              <AlertDescription>
                {deleteMutation.error.message}
              </AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() =>
                pendingDelete && deleteMutation.mutate(pendingDelete)
              }
            >
              {deleteMutation.isPending ? "删除中…" : "删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function OrganizationList({
  nameInput,
  page,
  listQuery,
  onNameInputChange,
  onApplyName,
  onPageChange,
  onCreate,
  onDetail,
  onEdit,
  onDelete,
  onClose,
}: {
  nameInput: string;
  page: number;
  listQuery: UseQueryResult<
    { list: OrganizationListItem[]; total: number },
    Error
  >;
  onNameInputChange: (name: string) => void;
  onApplyName: (name: string) => void;
  onPageChange: (page: number) => void;
  onCreate: () => void;
  onDetail: (id: number) => void;
  onEdit: (id: number) => void;
  onDelete: (organization: OrganizationListItem) => void;
  onClose: () => void;
}) {
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

  return (
    <>
      <DialogBody className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <FilterBar
            className="min-w-0 flex-1 shadow-none"
            onSubmit={() => onApplyName(nameInput.trim())}
          >
            <Input
              className="w-56"
              placeholder="搜索团体名称"
              value={nameInput}
              onChange={(event) => onNameInputChange(event.target.value)}
            />
            <FilterActions
              pending={listQuery.isFetching}
              onReset={() => {
                onNameInputChange("");
                onApplyName("");
              }}
            />
          </FilterBar>
          <Button type="button" onClick={onCreate}>
            <PlusIcon data-icon="inline-start" />
            新增团体
          </Button>
        </div>

        {listQuery.isError ? (
          <Alert variant="destructive">
            <AlertTitle>团体列表载入失败</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              <span>{listQuery.error.message}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => listQuery.refetch()}
              >
                重试
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table className="min-w-[760px]">
              <TableHeader className="bg-muted/60">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="min-w-40">团体名称</TableHead>
                  <TableHead className="w-24 text-center">成员数</TableHead>
                  <TableHead className="min-w-64">备注</TableHead>
                  <TableHead className="min-w-44">更新时间</TableHead>
                  <TableHead className="w-48 text-center">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listQuery.isPending ? (
                  Array.from({ length: 5 }, (_, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: 骨架屏没有身份
                    <TableRow key={index}>
                      {Array.from({ length: 5 }, (_, cell) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: 骨架屏没有身份
                        <TableCell key={cell}>
                          <Skeleton className="h-5 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : list.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Empty className="border-0">
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <Building2Icon />
                          </EmptyMedia>
                          <EmptyTitle>没有匹配的团体</EmptyTitle>
                          <EmptyDescription>
                            换个筛选条件，或者新增一个团体。
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    </TableCell>
                  </TableRow>
                ) : (
                  list.map((organization) => (
                    <TableRow key={organization.id}>
                      <TableCell className="font-medium">
                        {organization.name}
                      </TableCell>
                      <TableCell className="text-center tabular-nums">
                        {organization.memberCount}
                      </TableCell>
                      <TableCell className="max-w-72 truncate text-muted-foreground">
                        {organization.remark || "-"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDateTime(organization.updatedAt)}
                      </TableCell>
                      <TableCell className="text-center whitespace-nowrap">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => onDetail(organization.id)}
                        >
                          详情
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => onEdit(organization.id)}
                        >
                          编辑
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          onClick={() => onDelete(organization)}
                        >
                          删除
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted-foreground text-sm">
            第 {rangeStart}-{rangeEnd} 条 / 共 {total} 条
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              上一页
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={rangeEnd >= total}
              onClick={() => onPageChange(page + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          关闭
        </Button>
      </DialogFooter>
    </>
  );
}

function OrganizationDetailView({
  organization,
  onBack,
  onEdit,
}: {
  organization: OrganizationDetail;
  onBack: () => void;
  onEdit: () => void;
}) {
  return (
    <>
      <DialogBody>
        <dl className="grid gap-5 sm:grid-cols-2">
          <DetailItem label="团体名称" value={organization.name} />
          <DetailItem
            label="成员数量"
            value={`${organization.memberIds.length} 人`}
          />
          <DetailItem
            label="创建时间"
            value={formatDateTime(organization.createdAt)}
          />
          <DetailItem
            label="更新时间"
            value={formatDateTime(organization.updatedAt)}
          />
          <div className="sm:col-span-2">
            <dt className="mb-1 text-muted-foreground text-sm">备注</dt>
            <dd className="whitespace-pre-wrap rounded-lg border bg-muted/30 p-3">
              {organization.remark || "-"}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="mb-1 text-muted-foreground text-sm">成员绑定</dt>
            <dd>
              <Badge variant="secondary">
                已绑定 {organization.memberIds.length} 人
              </Badge>
              <p className="mt-2 text-muted-foreground text-sm">
                点击编辑可按姓名检索、跨页查看并调整完整成员集合。
              </p>
            </dd>
          </div>
        </dl>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onBack}>
          返回列表
        </Button>
        <Button type="button" onClick={onEdit}>
          编辑
        </Button>
      </DialogFooter>
    </>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="mb-1 text-muted-foreground text-sm">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function DetailLoading({ onBack }: { onBack: () => void }) {
  return (
    <>
      <DialogBody className="grid gap-5 sm:grid-cols-2">
        {Array.from({ length: 6 }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 骨架屏没有身份
          <Skeleton key={index} className="h-16 w-full" />
        ))}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onBack}>
          返回列表
        </Button>
      </DialogFooter>
    </>
  );
}

function DetailError({
  message,
  onRetry,
  onBack,
}: {
  message: string;
  onRetry: () => void;
  onBack: () => void;
}) {
  return (
    <>
      <DialogBody>
        <Alert variant="destructive">
          <AlertTitle>团体详情载入失败</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onBack}>
          返回列表
        </Button>
        <Button type="button" onClick={onRetry}>
          重试
        </Button>
      </DialogFooter>
    </>
  );
}

function getViewTitle(view: ManagerView) {
  if (view.kind === "create") return "新增团体";
  if (view.kind === "edit") return "编辑团体";
  if (view.kind === "detail") return "团体详情";
  return "团体管理";
}

function getViewDescription(view: ManagerView) {
  if (view.kind === "create") return "填写团体信息并选择成员，保存后立即生效。";
  if (view.kind === "edit")
    return "修改团体信息和完整成员集合，其他团体成员会被移动。";
  if (view.kind === "detail") return "查看团体主档、成员数量和审计信息。";
  return "查询并维护团体主档；活动关系中的分组名称不会在这里复用。";
}
