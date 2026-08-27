import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PlusIcon, RouteIcon, SearchIcon, UsersRoundIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
  activityMemberKeys,
  segmentMemberKeys,
} from "#/features/member/relation-queries.ts";
import {
  createTrip,
  deleteTrip,
  type Trip,
  tripKeys,
  tripListQueryOptions,
  tripOptionsQueryOptions,
  updateTrip,
} from "#/features/trip/queries.ts";
import {
  TRANSPORT_MODE_LABELS,
  TRANSPORT_MODE_VALUES,
} from "#/features/trip/utils.ts";
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
import { activityDetailQueryOptions } from "../-queries";
import { formatDateTime } from "../-utils";
import { TripBatchDialog } from "./-components/trip-batch-dialog";
import {
  TripFormDialog,
  type TripFormSubmitValues,
} from "./-components/trip-form-dialog";
import { createBatchTrips, tripBatchOptionsQueryOptions } from "./-queries";

const TripSearchSchema = z.object({
  name: z.string().optional().catch(undefined),
  companyPosition: z.string().optional().catch(undefined),
  transportMode: z.enum(TRANSPORT_MODE_VALUES).optional().catch(undefined),
  page: z.number().int().min(1).default(1).catch(1),
  pageSize: z.number().int().min(1).max(100).default(10).catch(10),
});

export const Route = createFileRoute(
  "/_authenticated/project/$projectId_/activity/$activityId/trip/",
)({
  validateSearch: TripSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps, params }) => {
    const activityId = Number(params.activityId);
    return Promise.all([
      context.queryClient.ensureQueryData(
        tripListQueryOptions({ activityId, ...deps }),
      ),
      context.queryClient.ensureQueryData(tripOptionsQueryOptions(activityId)),
    ]);
  },
  component: TripPage,
});

const TRANSPORT_FILTER_ITEMS = [
  { value: null, label: "全部交通方式" },
  ...TRANSPORT_MODE_VALUES.map((value) => ({
    value,
    label: TRANSPORT_MODE_LABELS[value],
  })),
];
const PAGE_SIZE_OPTIONS = [10, 20, 50];

