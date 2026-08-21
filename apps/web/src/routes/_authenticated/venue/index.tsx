import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Building2Icon,
  CircleCheckIcon,
  CircleSlashIcon,
  type LucideIcon,
  MapPinIcon,
  PlusIcon,
  SearchIcon,
  SofaIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
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
import { VenueFormDialog } from "./-components/venue-form-dialog";
import {
  createVenue,
  deleteVenue,
  setVenueStatus,
  updateVenue,
  type Venue,
  type VenueFormValues,
  type VenueListRow,
  type VenueStatus,
  venueKeys,
  venueListQueryOptions,
  venueStatsQueryOptions,
} from "./-queries";
import {
  formatDateTime,
  VENUE_STATUS_CHIP,
  VENUE_STATUS_DOT,
  VENUE_STATUS_LABELS,
  VENUE_STATUS_VALUES,
} from "./-utils";

// 筛选条件放 URL 而不是 useState：链接可分享、后退能回到上一组条件。
// 每个字段都 `.catch()`，有人手改 URL 也不会把页面打崩。
const VenueSearchSchema = z.object({
  name: z.string().optional().catch(undefined),
  address: z.string().optional().catch(undefined),
  status: z.enum(VENUE_STATUS_VALUES).optional().catch(undefined),
  page: z.number().int().min(1).default(1).catch(1),
  pageSize: z.number().int().min(1).max(100).default(10).catch(10),
});

export const Route = createFileRoute("/_authenticated/venue/")({
  validateSearch: VenueSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(venueListQueryOptions(deps)),
  component: VenuePage,
});

const STATUS_FILTER_ITEMS = [
  { value: null, label: "全部状态" },
  ...VENUE_STATUS_VALUES.map((value) => ({
    value,
    label: VENUE_STATUS_LABELS[value],
  })),
];

const PAGE_SIZE_OPTIONS = [10, 20, 50];

