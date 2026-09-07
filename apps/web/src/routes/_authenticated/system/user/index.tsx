import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PlusIcon, SearchIcon, Users2Icon, UsersRoundIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { sessionQueryOptions } from "#/features/auth/queries.ts";
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
import { cn, formatDateTime } from "#/shared/lib/utils.ts";
import { ResetPasswordDialog } from "./-components/reset-password-dialog";
import { UserFormDialog } from "./-components/user-form-dialog";
import {
  type AdminUser,
  createUser,
  deleteUser,
  resetUserPassword,
  setUserStatus,
  type UserFormValues,
  type UserStatus,
  updateUser,
  userKeys,
  userListQueryOptions,
} from "./-queries";
import {
  USER_STATUS_CHIP,
  USER_STATUS_DOT,
  USER_STATUS_LABELS,
  USER_STATUS_VALUES,
} from "./-utils";

// 筛选条件放 URL（同 supplier）：链接可分享、后退能回到上一组筛选。
const UserSearchSchema = z.object({
  username: z.string().optional().catch(undefined),
  name: z.string().optional().catch(undefined),
  phone: z.string().optional().catch(undefined),
  status: z.enum(USER_STATUS_VALUES).optional().catch(undefined),
  page: z.number().int().min(1).default(1).catch(1),
  pageSize: z.number().int().min(1).max(100).default(10).catch(10),
});

export const Route = createFileRoute("/_authenticated/system/user/")({
  validateSearch: UserSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(userListQueryOptions(deps)),
  component: UserPage,
});

const STATUS_FILTER_ITEMS = [
  { value: null, label: "全部状态" },
  ...USER_STATUS_VALUES.map((value) => ({
    value,
    label: USER_STATUS_LABELS[value],
  })),
];

const PAGE_SIZE_OPTIONS = [10, 20, 50];

function UserPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();

  // 筛选控件先落在本地草稿上，点「查询」才写进 URL（全站统一，见 filter-bar.tsx）。
  const [usernameInput, setUsernameInput] = useState(search.username ?? "");
  const [nameInput, setNameInput] = useState(search.name ?? "");
  const [phoneInput, setPhoneInput] = useState(search.phone ?? "");
  const [statusInput, setStatusInput] = useState<UserStatus | null>(
    search.status ?? null,
  );
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUser>();
  const [resetting, setResetting] = useState<AdminUser>();
  const [pendingDelete, setPendingDelete] = useState<AdminUser>();

  // URL 变了把草稿拉回来对齐（后退、重置、粘链接进来）。
  useEffect(() => {
    setUsernameInput(search.username ?? "");
    setNameInput(search.name ?? "");
    setPhoneInput(search.phone ?? "");
    setStatusInput(search.status ?? null);
  }, [search.username, search.name, search.phone, search.status]);

  const listQuery = useQuery(userListQueryOptions(search));
  // 当前登录的是谁——用来禁掉「停用自己 / 删除自己」。**这只是界面提示**，
  // 真正的拦截在服务端（modules/user/routes.ts），前端不是安全边界。
  const sessionQuery = useQuery(sessionQueryOptions);
  const currentUserId = sessionQuery.data?.user.id;

  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: userKeys.all });

  const applyFilter = (patch: Partial<typeof search>) => {
    const next = { ...search, ...patch, page: 1 };
    // 条件没变时 navigate 是空操作，显式重拉一次，让「查询」同时承担刷新语义。
    if (isSameFilter(search, next)) return invalidate();
    navigate({ search: next });
  };

  const saveMutation = useMutation({
    mutationFn: (values: UserFormValues) => {
      if (!editing) return createUser(values);
      // 账号名和密码不经 /update：前者是登录标识，后者走「重置密码」。
      const { username: _username, password: _password, ...rest } = values;
      return updateUser({ ...rest, id: editing.id });
    },
    onSuccess: () => {
      toast.success(editing ? "修改成功" : "新增成功");
      setFormOpen(false);
      setEditing(undefined);
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const statusMutation = useMutation({
    mutationFn: (user: AdminUser) =>
      setUserStatus(
        user.id,
        user.status === "enabled" ? "disabled" : "enabled",
      ),
    onSuccess: (updated) => {
      toast.success(updated.status === "enabled" ? "已启用" : "已停用");
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const resetMutation = useMutation({
    mutationFn: (password: string) => {
      if (!resetting) throw new Error("没有选中用户");
      return resetUserPassword(resetting.id, password);
    },
    onSuccess: () => {
      toast.success("密码已重置，请把新密码告知本人");
      setResetting(undefined);
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (user: AdminUser) => deleteUser(user.id),
    onSuccess: () => {
      toast.success("删除成功");
      setPendingDelete(undefined);
      // 删掉当前页最后一条时退回上一页，否则停在一张空表上。
      if (list.length === 1 && search.page > 1) {
        navigate({ search: (prev) => ({ ...prev, page: prev.page - 1 }) });
      }
      invalidate();
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
            <UsersRoundIcon className="size-5" />
          </div>
          <div>
            <h1 className="font-semibold text-xl tracking-tight">用户管理</h1>
            <p className="text-muted-foreground text-sm">
              后台账号与登录权限。账号只能由管理员在这里创建，系统不开放自助注册。
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
          新增用户
        </Button>
      </div>

      <FilterBar
        onSubmit={() =>
          applyFilter({
            username: usernameInput.trim() || undefined,
            name: nameInput.trim() || undefined,
            phone: phoneInput.trim() || undefined,
            status: statusInput ?? undefined,
          })
        }
      >
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="w-48 pl-8"
            placeholder="搜索登录账号"
            value={usernameInput}
            onChange={(event) => setUsernameInput(event.target.value)}
          />
        </div>

        <Input
          className="w-40"
          placeholder="搜索姓名"
          value={nameInput}
          onChange={(event) => setNameInput(event.target.value)}
        />

        <Input
          className="w-40"
          placeholder="搜索手机号"
          value={phoneInput}
          onChange={(event) => setPhoneInput(event.target.value)}
        />

        {/* 刻意**没有**「角色」筛选：本次只预置一条角色，下拉里只有一个选项，
            做出来是个摆设。等角色管理落地再加，那时是一行的事。 */}
        <Select
          items={STATUS_FILTER_ITEMS}
          value={statusInput}
          onValueChange={(value) => setStatusInput(value as UserStatus | null)}
        >
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTER_ITEMS.map((item) => (
              <SelectItem key={item.value ?? "all"} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* 草稿要显式清一遍，不能只靠上面那个 useEffect（见 supplier 的注释）。 */}
        <FilterActions
          onReset={() => {
            setUsernameInput("");
            setNameInput("");
            setPhoneInput("");
            setStatusInput(null);
            navigate({ search: { page: 1, pageSize: search.pageSize } });
          }}
        />
      </FilterBar>

      <div className="rounded-lg border bg-card shadow-sm">
        <Table>
          <TableHeader className="bg-muted/60">
            <TableRow className="hover:bg-transparent">
              <TableHead className="min-w-32">登录账号</TableHead>
              <TableHead className="min-w-24">姓名</TableHead>
              <TableHead>手机号</TableHead>
              <TableHead className="min-w-36">角色</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead className="text-center">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQuery.isPending ? (
              Array.from({ length: 3 }, (_, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 骨架屏没有身份
                <TableRow key={index}>
                  {Array.from({ length: 7 }, (_, cell) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: 同上
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
                        <Users2Icon />
                      </EmptyMedia>
                      <EmptyTitle>没有匹配的用户</EmptyTitle>
                      <EmptyDescription>
                        换个筛选条件，或者新增一个用户。
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </TableCell>
              </TableRow>
            ) : (
              list.map((user) => {
                const isSelf = user.id === currentUserId;
                return (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-1.5">
                        {/* 早于本次改造建的账号没有登录账号名，登录不了，
                            显示成 - 让人看得出来要重建。 */}
                        {user.username ?? (
                          <span className="text-muted-foreground">-</span>
                        )}
                        {user.isBuiltin && (
                          <Badge variant="outline" className="font-normal">
                            内置
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{user.name}</TableCell>
                    <TableCell className="tabular-nums">
                      {user.phone ?? (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <RoleTags roles={user.roles} />
                    </TableCell>
                    <TableCell>
                      <StatusDot status={user.status} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(user.createdAt)}
                    </TableCell>
                    {/* 按钮组的样式约定见 supplier/index.tsx 的注释（ghost +
                        text-primary，删除维持 destructive 红，居中对齐）。 */}
                    <TableCell className="text-center whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-primary hover:text-primary"
                          onClick={() => {
                            setEditing(user);
                            setFormOpen(true);
                          }}
                        >
                          修改
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-primary hover:text-primary"
                          onClick={() => setResetting(user)}
                        >
                          重置密码
                        </Button>
                        {/* 停用和删除对自己、对内置管理员都禁掉。禁用而不是隐藏：
                            按钮消失了用户会以为界面坏了，禁用+tooltip 能说明原因。 */}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-primary hover:text-primary"
                          disabled={
                            isSelf ||
                            (user.isBuiltin && user.status === "enabled") ||
                            (statusMutation.isPending &&
                              statusMutation.variables?.id === user.id)
                          }
                          title={
                            isSelf
                              ? "不能停用自己"
                              : user.isBuiltin
                                ? "内置管理员不能停用"
                                : undefined
                          }
                          onClick={() => statusMutation.mutate(user)}
                        >
                          {user.status === "enabled" ? "停用" : "启用"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          disabled={isSelf || user.isBuiltin}
                          title={
                            isSelf
                              ? "不能删除自己"
                              : user.isBuiltin
                                ? "内置管理员不能删除"
                                : undefined
                          }
                          onClick={() => setPendingDelete(user)}
                        >
                          删除
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
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

      <UserFormDialog
        open={formOpen}
        user={editing}
        submitting={saveMutation.isPending}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(undefined);
        }}
        onSubmit={(values) => saveMutation.mutate(values)}
      />

      <ResetPasswordDialog
        user={resetting}
        submitting={resetMutation.isPending}
        onOpenChange={(open) => {
          if (!open) setResetting(undefined);
        }}
        onSubmit={(password) => resetMutation.mutate(password)}
      />

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(undefined);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除该用户？</AlertDialogTitle>
            {/* 说清后果：这是物理删除，而且会把他建过的记录上的「创建人」置空
                （48 处业务外键都是 on delete set null，见 modules/user/routes.ts）。 */}
            <AlertDialogDescription>
              「{pendingDelete?.name}」的账号和登录凭证将被永久删除，不可恢复。
              他创建过的业务数据会保留，但那些记录上的「创建人」会变成空。
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

function RoleTags({ roles }: { roles: AdminUser["roles"] }) {
  if (roles.length === 0) {
    return <span className="text-muted-foreground">未分配</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {roles.map((role) => (
        <Badge key={role.id} variant="secondary" className="font-normal">
          {role.name}
        </Badge>
      ))}
    </div>
  );
}

function StatusDot({ status }: { status: UserStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 font-medium text-xs",
        USER_STATUS_CHIP[status],
      )}
    >
      <span
        aria-hidden
        className={cn("size-1.5 rounded-full", USER_STATUS_DOT[status])}
      />
      {USER_STATUS_LABELS[status]}
    </span>
  );
}
