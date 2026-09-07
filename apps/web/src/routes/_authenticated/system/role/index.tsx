import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { KeyRoundIcon, PlusIcon, SearchIcon, ShieldIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { navMain } from "#/app/nav.ts";
import {
  FilterActions,
  FilterBar,
  isSameFilter,
} from "#/shared/components/filter-bar.tsx";
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
import { formatDateTime } from "#/shared/lib/utils.ts";
import { RoleFormDialog } from "./-components/role-form-dialog";
import {
  createRole,
  deleteRole,
  type Role,
  type RoleFormValues,
  roleAdminKeys,
  roleListQueryOptions,
  updateRole,
} from "./-queries";

// 筛选条件放 URL（同 supplier / system-user）：链接可分享、后退能回到上一组筛选。
const RoleSearchSchema = z.object({
  name: z.string().optional().catch(undefined),
  page: z.number().int().min(1).default(1).catch(1),
  pageSize: z.number().int().min(1).max(100).default(10).catch(10),
});

export const Route = createFileRoute("/_authenticated/system/role/")({
  validateSearch: RoleSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(roleListQueryOptions(deps)),
  component: RolePage,
});

const PAGE_SIZE_OPTIONS = [10, 20, 50];

/**
 * 权限点 → 中文名，从菜单反查。角色列表的权限列要显示中文，而菜单标题就是
 * 用户认得的那个词——另抄一份清单只会漂移（同 permission-picker.tsx 的判断）。
 */
const PERMISSION_TITLES = new Map(
  navMain.flatMap((item) =>
    "children" in item
      ? item.children.map((child) => [child.permission, child.title] as const)
      : item.permission
        ? [[item.permission, item.title] as const]
        : [],
  ),
);

function RolePage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();

  // 筛选控件先落在本地草稿上，点「查询」才写进 URL（全站统一，见 filter-bar.tsx）。
  const [nameInput, setNameInput] = useState(search.name ?? "");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Role>();
  const [pendingDelete, setPendingDelete] = useState<Role>();

  // URL 变了把草稿拉回来对齐（后退、重置、粘链接进来）。
  useEffect(() => {
    setNameInput(search.name ?? "");
  }, [search.name]);

  const listQuery = useQuery(roleListQueryOptions(search));
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: roleAdminKeys.all });

  const applyFilter = (patch: Partial<typeof search>) => {
    const next = { ...search, ...patch, page: 1 };
    // 条件没变时 navigate 是空操作，显式重拉一次，让「查询」同时承担刷新语义。
    if (isSameFilter(search, next)) return invalidate();
    navigate({ search: next });
  };

  const saveMutation = useMutation({
    mutationFn: (values: RoleFormValues) =>
      editing ? updateRole({ ...values, id: editing.id }) : createRole(values),
    onSuccess: () => {
      toast.success(editing ? "修改成功" : "新增成功");
      setFormOpen(false);
      setEditing(undefined);
      invalidate();
      // 用户表单的角色下拉是另一个 key，改完名字也得跟着更新。
      queryClient.invalidateQueries({ queryKey: ["role"] });
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (role: Role) => deleteRole(role.id),
    onSuccess: () => {
      toast.success("删除成功");
      setPendingDelete(undefined);
      // 删掉当前页最后一条时退回上一页，否则停在一张空表上。
      if (list.length === 1 && search.page > 1) {
        navigate({ search: (prev) => ({ ...prev, page: prev.page - 1 }) });
      }
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["role"] });
    },
    onError: (error) => toast.error(error.message),
  });

  const rangeStart = total === 0 ? 0 : (search.page - 1) * search.pageSize + 1;
  const rangeEnd = Math.min(search.page * search.pageSize, total);

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ShieldIcon className="size-5" />
          </div>
          <div>
            <h1 className="font-semibold text-xl tracking-tight">角色管理</h1>
            <p className="text-muted-foreground text-sm">
              角色决定能进哪些功能模块。一个人可以有多个角色，权限取并集。
            </p>
          </div>
        </div>
        <Button
          onClick={() => {
            setEditing(undefined);
            setFormOpen(true);
          }}
        >
          <PlusIcon />
          新增角色
        </Button>
      </div>

      <FilterBar
        onSubmit={() => applyFilter({ name: nameInput.trim() || undefined })}
      >
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="w-56 pl-8"
            placeholder="搜索角色名称"
            value={nameInput}
            onChange={(event) => setNameInput(event.target.value)}
          />
        </div>

        {/* 草稿要显式清一遍，不能只靠上面那个 useEffect（见 supplier 的注释）。 */}
        <FilterActions
          onReset={() => {
            setNameInput("");
            navigate({ search: { page: 1, pageSize: search.pageSize } });
          }}
        />
      </FilterBar>

      <div className="rounded-lg border bg-card shadow-sm">
        <Table>
          <TableHeader className="bg-muted/60">
            <TableRow className="hover:bg-transparent">
              <TableHead className="min-w-32">角色名称</TableHead>
              <TableHead className="min-w-64">功能权限</TableHead>
              <TableHead className="text-center">用户数</TableHead>
              <TableHead className="min-w-32">备注</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead className="text-center">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQuery.isPending ? (
              Array.from({ length: 3 }, (_, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 骨架屏没有身份
                <TableRow key={index}>
                  {Array.from({ length: 6 }, (_, cell) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: 同上
                    <TableCell key={cell}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : list.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <Empty className="border-0">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <KeyRoundIcon />
                      </EmptyMedia>
                      <EmptyTitle>没有匹配的角色</EmptyTitle>
                      <EmptyDescription>
                        换个筛选条件，或者新增一个角色。
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </TableCell>
              </TableRow>
            ) : (
              list.map((role) => (
                <TableRow key={role.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-1.5">
                      {role.name}
                      {role.isBuiltin && (
                        <Badge variant="outline" className="font-normal">
                          内置
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <PermissionTags
                      permissions={role.permissions}
                      isBuiltin={role.isBuiltin}
                    />
                  </TableCell>
                  <TableCell className="text-center tabular-nums">
                    {role.memberCount}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {role.remark ?? "-"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(role.createdAt)}
                  </TableCell>
                  {/* 按钮组的样式约定见 supplier/index.tsx 的注释（ghost +
                      text-primary，删除维持 destructive 红，居中对齐）。 */}
                  <TableCell className="text-center whitespace-nowrap">
                    <div className="inline-flex items-center gap-1">
                      {/* 内置角色禁掉修改和删除。禁用而不是隐藏：按钮消失了用户
                          会以为界面坏了，禁用 + title 能说明原因。真正的拦截在
                          服务端 routes.role.ts，前端不是安全边界。 */}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-primary hover:text-primary"
                        disabled={role.isBuiltin}
                        title={
                          role.isBuiltin
                            ? "内置角色的权限恒为全部，不能修改"
                            : undefined
                        }
                        onClick={() => {
                          setEditing(role);
                          setFormOpen(true);
                        }}
                      >
                        修改
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        disabled={role.isBuiltin || role.memberCount > 0}
                        title={
                          role.isBuiltin
                            ? "内置角色不能删除"
                            : role.memberCount > 0
                              ? `还有 ${role.memberCount} 个用户挂着这个角色`
                              : undefined
                        }
                        onClick={() => setPendingDelete(role)}
                      >
                        删除
                      </Button>
                    </div>
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
          <Select
            items={PAGE_SIZE_OPTIONS.map((size) => ({
              value: size,
              label: `${size} 条/页`,
            }))}
            value={search.pageSize}
            onValueChange={(value) => applyFilter({ pageSize: Number(value) })}
          >
            <SelectTrigger size="sm" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={size}>
                  {size} 条/页
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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

      <RoleFormDialog
        open={formOpen}
        role={editing}
        submitting={saveMutation.isPending}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(undefined);
        }}
        onSubmit={(values) => saveMutation.mutate(values)}
      />

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除角色</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除「{pendingDelete?.name}」吗？删除后不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={() =>
                pendingDelete && deleteMutation.mutate(pendingDelete)
              }
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PermissionTags({
  permissions,
  isBuiltin,
}: {
  permissions: string[];
  isBuiltin: boolean;
}) {
  // 内置角色恒等于全集，逐个列出来会占满一整行且没有信息量。
  if (isBuiltin) {
    return <Badge className="font-normal">全部权限</Badge>;
  }

  if (permissions.length === 0) {
    return <span className="text-muted-foreground text-sm">未分配</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {permissions.map((permission) => (
        <Badge key={permission} variant="secondary" className="font-normal">
          {/* 取不到标题 = 库里存着一个代码里已经删掉的权限点。显示原始 key 而不是
              跳过，否则那一行会看起来"少了一个权限"，没人查得出来为什么。 */}
          {PERMISSION_TITLES.get(permission as never) ?? permission}
        </Badge>
      ))}
    </div>
  );
}
