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
  TruckIcon,
  Users2Icon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { Badge } from "#/shared/components/ui/badge.tsx";
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
import { SupplierDetailDialog } from "./-components/supplier-detail-dialog";
import { SupplierFormDialog } from "./-components/supplier-form-dialog";
import {
  type ServiceCategory,
  type Supplier,
  type SupplierFormValues,
  type SupplierStatus,
  createSupplier,
  deleteSupplier,
  setSupplierStatus,
  supplierCitiesQueryOptions,
  supplierKeys,
  supplierListQueryOptions,
  supplierStatsQueryOptions,
  updateSupplier,
} from "./-queries";
import {
  CATEGORY_BADGE_CLASS,
  SERVICE_CATEGORY_VALUES,
  SUPPLIER_STATUS_CHIP,
  SUPPLIER_STATUS_DOT,
  SUPPLIER_STATUS_LABELS,
  SUPPLIER_STATUS_VALUES,
  categoryLabel,
  formatDateTime,
  maskPhone,
} from "./-utils";

// 筛选条件放 URL 而不是 useState：链接可分享、可收藏，浏览器后退能回到上一组
// 筛选。zod v4 直接当 validateSearch 用（不需要 zodValidator 适配器），
// `.catch()` 保证有人手改 URL 也不会把页面打崩。
const SupplierSearchSchema = z.object({
  name: z.string().optional().catch(undefined),
  serviceCategory: z.enum(SERVICE_CATEGORY_VALUES).optional().catch(undefined),
  city: z.string().optional().catch(undefined),
  status: z.enum(SUPPLIER_STATUS_VALUES).optional().catch(undefined),
  page: z.number().int().min(1).default(1).catch(1),
  pageSize: z.number().int().min(1).max(100).default(10).catch(10),
});

export const Route = createFileRoute("/_authenticated/supplier/")({
  validateSearch: SupplierSearchSchema,
  loaderDeps: ({ search }) => search,
  // 进页面之前就把列表拿到手，省掉「先闪一屏骨架再出数据」。
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(supplierListQueryOptions(deps)),
  component: SupplierPage,
});

const CATEGORY_FILTER_ITEMS = [
  { value: null, label: "全部服务类目" },
  ...SERVICE_CATEGORY_VALUES.map((value) => ({
    value,
    label: categoryLabel(value),
  })),
];

const STATUS_FILTER_ITEMS = [
  { value: null, label: "全部状态" },
  ...SUPPLIER_STATUS_VALUES.map((value) => ({
    value,
    label: SUPPLIER_STATUS_LABELS[value],
  })),
];

const MAX_VISIBLE_CATEGORIES = 2;
const PAGE_SIZE_OPTIONS = [10, 20, 50];

function SupplierPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();

  // 筛选控件全部先落在本地草稿 state 上，点「查询」才写进 URL——不只是输入框，
  // 下拉也一样（见 filter-bar.tsx 的注释：全站统一成一种触发方式）。顺带解决了
  // 「每敲一个字母都 push 一条 history、后退键作废」这个老问题。
  const [nameInput, setNameInput] = useState(search.name ?? "");
  const [categoryInput, setCategoryInput] = useState<ServiceCategory | null>(
    search.serviceCategory ?? null,
  );
  const [cityInput, setCityInput] = useState<string | null>(search.city ?? null);
  const [statusInput, setStatusInput] = useState<SupplierStatus | null>(
    search.status ?? null,
  );
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier>();
  const [detail, setDetail] = useState<Supplier>();
  const [pendingDelete, setPendingDelete] = useState<Supplier>();

  // URL 变了就把草稿拉回来对齐：浏览器后退、点重置、或者直接粘一个带参数的链接
  // 进来时，筛选栏显示的必须是这次真正生效的条件，不能停在上一次的草稿上。
  useEffect(() => {
    setNameInput(search.name ?? "");
    setCategoryInput(search.serviceCategory ?? null);
    setCityInput(search.city ?? null);
    setStatusInput(search.status ?? null);
  }, [search.name, search.serviceCategory, search.city, search.status]);

  const listQuery = useQuery(supplierListQueryOptions(search));
  const citiesQuery = useQuery(supplierCitiesQueryOptions());
  const statsQuery = useQuery(supplierStatsQueryOptions());

  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  const cityItems = useMemo(
    () => [
      { value: null, label: "全部城市" },
      ...(citiesQuery.data ?? []).map((city) => ({ value: city, label: city })),
    ],
    [citiesQuery.data],
  );

  /** 改筛选条件一律回到第 1 页：留在第 5 页上很可能直接是空的。 */
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: supplierKeys.all });

  const applyFilter = (patch: Partial<typeof search>) => {
    const next = { ...search, ...patch, page: 1 };
    // 条件没变时 navigate 是空操作，显式重拉一次，让「查询」同时承担刷新
    // 语义（理由见 filter-bar.tsx）。
    if (isSameFilter(search, next)) return invalidate();
    navigate({ search: next });
  };

  const saveMutation = useMutation({
    mutationFn: (values: SupplierFormValues) =>
      editing ? updateSupplier({ ...values, id: editing.id }) : createSupplier(values),
    onSuccess: () => {
      toast.success(editing ? "修改成功" : "新增成功");
      setFormOpen(false);
      setEditing(undefined);
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const statusMutation = useMutation({
    mutationFn: (supplier: Supplier) =>
      setSupplierStatus(
        supplier.id,
        supplier.status === "enabled" ? "disabled" : "enabled",
      ),
    onSuccess: (updated) => {
      toast.success(updated.status === "enabled" ? "已启用" : "已停用");
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (supplier: Supplier) => deleteSupplier(supplier.id),
    onSuccess: () => {
      toast.success("删除成功");
      setPendingDelete(undefined);
      // 删掉的是当前页最后一条时退回上一页，否则会停在一张空表上。
      if (list.length === 1 && search.page > 1) {
        navigate({ search: (prev) => ({ ...prev, page: prev.page - 1 }) });
      }
      invalidate();
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
            <TruckIcon className="size-5" />
          </div>
          <div>
            <h1 className="font-semibold text-xl tracking-tight">供应商管理</h1>
            <p className="text-muted-foreground text-sm">
              时装周活动的供应商库，按服务类目和城市检索。
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
          新增供应商
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          icon={Building2Icon}
          label="供应商总数"
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
          icon={MapPinIcon}
          label="覆盖城市"
          value={statsQuery.data?.cities}
          className="bg-chart-2/10 text-chart-2"
        />
      </div>

      <FilterBar
        onSubmit={() =>
          applyFilter({
            name: nameInput.trim() || undefined,
            serviceCategory: categoryInput ?? undefined,
            city: cityInput ?? undefined,
            status: statusInput ?? undefined,
          })
        }
      >
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="w-56 pl-8"
            placeholder="搜索供应商名称"
            value={nameInput}
            onChange={(event) => setNameInput(event.target.value)}
          />
        </div>

        <Select
          items={CATEGORY_FILTER_ITEMS}
          value={categoryInput}
          onValueChange={(value) =>
            setCategoryInput(value as ServiceCategory | null)
          }
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORY_FILTER_ITEMS.map((item) => (
              <SelectItem key={item.value ?? "all"} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          items={cityItems}
          value={cityInput}
          onValueChange={(value) => setCityInput(value as string | null)}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {cityItems.map((item) => (
              <SelectItem key={item.value ?? "all"} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          items={STATUS_FILTER_ITEMS}
          value={statusInput}
          onValueChange={(value) =>
            setStatusInput(value as SupplierStatus | null)
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

        {/* 草稿要显式清一遍，不能只靠上面那个 useEffect：用户输了字还没点查询就点
            重置时，URL 上本来就是空的，effect 的依赖不变、不会重跑。 */}
        <FilterActions
          onReset={() => {
            setNameInput("");
            setCategoryInput(null);
            setCityInput(null);
            setStatusInput(null);
            navigate({ search: { page: 1, pageSize: search.pageSize } });
          }}
        />
      </FilterBar>

      <div className="rounded-lg border bg-card shadow-sm">
        <Table>
          <TableHeader className="bg-muted/60">
            <TableRow className="hover:bg-transparent">
              <TableHead className="min-w-40">供应商名称</TableHead>
              <TableHead className="min-w-44">服务类目</TableHead>
              <TableHead>所在城市</TableHead>
              <TableHead>联系人</TableHead>
              <TableHead>联系电话</TableHead>
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
                  {Array.from({ length: 9 }, (_, cell) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: 同上
                    <TableCell key={cell}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : list.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9}>
                  <Empty className="border-0">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <Users2Icon />
                      </EmptyMedia>
                      <EmptyTitle>没有匹配的供应商</EmptyTitle>
                      <EmptyDescription>
                        换个筛选条件，或者新增一个供应商。
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </TableCell>
              </TableRow>
            ) : (
              list.map((supplier) => (
                <TableRow key={supplier.id}>
                  <TableCell className="font-medium">{supplier.name}</TableCell>
                  <TableCell>
                    <CategoryTags categories={supplier.serviceCategories} />
                  </TableCell>
                  <TableCell>{supplier.city}</TableCell>
                  <TableCell>{supplier.contactPerson}</TableCell>
                  <TableCell className="tabular-nums">
                    {maskPhone(supplier.contactPhone)}
                  </TableCell>
                  <TableCell>
                    <StatusDot status={supplier.status} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(supplier.createdAt)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(supplier.updatedAt)}
                  </TableCell>
                  {/* ghost + text-primary：既要有 hover 时的浅色底做「这里能点」的
                      反馈（纯 link 变体没有背景，密集排列时不够醒目），又不能是
                      ghost 默认继承的黑色正文文字。删除维持 destructive 红，
                      跟其余三个「安全操作」拉开视觉层级。
                      按钮外面包一层 inline-flex + gap：td 上的 text-center 只负责把
                      整组操作在这一列里居中，组内间距交给 flex 的 gap 统一控制，不再
                      依赖每个按钮自身 padding 碰巧拼出来的空隙——「操作」表头和按钮组
                      对不齐，是右对齐时按钮组总宽度随「启用/停用」文字长度逐行变化、
                      左边界跟着晃造成的；居中对齐没有这个问题，两端留白始终对称。 */}
                  <TableCell className="text-center whitespace-nowrap">
                    <div className="inline-flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-primary hover:text-primary"
                        onClick={() => setDetail(supplier)}
                      >
                        详情
                      </Button>
                      {/* 报价信息是整页跳转，所以是 <Link> 而不是 Button：中键/
                          右键要能在新标签页打开，这是原生 <a> 才有的行为。套一层
                          buttonVariants 保持和相邻按钮同一套尺寸与配色。
                          排在「详情」后面：它和详情同属「看这家供应商」，跟着
                          「修改/停用/删除」那三个写操作分开。 */}
                      <Link
                        to="/supplier/$supplierId/quote"
                        params={{ supplierId: String(supplier.id) }}
                        className={cn(
                          buttonVariants({ variant: "ghost", size: "sm" }),
                          "text-primary hover:text-primary",
                        )}
                      >
                        报价信息
                      </Link>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-primary hover:text-primary"
                        onClick={() => {
                          setEditing(supplier);
                          setFormOpen(true);
                        }}
                      >
                        修改
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-primary hover:text-primary"
                        // 只禁用**正在提交的那一行**：写成 statusMutation.isPending
                        // 会让整列按钮一起变灰，看着像整个表格卡住了。
                        disabled={
                          statusMutation.isPending &&
                          statusMutation.variables?.id === supplier.id
                        }
                        onClick={() => statusMutation.mutate(supplier)}
                      >
                        {supplier.status === "enabled" ? "停用" : "启用"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setPendingDelete(supplier)}
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

      <SupplierFormDialog
        open={formOpen}
        supplier={editing}
        submitting={saveMutation.isPending}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(undefined);
        }}
        onSubmit={(values) => saveMutation.mutate(values)}
      />

      <SupplierDetailDialog
        supplier={detail}
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
            <AlertDialogTitle>确认删除该供应商？</AlertDialogTitle>
            {/* 明说会连带删掉报价附件：supplier_quote 挂的是 cascade，不写出来
                的话，用户以为只是删了一条联系方式。 */}
            <AlertDialogDescription>
              「{pendingDelete?.name}
              」及其名下的报价文件记录将被永久删除，该操作不可恢复。
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

function CategoryTags({ categories }: { categories: Supplier["serviceCategories"] }) {
  if (categories.length === 0) return <span className="text-muted-foreground">-</span>;

  const visible = categories.slice(0, MAX_VISIBLE_CATEGORIES);
  const rest = categories.length - visible.length;

  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((category) => (
        <Badge key={category} className={CATEGORY_BADGE_CLASS[category]}>
          {categoryLabel(category)}
        </Badge>
      ))}
      {rest > 0 && <Badge variant="outline">+{rest}</Badge>}
    </div>
  );
}

function StatusDot({ status }: { status: Supplier["status"] }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 font-medium text-xs",
        SUPPLIER_STATUS_CHIP[status],
      )}
    >
      <span
        aria-hidden
        className={cn("size-1.5 rounded-full", SUPPLIER_STATUS_DOT[status])}
      />
      {SUPPLIER_STATUS_LABELS[status]}
    </span>
  );
}

/**
 * 概览数字。这里刻意不做成图表 —— 四个孤立的计数没有可比的坐标轴，
 * 画成柱状图只是把「读一个数」变成「量一根柱子」。
 *
 * 数字用默认的比例字形，不加 tabular-nums：等宽数字是给**需要纵向对齐的列**
 * （表格、坐标轴刻度）用的，孤立的大数字用等宽反而字距发虚。
 */
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