function TripPage() {
  const { activityId: activityIdParam } = Route.useParams();
  const activityId = Number(activityIdParam);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();

  const [nameInput, setNameInput] = useState(search.name ?? "");
  const [companyInput, setCompanyInput] = useState(
    search.companyPosition ?? "",
  );
  const [transportInput, setTransportInput] = useState<
    Trip["transportMode"] | null
  >(search.transportMode ?? null);
  const [formOpen, setFormOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchSegmentId, setBatchSegmentId] = useState<number | null>(null);
  const [editing, setEditing] = useState<Trip>();
  const [pendingDelete, setPendingDelete] = useState<Trip>();

  useEffect(() => {
    setNameInput(search.name ?? "");
    setCompanyInput(search.companyPosition ?? "");
    setTransportInput(search.transportMode ?? null);
  }, [search.name, search.companyPosition, search.transportMode]);

  const filters = { activityId, ...search };
  const listQuery = useQuery(tripListQueryOptions(filters));
  const optionsQuery = useQuery(tripOptionsQueryOptions(activityId));
  const batchOptionsQuery = useQuery({
    ...tripBatchOptionsQueryOptions({
      activityId,
      segmentId: batchSegmentId,
    }),
    enabled: batchOpen,
  });
  const activityQuery = useQuery(activityDetailQueryOptions(activityId));
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const batchOptionsLoading =
    batchOptionsQuery.isPending || batchOptionsQuery.isFetching;

  const refreshList = () =>
    queryClient.invalidateQueries({ queryKey: tripKeys.list(filters) });
  const invalidateTrips = () =>
    queryClient.invalidateQueries({ queryKey: tripKeys.all });

  const applyFilter = (patch: Partial<typeof search>) => {
    const next = { ...search, ...patch, page: 1 };
    if (isSameFilter(search, next)) return refreshList();
    navigate({ search: next });
  };

  const saveMutation = useMutation({
    mutationFn: (values: TripFormSubmitValues) =>
      editing
        ? updateTrip({ ...values, activityId, id: editing.id })
        : createTrip({ ...values, activityId }),
    onSuccess: (result) => {
      const syncedSegment = result.syncedSegment;
      toast.success(
        syncedSegment
          ? `${syncedSegment.memberName}已同步加入${syncedSegment.segmentName}环节，请确认。`
          : editing
            ? "修改成功"
            : "新增成功",
      );
      setFormOpen(false);
      setEditing(undefined);
      invalidateTrips();
      if (syncedSegment) {
        queryClient.invalidateQueries({ queryKey: activityMemberKeys.all });
        queryClient.invalidateQueries({ queryKey: segmentMemberKeys.all });
      }
    },
    onError: (error) => toast.error(error.message),
  });

  const batchMutation = useMutation({
    mutationFn: createBatchTrips,
    onSuccess: (result) => {
      const count = result.list.length;
      toast.success(`已为 ${count} 名人员创建 ${count} 条独立行程`);
      setBatchOpen(false);
      setBatchSegmentId(null);
      invalidateTrips();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (trip: Trip) => deleteTrip(trip.id),
    onSuccess: () => {
      toast.success("删除成功");
      setPendingDelete(undefined);
      if (list.length === 1 && search.page > 1) {
        navigate({ search: (prev) => ({ ...prev, page: prev.page - 1 }) });
      }
      invalidateTrips();
    },
    onError: (error) => toast.error(error.message),
  });

  const rangeStart = total === 0 ? 0 : (search.page - 1) * search.pageSize + 1;
  const rangeEnd = Math.min(search.page * search.pageSize, total);
  const hasPrev = search.page > 1;
  const hasNext = rangeEnd < total;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold text-lg">人员行程管理</h2>
          <p className="text-muted-foreground text-sm">
            维护本活动参与人员的出发、到达及交通信息。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              batchMutation.reset();
              setBatchSegmentId(null);
              setBatchOpen(true);
            }}
          >
            <UsersRoundIcon data-icon="inline-start" />
            团体批量配置
          </Button>
          <Button
            onClick={() => {
              if ((optionsQuery.data?.members.length ?? 0) === 0) {
                toast.error("请先在“活动人员”中添加人员");
                return;
              }
              setEditing(undefined);
              setFormOpen(true);
            }}
          >
            <PlusIcon data-icon="inline-start" />
            新增行程
          </Button>
        </div>
      </div>

      <FilterBar
        onSubmit={() =>
          applyFilter({
            name: nameInput.trim() || undefined,
            companyPosition: companyInput.trim() || undefined,
            transportMode: transportInput ?? undefined,
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
          value={companyInput}
          onChange={(event) => setCompanyInput(event.target.value)}
        />
        <Select
          items={TRANSPORT_FILTER_ITEMS}
          value={transportInput}
          onValueChange={(value) =>
            setTransportInput(value as Trip["transportMode"] | null)
          }
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {TRANSPORT_FILTER_ITEMS.map((item) => (
                <SelectItem key={item.value ?? "all"} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <FilterActions
          onReset={() => {
            setNameInput("");
            setCompanyInput("");
            setTransportInput(null);
            navigate({ search: { page: 1, pageSize: search.pageSize } });
          }}
        />
      </FilterBar>

      <div className="rounded-lg border bg-card shadow-sm">
        <Table>
          <TableHeader className="bg-muted/60">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-14">序号</TableHead>
              <TableHead className="min-w-24">姓名</TableHead>
              <TableHead className="min-w-40">企业（社会）职务</TableHead>
              <TableHead className="min-w-28">关联环节</TableHead>
              <TableHead className="min-w-24">交通方式</TableHead>
              <TableHead className="min-w-28">航班/车次</TableHead>
              <TableHead className="min-w-40">出发时间</TableHead>
              <TableHead className="min-w-40">到达时间</TableHead>
              <TableHead className="min-w-28">出发地</TableHead>
              <TableHead className="min-w-28">目的地</TableHead>
              <TableHead className="min-w-28 text-center">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQuery.isPending ? (
              Array.from({ length: 3 }, (_, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 骨架屏没有身份
                <TableRow key={index}>
                  {Array.from({ length: 11 }, (_, cell) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: 骨架屏没有身份
                    <TableCell key={cell}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : list.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11}>
                  <Empty className="border-0">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <RouteIcon />
                      </EmptyMedia>
                      <EmptyTitle>没有匹配的人员行程</EmptyTitle>
                      <EmptyDescription>
                        换个筛选条件，或者为本活动人员新增一条行程。
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </TableCell>
              </TableRow>
            ) : (
              list.map((trip, index) => (
                <TableRow key={trip.id}>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {(search.page - 1) * search.pageSize + index + 1}
                  </TableCell>
                  <TableCell className="font-medium">
                    {trip.memberName}
                  </TableCell>
                  <TableCell>{trip.companyPosition || "-"}</TableCell>
                  <TableCell>{trip.segmentName || "-"}</TableCell>
                  <TableCell>
                    {TRANSPORT_MODE_LABELS[trip.transportMode]}
                  </TableCell>
                  <TableCell>{trip.serviceNumber || "-"}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {formatDateTime(trip.departureTime)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {formatDateTime(trip.arrivalTime)}
                  </TableCell>
                  <TableCell>{trip.departureLocation}</TableCell>
                  <TableCell>{trip.destination}</TableCell>
                  <TableCell className="text-center whitespace-nowrap">
                    <div className="inline-flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-primary hover:text-primary"
                        onClick={() => {
                          setEditing(trip);
                          setFormOpen(true);
                        }}
                      >
                        修改
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        disabled={
                          deleteMutation.isPending &&
                          deleteMutation.variables?.id === trip.id
                        }
                        onClick={() => setPendingDelete(trip)}
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
              <SelectGroup>
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <SelectItem key={size} value={size}>
                    {size} 条/页
                  </SelectItem>
                ))}
              </SelectGroup>
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

      <TripFormDialog
        open={formOpen}
        activityName={activityQuery.data?.name ?? "当前活动"}
        trip={editing}
        options={optionsQuery.data}
        submitting={saveMutation.isPending}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(undefined);
        }}
        onSubmit={(values) => saveMutation.mutate(values)}
      />

      {batchOpen ? (
        <TripBatchDialog
          open
          activityId={activityId}
          activityName={activityQuery.data?.name ?? "当前活动"}
          segmentId={batchSegmentId}
          segments={optionsQuery.data?.segments ?? []}
          options={batchOptionsLoading ? undefined : batchOptionsQuery.data}
          optionsPending={batchOptionsLoading}
          optionsError={batchOptionsQuery.error}
          submitError={batchMutation.error}
          submitting={batchMutation.isPending}
          onOpenChange={(open) => {
            if (!open && batchMutation.isPending) return;
            setBatchOpen(open);
            if (!open) {
              setBatchSegmentId(null);
              batchMutation.reset();
            }
          }}
          onSegmentChange={setBatchSegmentId}
          onRetryOptions={() => {
            batchOptionsQuery.refetch();
          }}
          onClearSubmitError={() => batchMutation.reset()}
          onSubmit={(values) => batchMutation.mutate(values)}
        />
      ) : null}

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(undefined);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除该行程？</AlertDialogTitle>
            <AlertDialogDescription>
              「{pendingDelete?.memberName}：{pendingDelete?.departureLocation}{" "}
              → {pendingDelete?.destination}」将被永久删除，该操作不可恢复。
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
