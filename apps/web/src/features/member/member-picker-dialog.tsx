import { useQuery } from "@tanstack/react-query";
import { AlertCircleIcon, SearchIcon, UsersRoundIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FilterActions } from "#/shared/components/filter-bar.tsx";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "#/shared/components/ui/alert.tsx";
import { Button } from "#/shared/components/ui/button.tsx";
import { Checkbox } from "#/shared/components/ui/checkbox.tsx";
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "#/shared/components/ui/tabs.tsx";
import { cn } from "#/shared/lib/utils.ts";
import {
  getOrganizationConflictDetails,
  initializeOrganizationSelection,
  ORGANIZATION_BATCH_MAX_MEMBERS,
  reconcileOrganizationSelection,
  toggleOrganizationPageSelection,
  toggleOrganizationSelection,
} from "./member-picker-state";
import {
  type CandidateScope,
  memberCandidateQueryOptions,
  type OrganizationBatchResult,
  organizationMemberCandidatesQueryOptions,
  organizationOptionsQueryOptions,
} from "./relation-queries";

/**
 * 从已有人员或团体里选人。普通模式保留原有“上游范围 + 全量库”流程；调用方传入
 * organization 后才出现按团体添加页签，资源台账等普通选人场景不会被改变。
 */
export type PickerScope = {
  value: CandidateScope;
  label: string;
  projectId?: number;
  activityId?: number;
};

export type OrganizationPickerConfig = {
  /** 由层级调用方明确说明会自动补齐哪些上层关系。 */
  hint: string;
  submitting?: boolean;
  onConfirm: (input: {
    organizationId: number;
    memberIds: number[];
  }) => Promise<OrganizationBatchResult>;
};

type PickerMode = "members" | "organization";

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "请求失败，请稍后重试";

