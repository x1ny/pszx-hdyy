import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Building2Icon,
  FileUpIcon,
  PlusIcon,
  SearchIcon,
  UsersRoundIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { MemberDetailDialog } from "#/features/member/member-detail-dialog.tsx";
import {
  formatDateTime,
  formatNativePlace,
  MEMBER_STATUS_CHIP,
  MEMBER_STATUS_DOT,
  MEMBER_STATUS_LABELS,
  MEMBER_STATUS_VALUES,
} from "#/features/member/utils.ts";
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
import { Button, buttonVariants } from "#/shared/components/ui/button.tsx";
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
import { cn } from "#/shared/lib/utils.ts";
import { MemberFormDialog } from "./-components/member-form-dialog";
import { OrganizationManagerDialog } from "./-components/organization-manager-dialog";
import {
  createMember,
  deleteMember,
  type Member,
  type MemberFormValues,
  type MemberStatus,
  memberKeys,
  memberListQueryOptions,
  organizationKeys,
  organizationOptionsQueryOptions,
  setMemberStatus,
  updateMember,
} from "./-queries";
import { maskPhone } from "./-utils";

const MemberSearchSchema = z.object({
  name: z.string().optional().catch(undefined),
  companyPosition: z.string().optional().catch(undefined),
  status: z.enum(MEMBER_STATUS_VALUES).optional().catch(undefined),
  organizationId: z.number().int().positive().optional().catch(undefined),
  page: z.number().int().min(1).default(1).catch(1),
  pageSize: z.number().int().min(1).max(100).default(10).catch(10),
});

export const Route = createFileRoute("/_authenticated/member/")({
  validateSearch: MemberSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(memberListQueryOptions(deps)),
  component: MemberPage,
});

const STATUS_FILTER_ITEMS = [
  { value: null, label: "全部状态" },
  ...MEMBER_STATUS_VALUES.map((value) => ({
    value,
    label: MEMBER_STATUS_LABELS[value],
  })),
];

const PAGE_SIZE_OPTIONS = [10, 20, 50];

function MemberPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const [nameInput, setNameInput] = useState(search.name ?? "");
  const [positionInput, setPositionInput] = useState(
    search.companyPosition ?? "",
  );
  const [statusInput, setStatusInput] = useState<MemberStatus | null>(
    search.status ?? null,
  );
  const [organizationInput, setOrganizationInput] = useState<number | null>(
    search.organizationId ?? null,
  );
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Member>();
  const [detail, setDetail] = useState<Member>();
  const [pendingDelete, setPendingDelete] = useState<Member>();
  const [organizationManagerOpen, setOrganizationManagerOpen] = useState(false);

  // URL 变了就把草稿拉回来对齐（后退、粘链接进来）。
  useEffect(() => setNameInput(search.name ?? ""), [search.name]);
  useEffect(
    () => setPositionInput(search.companyPosition ?? ""),
    [search.companyPosition],
  );
  useEffect(() => setStatusInput(search.status ?? null), [search.status]);
  useEffect(
    () => setOrganizationInput(search.organizationId ?? null),
    [search.organizationId],
  );

  const listQuery = useQuery(memberListQueryOptions(search));
  const organizationOptionsQuery = useQuery(organizationOptionsQueryOptions());
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
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

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: memberKeys.all });

  const invalidateOrganizationsAndMembers = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: memberKeys.all }),
      queryClient.invalidateQueries({ queryKey: organizationKeys.all }),
    ]);

  const applyFilter = (patch: Partial<typeof search>) => {
    const next = { ...search, ...patch, page: 1 };
    // 条件没变时 navigate 是空操作，显式重拉一次，让「查询」同时承担刷新
    // 语义（理由见 filter-bar.tsx）。
    if (isSameFilter(search, next)) return invalidate();
    navigate({ search: next });
  };

  const saveMutation = useMutation({
    mutationFn: (values: MemberFormValues) =>
      editing
        ? updateMember({ ...values, id: editing.id })
        : createMember(values),
    onSuccess: () => {
      toast.success(editing ? "修改成功" : "新增成功");
      setFormOpen(false);
      setEditing(undefined);
      invalidateOrganizationsAndMembers();
    },
    onError: (error) => toast.error(error.message),
  });

  const statusMutation = useMutation({
    mutationFn: (member: Member) =>
      setMemberStatus(
        member.id,
        member.status === "enabled" ? "disabled" : "enabled",
      ),
    onSuccess: (updated) => {
      toast.success(updated.status === "enabled" ? "已启用" : "已禁用");
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (member: Member) => deleteMember(member.id),
    onSuccess: () => {
      toast.success("删除成功");
      setPendingDelete(undefined);
      if (list.length === 1 && search.page > 1) {
        navigate({ search: (prev) => ({ ...prev, page: prev.page - 1 }) });
      }
      invalidateOrganizationsAndMembers();
    },
    onError: (error) => toast.error(error.message),
  });

  const rangeStart = total === 0 ? 0 : (search.page - 1) * search.pageSize + 1;
  const rangeEnd = Math.min(search.page * search.pageSize, total);
  const hasPrev = search.page > 1;
  const hasNext = rangeEnd < total;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <UsersRoundIcon className="size-5" />
          </div>
          <div>
            <h1 className="font-semibold text-xl tracking-tight">人员管理</h1>
            <p className="text-muted-foreground text-sm">
              管理活动运营平台的人员信息，支持检索、维护和启用状态切换。
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            className={buttonVariants({ variant: "outline" })}
            to="/member/import"
          >
            <FileUpIcon data-icon="inline-start" />
            批量导入
          </Link>
          <Button
            variant="outline"
            onClick={() => setOrganizationManagerOpen(true)}
          >
            <Building2Icon data-icon="inline-start" />
            团体管理
          </Button>
          <Button
            onClick={() => {
              setEditing(undefined);
              setFormOpen(true);
            }}
          >
            <PlusIcon data-icon="inline-start" />
            新增人员
          </Button>
        </div>
      </div>

      <FilterBar
        onSubmit={() =>
          applyFilter({
            name: nameInput.trim() || undefined,
            companyPosition: positionInput.trim() || undefined,
            status: statusInput ?? undefined,
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
        <Input
          className="w-60"
          placeholder="搜索企业（社会）职务"
          value={positionInput}
          onChange={(event) => setPositionInput(event.target.value)}
        />
        <Select
          items={STATUS_FILTER_ITEMS}
          value={statusInput}
          onValueChange={(value) =>
            setStatusInput(value as MemberStatus | null)
          }
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
        <FilterActions
          onReset={() => {
            setNameInput("");
            setPositionInput("");
            setStatusInput(null);
            setOrganizationInput(null);
            navigate({ search: { page: 1, pageSize: search.pageSize } });
          }}
        />
      </FilterBar>

      <div className="overflow-x-auto rounded-lg border bg-card shadow-sm">
        <Table className="min-w-[1220px]">
          <TableHeader className="bg-muted/60">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-16 text-center">序号</TableHead>
              <TableHead className="min-w-28">姓名</TableHead>
              <TableHead className="min-w-48">企业（社会）职务</TableHead>
              <TableHead className="min-w-36">所属团体</TableHead>
              <TableHead className="min-w-28">籍贯</TableHead>
              <TableHead className="min-w-32">手机号码</TableHead>
              <TableHead className="w-28 text-center">参与活动数</TableHead>
              <TableHead className="min-w-44">创建时间</TableHead>
              <TableHead className="w-24">启用状态</TableHead>
              <TableHead className="w-52 text-center">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQuery.isPending ? (
              Array.from({ length: 5 }, (_, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 骨架屏没有身份
                <TableRow key={index}>
                  {Array.from({ length: 10 }, (_, cell) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: 骨架屏没有身份
                    <TableCell key={cell}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : list.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10}>
                  <Empty className="border-0">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <UsersRoundIcon />
                      </EmptyMedia>
                      <EmptyTitle>没有匹配的人员</EmptyTitle>
                      <EmptyDescription>
                        换个筛选条件，或者新增一名人员。
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </TableCell>
              </TableRow>
            ) : (
              list.map((member, index) => (
                <TableRow key={member.id}>
                  <TableCell className="text-center text-muted-foreground">
                    {(search.page - 1) * search.pageSize + index + 1}
                  </TableCell>
                  <TableCell className="font-medium">{member.name}</TableCell>
                  <TableCell className="max-w-60 truncate">
                    {member.companyPosition || "-"}
                  </TableCell>
                  <TableCell>
                    {member.organizationName || "未加入团体"}
                  </TableCell>
                  <TableCell>
                    {formatNativePlace(
                      member.nativeProvince,
                      member.nativeCity,
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {maskPhone(member.mobile)}
                  </TableCell>
                  <TableCell className="text-center tabular-nums">
                    {member.activityCount}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(member.createdAt)}
                  </TableCell>
                  <TableCell>
                    <StatusDot status={member.status} />
                  </TableCell>
                  <TableCell className="text-center whitespace-nowrap">
                    <div className="inline-flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-primary hover:text-primary"
                        onClick={() => setDetail(member)}
                      >
                        详情
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-primary hover:text-primary"
                        onClick={() => {
                          setEditing(member);
                          setFormOpen(true);
                        }}
                      >
                        修改
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-primary hover:text-primary"
                        disabled={
                          statusMutation.isPending &&
                          statusMutation.variables?.id === member.id
                        }
                        onClick={() => statusMutation.mutate(member)}
                      >
                        {member.status === "enabled" ? "停用" : "启用"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setPendingDelete(member)}
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
            disabled={!hasPrev}
            onClick={() =>
              navigate({ search: (prev) => ({ ...prev, page: prev.page - 1 }) })
            }
          >
            上一页
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasNext}
            onClick={() =>
              navigate({ search: (prev) => ({ ...prev, page: prev.page + 1 }) })
            }
          >
            下一页
          </Button>
        </div>
      </div>

      <MemberFormDialog
        open={formOpen}
        member={editing}
        organizationOptions={organizationOptionsQuery.data ?? []}
        organizationOptionsLoading={organizationOptionsQuery.isPending}
        organizationOptionsError={organizationOptionsQuery.error?.message}
        submitting={saveMutation.isPending}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(undefined);
        }}
        onRetryOrganizationOptions={() => organizationOptionsQuery.refetch()}
        onSubmit={(values) => saveMutation.mutate(values)}
      />

      <OrganizationManagerDialog
        open={organizationManagerOpen}
        onOpenChange={setOrganizationManagerOpen}
      />

      <MemberDetailDialog
        member={detail}
        onOpenChange={(open) => {
          if (!open) setDetail(undefined);
        }}
      />

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(undefined);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除该人员？</AlertDialogTitle>
            <AlertDialogDescription>
              「{pendingDelete?.name}」将被永久删除，该操作不可恢复。
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

function StatusDot({ status }: { status: Member["status"] }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 font-medium text-xs",
        MEMBER_STATUS_CHIP[status],
      )}
    >
      <span
        aria-hidden
        className={cn("size-1.5 rounded-full", MEMBER_STATUS_DOT[status])}
      />
      {MEMBER_STATUS_LABELS[status]}
    </span>
  );
}