function VenuePage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();

  // 筛选控件全部先落草稿 state，点「查询」才写进 URL——全站统一成一个触发点。
  const [nameInput, setNameInput] = useState(search.name ?? "");
  const [addressInput, setAddressInput] = useState(search.address ?? "");
  const [statusInput, setStatusInput] = useState<VenueStatus | null>(
    search.status ?? null,
  );
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Venue>();
  const [pendingDelete, setPendingDelete] = useState<VenueListRow>();

  // URL 变了把草稿拉回来对齐：后退、点重置、粘一个带参数的链接进来时，
  // 筛选栏显示的必须是这次真正生效的条件。
  useEffect(() => {
    setNameInput(search.name ?? "");
    setAddressInput(search.address ?? "");
    setStatusInput(search.status ?? null);
  }, [search.name, search.address, search.status]);

  const listQuery = useQuery(venueListQueryOptions(search));
  const statsQuery = useQuery(venueStatsQueryOptions());

  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: venueKeys.all });

  const applyFilter = (patch: Partial<typeof search>) => {
    const next = { ...search, ...patch, page: 1 };
    // 条件没变时 navigate 是空操作，显式重拉一次，让「查询」同时承担刷新语义。
    if (isSameFilter(search, next)) return invalidate();
    navigate({ search: next });
  };

  const saveMutation = useMutation({
    mutationFn: (values: VenueFormValues) =>
      editing
        ? updateVenue({ ...values, id: editing.id })
        : createVenue(values),
    onSuccess: () => {
      toast.success(editing ? "修改成功" : "新增成功");
      setFormOpen(false);
      setEditing(undefined);
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const statusMutation = useMutation({
    mutationFn: (venue: VenueListRow) =>
      setVenueStatus(
        venue.id,
        venue.status === "enabled" ? "disabled" : "enabled",
      ),
    onSuccess: (updated) => {
      toast.success(updated.status === "enabled" ? "已启用" : "已停用");
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (venue: VenueListRow) => deleteVenue(venue.id),
    onSuccess: () => {
      toast.success("删除成功");
      setPendingDelete(undefined);
      // 删掉当前页最后一条时退回上一页，否则会停在一张空表上。
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
            <Building2Icon className="size-5" />
          </div>
          <div>
            <h1 className="font-semibold text-xl tracking-tight">场地管理</h1>
            <p className="text-muted-foreground text-sm">
              可复用的场地基础数据。活动引用场地后形成活动空间，环节再在上面排位。
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
          新增场地
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          icon={Building2Icon}
          label="场地总数"
          value={statsQuery.data?.total}
          className="bg-chart-1/10 text-chart-1"
        />
        <StatTile
          icon={CircleCheckIcon}
          label="启用中"
          value={statsQuery.data?.enabled}
          className="bg-success/10 text-success-foreground"
        />
        <StatTile
          icon={CircleSlashIcon}
          label="已停用"
          value={statsQuery.data?.disabled}
          className="bg-muted text-muted-foreground"
        />
        <StatTile
          icon={SofaIcon}
          label="位置总数"
          value={statsQuery.data?.seats}
          className="bg-chart-2/10 text-chart-2"
        />
      </div>

      <FilterBar
        onSubmit={() =>
          applyFilter({
            name: nameInput.trim() || undefined,
            address: addressInput.trim() || undefined,
            status: statusInput ?? undefined,
          })
        }
      >
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="w-56 pl-8"
            placeholder="搜索场地名称"
            value={nameInput}
            onChange={(event) => setNameInput(event.target.value)}
          />
        </div>

        <div className="relative">
          <MapPinIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="w-48 pl-8"
            placeholder="城市或地址"
            value={addressInput}
            onChange={(event) => setAddressInput(event.target.value)}
          />
        </div>

        <Select
          items={STATUS_FILTER_ITEMS}
          value={statusInput}
          onValueChange={(value) => setStatusInput(value as VenueStatus | null)}
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

        {/* 草稿要显式清一遍：用户输了字还没点查询就点重置时，URL 上本来就是空的，
            上面那个 effect 的依赖不变、不会重跑。 */}
        <FilterActions
          onReset={() => {
            setNameInput("");
            setAddressInput("");
            setStatusInput(null);
            navigate({ search: { page: 1, pageSize: search.pageSize } });
          }}
        />
      </FilterBar>

      <div className="rounded-lg border bg-card shadow-sm">
        <Table>
          <TableHeader className="bg-muted/60">
            <TableRow className="hover:bg-transparent">
              <TableHead className="min-w-48">场地名称</TableHead>
              <TableHead className="min-w-40">地址</TableHead>
              <TableHead>区域数</TableHead>
              <TableHead>位置数</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead>修改时间</TableHead>
              <TableHead className="text-center">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQuery.isPending ? (
              Array.from({ length: 3 }, (_, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 骨架屏没有身份
                <TableRow key={index}>
                  {Array.from({ length: 8 }, (_, cell) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: 同上
                    <TableCell key={cell}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : list.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8}>
                  <Empty className="border-0">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <Building2Icon />
                      </EmptyMedia>
                      <EmptyTitle>没有匹配的场地</EmptyTitle>
                      <EmptyDescription>
                        换个筛选条件，或者新增一个场地。
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </TableCell>
              </TableRow>
            ) : (
              list.map((venue) => (
                <TableRow key={venue.id}>
                  <TableCell className="font-medium">{venue.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {venue.address || "-"}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {venue.zoneCount}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {venue.seatCount}
                  </TableCell>
                  <TableCell>
                    <StatusDot status={venue.status} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(venue.createdAt)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(venue.updatedAt)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-center">
                    <div className="inline-flex items-center gap-1">
                      {/* 整页跳转，所以是 <Link> 不是 Button：中键/右键要能在
                          新标签页打开，这是原生 <a> 才有的行为。 */}
                      <Link
                        to="/venue/$venueId/layout"
                        params={{ venueId: String(venue.id) }}
                        className={cn(
                          buttonVariants({ variant: "ghost", size: "sm" }),
                          "text-primary hover:text-primary",
                        )}
                      >
                        区域与位置
                      </Link>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-primary hover:text-primary"
                        onClick={() => {
                          setEditing(venue);
                          setFormOpen(true);
                        }}
                      >
                        修改
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-primary hover:text-primary"
                        // 只禁用正在提交的那一行，不是整列。
                        disabled={
                          statusMutation.isPending &&
                          statusMutation.variables?.id === venue.id
                        }
                        onClick={() => statusMutation.mutate(venue)}
                      >
                        {venue.status === "enabled" ? "停用" : "启用"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setPendingDelete(venue)}
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

      <VenueFormDialog
        open={formOpen}
        venue={editing}
        submitting={saveMutation.isPending}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(undefined);
        }}
        onSubmit={(values) => saveMutation.mutate(values)}
      />

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(undefined);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除该场地？</AlertDialogTitle>
            {/* 区域、位置、画布都挂 cascade，不写出来的话用户会以为只删了一行名字。 */}
            <AlertDialogDescription>
              「{pendingDelete?.name}」以及它的 {pendingDelete?.zoneCount}{" "}
              个区域、
              {pendingDelete?.seatCount}{" "}
              个位置和画布数据将被永久删除，该操作不可恢复。
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

function StatusDot({ status }: { status: VenueStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 font-medium text-xs",
        VENUE_STATUS_CHIP[status],
      )}
    >
      <span
        aria-hidden
        className={cn("size-1.5 rounded-full", VENUE_STATUS_DOT[status])}
      />
      {VENUE_STATUS_LABELS[status]}
    </span>
  );
}

/** 概览数字。孤立的计数不做成图表——画成柱状图只是把"读一个数"变成"量一根柱子"。 */
function StatTile({
  icon: Icon,
  label,
  value,
  className,
}: {
  icon: LucideIcon;
  label: string;
  value: number | undefined;
  className: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-4">
      <div
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-lg",
          className,
        )}
      >
        <Icon className="size-5" />
      </div>
      <div className="min-w-0">
        <div className="text-muted-foreground text-xs">{label}</div>
        {value === undefined ? (
          <Skeleton className="mt-1 h-7 w-10" />
        ) : (
          <div className="font-semibold text-2xl leading-tight">{value}</div>
        )}
      </div>
    </div>
  );
}