export function MemberPickerDialog({
  open,
  title,
  description,
  scopes,
  excludeIds,
  excludeIdsPending = false,
  excludeIdsError,
  submitting,
  organization,
  onOpenChange,
  onConfirm,
  onCreateNew,
}: {
  open: boolean;
  title: string;
  description?: string;
  /** 可选的数据源，第一个是默认选中的。 */
  scopes: readonly PickerScope[];
  /** 当前层级完整成员快照；两种模式都据此标记“已在范围内”。 */
  excludeIds?: readonly number[];
  excludeIdsPending?: boolean;
  excludeIdsError?: string;
  submitting?: boolean;
  organization?: OrganizationPickerConfig;
  onOpenChange: (open: boolean) => void;
  onConfirm: (memberIds: number[]) => void;
  /** 传了就在普通选人模式底部提供“手动录入”出口。 */
  onCreateNew?: () => void;
}) {
  const [mode, setMode] = useState<PickerMode>("members");
  const [scopeIndex, setScopeIndex] = useState(0);
  const [keyword, setKeyword] = useState("");
  const [applied, setApplied] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const [organizationId, setOrganizationId] = useState<number | null>(null);
  const [organizationKeyword, setOrganizationKeyword] = useState("");
  const [organizationApplied, setOrganizationApplied] = useState("");
  const [organizationPage, setOrganizationPage] = useState(1);
  const [organizationSelected, setOrganizationSelected] = useState<Set<number>>(
    new Set(),
  );
  const [organizationResult, setOrganizationResult] =
    useState<OrganizationBatchResult>();
  const [organizationSubmitError, setOrganizationSubmitError] =
    useState<string>();
  const initializedOrganization = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode("members");
    setScopeIndex(0);
    setKeyword("");
    setApplied("");
    setPage(1);
    setSelected(new Set());
    setOrganizationId(null);
    setOrganizationKeyword("");
    setOrganizationApplied("");
    setOrganizationPage(1);
    setOrganizationSelected(new Set());
    setOrganizationResult(undefined);
    setOrganizationSubmitError(undefined);
    initializedOrganization.current = null;
  }, [open]);

  const scope = scopes[scopeIndex] ?? scopes[0];
  const listQuery = useQuery({
    ...memberCandidateQueryOptions({
      scope: scope?.value ?? "all",
      projectId: scope?.projectId,
      activityId: scope?.activityId,
      name: applied || undefined,
      page,
      pageSize: 10,
    }),
    enabled: open && mode === "members" && !!scope,
  });
  const organizationOptionsQuery = useQuery({
    ...organizationOptionsQueryOptions(),
    enabled: open && mode === "organization" && !!organization,
  });
  const organizationCandidatesQuery = useQuery({
    ...organizationMemberCandidatesQueryOptions(organizationId ?? 0),
    enabled:
      open &&
      mode === "organization" &&
      !!organization &&
      organizationId !== null,
  });
  const organizationItems = useMemo(
    () =>
      (organizationOptionsQuery.data ?? []).map((item) => ({
        value: item.id,
        label: item.name,
      })),
    [organizationOptionsQuery.data],
  );

  const excludedFingerprint = [...(excludeIds ?? [])]
    .sort((left, right) => left - right)
    .join(",");
  // 调用方通常在 JSX 里 list.map() 新建数组；先归一化成稳定集合，避免它让初始化
  // effect 每次 render 都重跑并覆盖用户刚刚取消的勾选。
  const normalizedExcludedIds = useMemo(
    () =>
      excludedFingerprint
        ? excludedFingerprint.split(",").map((value) => Number(value))
        : [],
    [excludedFingerprint],
  );
  const excluded = useMemo(
    () => new Set(normalizedExcludedIds),
    [normalizedExcludedIds],
  );

  useEffect(() => {
    if (
      !open ||
      mode !== "organization" ||
      organizationId === null ||
      excludeIdsPending ||
      !organizationCandidatesQuery.data ||
      initializedOrganization.current === organizationId
    ) {
      return;
    }
    setOrganizationSelected(
      initializeOrganizationSelection(
        organizationCandidatesQuery.data.list.map((candidate) => candidate.id),
        normalizedExcludedIds,
      ),
    );
    initializedOrganization.current = organizationId;
  }, [
    open,
    mode,
    organizationId,
    excludeIdsPending,
    normalizedExcludedIds,
    organizationCandidatesQuery.data,
  ]);

  useEffect(() => {
    if (initializedOrganization.current === null) return;
    setOrganizationSelected((current) => {
      const next = reconcileOrganizationSelection(
        current,
        normalizedExcludedIds,
      );
      return next.size === current.size ? current : next;
    });
  }, [normalizedExcludedIds]);

  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const selectableIds = list
    .filter((candidate) => !excluded.has(candidate.id))
    .map((candidate) => candidate.id);
  const allPageSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const somePageSelected =
    !allPageSelected && selectableIds.some((id) => selected.has(id));

  const organizationCandidates = organizationCandidatesQuery.data?.list ?? [];
  const filteredOrganizationCandidates = organizationCandidates.filter(
    (candidate) =>
      !organizationApplied || candidate.name.includes(organizationApplied),
  );
  const organizationPageList = filteredOrganizationCandidates.slice(
    (organizationPage - 1) * 10,
    organizationPage * 10,
  );
  const organizationSelectablePageIds = organizationPageList
    .filter((candidate) => !excluded.has(candidate.id))
    .map((candidate) => candidate.id);
  const allOrganizationPageSelected =
    organizationSelectablePageIds.length > 0 &&
    organizationSelectablePageIds.every((id) => organizationSelected.has(id));
  const someOrganizationPageSelected =
    !allOrganizationPageSelected &&
    organizationSelectablePageIds.some((id) => organizationSelected.has(id));
  const organizationEligibleIds = organizationCandidates
    .filter((candidate) => !excluded.has(candidate.id))
    .map((candidate) => candidate.id);
  const allOrganizationSelected =
    organizationEligibleIds.length > 0 &&
    organizationEligibleIds.every((id) => organizationSelected.has(id));
  const organizationExistingCount = organizationCandidates.filter((candidate) =>
    excluded.has(candidate.id),
  ).length;

  const toggle = (id: number) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const togglePage = (checked: boolean) =>
    setSelected((previous) => {
      const next = new Set(previous);
      for (const id of selectableIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const changeOrganization = (nextId: number | null) => {
    setOrganizationId(nextId);
    setOrganizationKeyword("");
    setOrganizationApplied("");
    setOrganizationPage(1);
    setOrganizationSelected(new Set());
    setOrganizationResult(undefined);
    setOrganizationSubmitError(undefined);
    initializedOrganization.current = null;
  };

  const submitOrganization = async () => {
    if (!organization || organizationId === null) return;
    if (organizationSelected.size > ORGANIZATION_BATCH_MAX_MEMBERS) {
      setOrganizationSubmitError(
        `一次最多添加 ${ORGANIZATION_BATCH_MAX_MEMBERS} 人，请取消部分勾选后再提交`,
      );
      return;
    }

    setOrganizationSubmitError(undefined);
    setOrganizationResult(undefined);
    try {
      const result = await organization.onConfirm({
        organizationId,
        memberIds: [...organizationSelected],
      });
      setOrganizationResult(result);
      if (result.skipped === 0 && result.conflict === 0) {
        onOpenChange(false);
      }
    } catch (error) {
      setOrganizationSubmitError(errorMessage(error));
    }
  };

  const renderLoadingRows = () =>
    Array.from({ length: 4 }, (_, index) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: 骨架屏没有身份
      <TableRow key={index}>
        {Array.from({ length: 4 }, (_, cell) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 骨架屏没有身份
          <TableCell key={cell}>
            <Skeleton className="h-5 w-full" />
          </TableCell>
        ))}
      </TableRow>
    ));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>

        <Tabs
          className="min-h-0 flex-1"
          value={mode}
          onValueChange={(value) => setMode(value as PickerMode)}
        >
          {organization ? (
            <TabsList className="mx-4 grid w-[calc(100%-2rem)] grid-cols-2 mt-2 sm:mx-6 sm:w-[calc(100%-3rem)]">
              <TabsTrigger value="members">按人员选择</TabsTrigger>
              <TabsTrigger value="organization">按团体添加</TabsTrigger>
            </TabsList>
          ) : null}

          <TabsContent
            className="min-h-0 flex-1 overflow-hidden"
            value="members"
          >
            <DialogBody className="flex flex-col gap-4">
              {scopes.length > 1 && (
                <div className="flex gap-1 border-b">
                  {scopes.map((item, index) => (
                    <button
                      key={item.value}
                      type="button"
                      className={cn(
                        "shrink-0 cursor-pointer whitespace-nowrap border-b-2 px-3 py-2 font-medium text-sm transition-colors",
                        index === scopeIndex
                          ? "border-primary text-primary"
                          : "border-transparent text-muted-foreground hover:text-foreground",
                      )}
                      onClick={() => {
                        setScopeIndex(index);
                        setPage(1);
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}

              <form
                className="flex items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const next = keyword.trim();
                  if (next === applied && page === 1) {
                    listQuery.refetch();
                    return;
                  }
                  setApplied(next);
                  setPage(1);
                }}
              >
                <div className="relative flex-1">
                  <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    placeholder="搜索姓名"
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                  />
                </div>
                <FilterActions />
              </form>

              {listQuery.isError ? (
                <Alert variant="destructive">
                  <AlertCircleIcon />
                  <AlertTitle>候选人员加载失败</AlertTitle>
                  <AlertDescription>
                    {errorMessage(listQuery.error)}
                  </AlertDescription>
                </Alert>
              ) : null}

              <div className="rounded-lg border">
                <Table>
                  <TableHeader className="sticky top-0 bg-muted/60">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-12">
                        <Checkbox
                          aria-label="选择当前页全部人员"
                          checked={allPageSelected}
                          disabled={selectableIds.length === 0}
                          indeterminate={somePageSelected}
                          onCheckedChange={togglePage}
                        />
                      </TableHead>
                      <TableHead className="min-w-24">姓名</TableHead>
                      <TableHead className="min-w-40">
                        企业（社会）职务
                      </TableHead>
                      <TableHead className="min-w-32">手机号码</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {listQuery.isPending ? (
                      renderLoadingRows()
                    ) : list.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4}>
                          <Empty className="border-0">
                            <EmptyHeader>
                              <EmptyMedia variant="icon">
                                <UsersRoundIcon />
                              </EmptyMedia>
                              <EmptyTitle>这个范围里没有匹配的人员</EmptyTitle>
                              {onCreateNew ? (
                                <EmptyDescription>
                                  换个范围找找，或者直接手动录入一个新人。
                                </EmptyDescription>
                              ) : null}
                            </EmptyHeader>
                          </Empty>
                        </TableCell>
                      </TableRow>
                    ) : (
                      list.map((candidate) => {
                        const already = excluded.has(candidate.id);
                        return (
                          <TableRow
                            key={candidate.id}
                            className={
                              already ? "opacity-50" : "cursor-pointer"
                            }
                            onClick={() => !already && toggle(candidate.id)}
                          >
                            <TableCell>
                              <Checkbox
                                checked={already || selected.has(candidate.id)}
                                disabled={already}
                                onCheckedChange={() => {
                                  if (!already) toggle(candidate.id);
                                }}
                                onClick={(event) => event.stopPropagation()}
                              />
                            </TableCell>
                            <TableCell className="font-medium">
                              {candidate.name}
                              {already ? (
                                <span className="ml-2 text-muted-foreground text-xs">
                                  已在范围内
                                </span>
                              ) : null}
                            </TableCell>
                            <TableCell className="max-w-56 truncate">
                              {candidate.companyPosition || "-"}
                            </TableCell>
                            <TableCell className="tabular-nums">
                              {candidate.mobile || "-"}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center justify-between text-muted-foreground text-sm">
                <span>
                  已选 {selected.size} 人 / 当前范围共 {total} 条
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((previous) => previous - 1)}
                  >
                    上一页
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={page * 10 >= total}
                    onClick={() => setPage((previous) => previous + 1)}
                  >
                    下一页
                  </Button>
                </div>
              </div>
            </DialogBody>
          </TabsContent>

          {organization ? (
            <TabsContent
              className="min-h-0 flex-1 overflow-hidden"
              value="organization"
            >
              <DialogBody className="flex flex-col gap-4">
                <p className="text-muted-foreground text-sm">
                  {organization.hint}
                </p>

                {organizationOptionsQuery.isError ? (
                  <Alert variant="destructive">
                    <AlertCircleIcon />
                    <AlertTitle>团体选项加载失败</AlertTitle>
                    <AlertDescription className="flex items-center justify-between gap-3">
                      <span>
                        {errorMessage(organizationOptionsQuery.error)}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => organizationOptionsQuery.refetch()}
                      >
                        重试
                      </Button>
                    </AlertDescription>
                  </Alert>
                ) : organizationOptionsQuery.isSuccess &&
                  organizationOptionsQuery.data.length === 0 ? (
                  <Alert>
                    <UsersRoundIcon />
                    <AlertTitle>暂无可选团体</AlertTitle>
                    <AlertDescription>
                      请先到人员页面的“团体管理”中新增团体并绑定人员。
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Select
                    items={organizationItems}
                    value={organizationId}
                    onValueChange={changeOrganization}
                    disabled={organizationOptionsQuery.isPending}
                  >
                    <SelectTrigger className="w-full" aria-label="选择团体">
                      <SelectValue
                        placeholder={
                          organizationOptionsQuery.isPending
                            ? "团体加载中…"
                            : "请选择一个团体"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {organizationItems.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                )}

                {excludeIdsError ? (
                  <Alert variant="destructive">
                    <AlertCircleIcon />
                    <AlertTitle>当前范围快照加载失败</AlertTitle>
                    <AlertDescription>{excludeIdsError}</AlertDescription>
                  </Alert>
                ) : null}

                {organizationId !== null ? (
                  <>
                    <div className="flex items-center gap-2">
                      <form
                        className="flex flex-1 items-center gap-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          setOrganizationApplied(organizationKeyword.trim());
                          setOrganizationPage(1);
                        }}
                      >
                        <div className="relative flex-1">
                          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            className="pl-8"
                            placeholder="搜索团体成员姓名"
                            value={organizationKeyword}
                            onChange={(event) =>
                              setOrganizationKeyword(event.target.value)
                            }
                          />
                        </div>
                        <FilterActions />
                      </form>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={
                          organizationCandidatesQuery.isPending ||
                          excludeIdsPending ||
                          organizationEligibleIds.length === 0
                        }
                        onClick={() =>
                          setOrganizationSelected(
                            allOrganizationSelected
                              ? new Set()
                              : new Set(organizationEligibleIds),
                          )
                        }
                      >
                        {allOrganizationSelected
                          ? "取消全选"
                          : "全选可添加人员"}
                      </Button>
                    </div>

                    {organizationCandidatesQuery.isError ? (
                      <Alert variant="destructive">
                        <AlertCircleIcon />
                        <AlertTitle>团体候选加载失败</AlertTitle>
                        <AlertDescription>
                          {errorMessage(organizationCandidatesQuery.error)}
                        </AlertDescription>
                      </Alert>
                    ) : null}

                    {organizationSubmitError ? (
                      <Alert variant="destructive">
                        <AlertCircleIcon />
                        <AlertTitle>按团体添加失败</AlertTitle>
                        <AlertDescription>
                          {organizationSubmitError}
                        </AlertDescription>
                      </Alert>
                    ) : null}

                    {organizationSelected.size >
                    ORGANIZATION_BATCH_MAX_MEMBERS ? (
                      <Alert variant="destructive">
                        <AlertCircleIcon />
                        <AlertTitle>超过单次人数上限</AlertTitle>
                        <AlertDescription>
                          当前已选 {organizationSelected.size} 人，一次最多添加{" "}
                          {ORGANIZATION_BATCH_MAX_MEMBERS} 人，请取消部分勾选。
                        </AlertDescription>
                      </Alert>
                    ) : null}

                    {organizationResult ? (
                      <Alert
                        variant={
                          organizationResult.skipped > 0
                            ? "destructive"
                            : "default"
                        }
                      >
                        <AlertCircleIcon />
                        <AlertTitle>
                          批量处理完成：新增 {organizationResult.added}，已存在{" "}
                          {organizationResult.existing}，跳过{" "}
                          {organizationResult.skipped}，冲突{" "}
                          {organizationResult.conflict} 条
                        </AlertTitle>
                        <AlertDescription>
                          {getOrganizationConflictDetails(organizationResult)
                            .slice(0, 6)
                            .map((detail) => (
                              <div key={detail}>{detail}</div>
                            ))}
                          {getOrganizationConflictDetails(organizationResult)
                            .length > 6 ? (
                            <div>
                              另有{" "}
                              {getOrganizationConflictDetails(
                                organizationResult,
                              ).length - 6}
                              人存在冲突
                            </div>
                          ) : null}
                        </AlertDescription>
                      </Alert>
                    ) : null}

                    <div className="rounded-lg border">
                      <Table>
                        <TableHeader className="sticky top-0 bg-muted/60">
                          <TableRow className="hover:bg-transparent">
                            <TableHead className="w-12">
                              <Checkbox
                                aria-label="选择当前页全部团体成员"
                                checked={allOrganizationPageSelected}
                                disabled={
                                  organizationSelectablePageIds.length === 0
                                }
                                indeterminate={someOrganizationPageSelected}
                                onCheckedChange={(checked) =>
                                  setOrganizationSelected((previous) =>
                                    toggleOrganizationPageSelection(
                                      previous,
                                      organizationSelectablePageIds,
                                      checked,
                                    ),
                                  )
                                }
                              />
                            </TableHead>
                            <TableHead className="min-w-24">姓名</TableHead>
                            <TableHead className="min-w-40">
                              企业（社会）职务
                            </TableHead>
                            <TableHead className="min-w-32">手机号码</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {organizationCandidatesQuery.isPending ||
                          excludeIdsPending ? (
                            renderLoadingRows()
                          ) : organizationPageList.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={4}>
                                <Empty className="border-0">
                                  <EmptyHeader>
                                    <EmptyMedia variant="icon">
                                      <UsersRoundIcon />
                                    </EmptyMedia>
                                    <EmptyTitle>
                                      团体内没有匹配的有效人员
                                    </EmptyTitle>
                                    <EmptyDescription>
                                      已停用人员不会进入候选。
                                    </EmptyDescription>
                                  </EmptyHeader>
                                </Empty>
                              </TableCell>
                            </TableRow>
                          ) : (
                            organizationPageList.map((candidate) => {
                              const already = excluded.has(candidate.id);
                              return (
                                <TableRow
                                  key={candidate.id}
                                  className={
                                    already ? "opacity-50" : "cursor-pointer"
                                  }
                                  onClick={() => {
                                    if (!already) {
                                      setOrganizationSelected((previous) =>
                                        toggleOrganizationSelection(
                                          previous,
                                          candidate.id,
                                        ),
                                      );
                                    }
                                  }}
                                >
                                  <TableCell>
                                    <Checkbox
                                      aria-label={candidate.name}
                                      checked={
                                        already ||
                                        organizationSelected.has(candidate.id)
                                      }
                                      disabled={already}
                                      onCheckedChange={() => {
                                        if (!already) {
                                          setOrganizationSelected((previous) =>
                                            toggleOrganizationSelection(
                                              previous,
                                              candidate.id,
                                            ),
                                          );
                                        }
                                      }}
                                      onClick={(event) =>
                                        event.stopPropagation()
                                      }
                                    />
                                  </TableCell>
                                  <TableCell className="font-medium">
                                    {candidate.name}
                                    {already ? (
                                      <span className="ml-2 text-muted-foreground text-xs">
                                        已在范围内
                                      </span>
                                    ) : null}
                                  </TableCell>
                                  <TableCell className="max-w-56 truncate">
                                    {candidate.companyPosition || "-"}
                                  </TableCell>
                                  <TableCell className="tabular-nums">
                                    {candidate.mobile || "-"}
                                  </TableCell>
                                </TableRow>
                              );
                            })
                          )}
                        </TableBody>
                      </Table>
                    </div>

                    <div className="flex items-center justify-between text-muted-foreground text-sm">
                      <span>
                        已选 {organizationSelected.size} 人 / 可添加{" "}
                        {organizationEligibleIds.length} 人 / 已在范围{" "}
                        {organizationExistingCount} 人
                      </span>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={organizationPage <= 1}
                          onClick={() =>
                            setOrganizationPage((previous) => previous - 1)
                          }
                        >
                          上一页
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={
                            organizationPage * 10 >=
                            filteredOrganizationCandidates.length
                          }
                          onClick={() =>
                            setOrganizationPage((previous) => previous + 1)
                          }
                        >
                          下一页
                        </Button>
                      </div>
                    </div>
                  </>
                ) : (
                  <Empty className="border">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <UsersRoundIcon />
                      </EmptyMedia>
                      <EmptyTitle>先选择一个团体</EmptyTitle>
                      <EmptyDescription>
                        选中后会默认勾选该团体所有尚未进入当前范围的有效人员。
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </DialogBody>
            </TabsContent>
          ) : null}
        </Tabs>

        <DialogFooter className="sm:justify-between">
          {mode === "members" && onCreateNew ? (
            <Button type="button" variant="outline" onClick={onCreateNew}>
              找不到？手动录入
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            {mode === "members" ? (
              <Button
                type="button"
                disabled={selected.size === 0 || submitting}
                onClick={() => onConfirm([...selected])}
              >
                确定
              </Button>
            ) : (
              <Button
                type="button"
                disabled={
                  organizationId === null ||
                  organizationSelected.size === 0 ||
                  organizationSelected.size > ORGANIZATION_BATCH_MAX_MEMBERS ||
                  excludeIdsPending ||
                  !!excludeIdsError ||
                  organizationCandidatesQuery.isPending ||
                  organization?.submitting
                }
                onClick={submitOrganization}
              >
                按团体添加 {organizationSelected.size} 人
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
