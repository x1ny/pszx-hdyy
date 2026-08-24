import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PlusIcon, SearchIcon, UsersRoundIcon } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { MemberPickerDialog } from "#/features/member/member-picker-dialog.tsx";
import { MemberQuickCreateDialog } from "#/features/member/member-quick-create-dialog.tsx";
import {
  emptyRelationForm,
  RelationFields,
  type RelationFormValues,
  toRelationInput,
} from "#/features/member/relation-fields.tsx";
import {
  type ActivityMember,
  type ActivityMemberDetail,
  activityMemberDetailQueryOptions,
  activityMemberKeys,
  activityMemberListQueryOptions,
  activityMemberSourcesQueryOptions,
  addActivityMembers,
  addNewActivityMember,
  getActivityMemberImpact,
  type NewMemberFields,
  RELATION_ORIGIN_LABELS,
  removeActivityMember,
  updateActivityMember,
} from "#/features/member/relation-queries.ts";
import {
  FilterActions,
  FilterBar,
  isSameFilter,
} from "#/shared/components/filter-bar.tsx";
import { Badge } from "#/shared/components/ui/badge.tsx";
import { Button } from "#/shared/components/ui/button.tsx";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "#/shared/components/ui/card.tsx";
import {
  Dialog,
  DialogBody,
  DialogClose,
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

const SearchSchema = z.object({
  name: z.string().optional().catch(undefined),
  source: z.string().optional().catch(undefined),
  groupName: z.string().optional().catch(undefined),
  ownerName: z.string().optional().catch(undefined),
  page: z.number().int().min(1).default(1).catch(1),
  pageSize: z.number().int().min(1).max(100).default(10).catch(10),
});

export const Route = createFileRoute(
  "/_authenticated/project/$projectId_/activity/$activityId/members",
)({
  validateSearch: SearchSchema,
  component: ActivityMembersPage,
});

function ActivityMembersPage() {
  const { projectId: projectIdParam, activityId: activityIdParam } =
    Route.useParams();
  const activityId = Number(activityIdParam);
  const projectId = Number(projectIdParam);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();

  const [nameInput, setNameInput] = useState(search.name ?? "");
  const [sourceInput, setSourceInput] = useState<string | null>(
    search.source ?? null,
  );
  const [groupInput, setGroupInput] = useState(search.groupName ?? "");
  const [ownerInput, setOwnerInput] = useState(search.ownerName ?? "");

  // URL 变了就把草稿拉回来对齐（后退、粘链接进来）。
  useEffect(() => {
    setNameInput(search.name ?? "");
    setSourceInput(search.source ?? null);
    setGroupInput(search.groupName ?? "");
    setOwnerInput(search.ownerName ?? "");
  }, [search.name, search.source, search.groupName, search.ownerName]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] =
    useState<RelationFormValues>(emptyRelationForm);
  const [pendingIds, setPendingIds] = useState<number[]>([]);
  const [addForm, setAddForm] = useState<RelationFormValues>(emptyRelationForm);

  const [editing, setEditing] = useState<ActivityMember>();
  const [editForm, setEditForm] =
    useState<RelationFormValues>(emptyRelationForm);

  const [viewing, setViewing] = useState<ActivityMember>();
  const [removing, setRemoving] = useState<ActivityMember>();

  const filters = { activityId, ...search };
  const listQuery = useQuery(activityMemberListQueryOptions(filters));
  const sourcesQuery = useQuery(activityMemberSourcesQueryOptions(activityId));
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const sourceItems = useMemo(
    () => [
      { value: null, label: "全部来源" },
      ...(sourcesQuery.data ?? []).map((source) => ({
        value: source,
        label: source,
      })),
    ],
    [sourcesQuery.data],
  );

  // 移除前的受影响清单。只在确认弹窗打开时才查——它是"点了移除之后"才需要的
  // 信息，提前查会给每一行都发一个请求。
  const impactQuery = useQuery({
    queryKey: ["activityMember", "impact", removing?.id],
    queryFn: () => getActivityMemberImpact(removing?.id ?? 0),
    enabled: !!removing,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: activityMemberKeys.all });

  const applyFilter = (patch: Partial<typeof search>) => {
    const next = { ...search, ...patch, page: 1 };
    // 条件没变时 navigate 是空操作，显式重拉一次，让「查询」同时承担刷新
    // 语义（理由见 filter-bar.tsx）。
    if (isSameFilter(search, next)) return invalidate();
    navigate({ search: next });
  };

  const addMutation = useMutation({
    mutationFn: (memberIds: number[]) =>
      addActivityMembers({
        activityId,
        memberIds,
        originType: "manual",
        ...toRelationInput(addForm),
      }),
    onSuccess: (result) => {
      toast.success(`已新增 ${result.added} 名活动人员`);
      setPendingIds([]);
      setAddForm(emptyRelationForm);
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const createMutation = useMutation({
    mutationFn: (fields: NewMemberFields) =>
      addNewActivityMember({
        activityId,
        member: fields,
        ...toRelationInput(createForm),
      }),
    onSuccess: () => {
      toast.success("已录入并加入本活动，同时写入全量人员库");
      setCreateOpen(false);
      setCreateForm(emptyRelationForm);
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      updateActivityMember({
        id: editing?.id ?? 0,
        ...toRelationInput(editForm),
      }),
    onSuccess: () => {
      toast.success("活动人员关系已保存");
      setEditing(undefined);
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const removeMutation = useMutation({
    // cascade 恒为 true：这个弹窗本身就是 BR-DEV-029 要求的那次二次确认，
    // 用户看着受影响清单点的"确认移除"。带 false 再来一轮只是多一个往返。
    mutationFn: (target: ActivityMember) =>
      removeActivityMember(target.id, true),
    onSuccess: () => {
      toast.success("已解除该人员在本活动下的关系");
      setRemoving(undefined);
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
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold text-lg tracking-tight">活动人员</h2>
          <p className="text-muted-foreground text-sm">
            维护本场活动的参与人员及其来源、分组、负责人。人员基础信息在全量人员库维护，这里只管当前活动的参与关系。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setCreateForm(emptyRelationForm);
              setCreateOpen(true);
            }}
          >
            手动录入
          </Button>
          <Button
            onClick={() => {
              setAddForm(emptyRelationForm);
              setPickerOpen(true);
            }}
          >
            <PlusIcon />
            从已有人员选择
          </Button>
        </div>
      </div>

      <FilterBar
        onSubmit={() =>
          applyFilter({
            name: nameInput.trim() || undefined,
            source: sourceInput ?? undefined,
            groupName: groupInput.trim() || undefined,
            ownerName: ownerInput.trim() || undefined,
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
        <Select
          items={sourceItems}
          value={sourceInput}
          onValueChange={(value) =>
            setSourceInput(value === null ? null : String(value))
          }
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {sourceItems.map((item) => (
                <SelectItem key={item.value ?? "all"} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Input
          className="w-48"
          placeholder="搜索分组"
          value={groupInput}
          onChange={(event) => setGroupInput(event.target.value)}
        />
        <Input
          className="w-44"
          placeholder="搜索负责人"
          value={ownerInput}
          onChange={(event) => setOwnerInput(event.target.value)}
        />
        <FilterActions
          onReset={() => {
            setNameInput("");
            setSourceInput(null);
            setGroupInput("");
            setOwnerInput("");
            navigate({ search: { page: 1, pageSize: search.pageSize } });
          }}
        />
      </FilterBar>

      <div className="overflow-x-auto rounded-lg border bg-card shadow-sm">
        <Table className="min-w-[1240px]">
          <TableHeader className="bg-muted/60">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-16 text-center">序号</TableHead>
              <TableHead className="min-w-44">人员</TableHead>
              <TableHead className="min-w-28">来源</TableHead>
              <TableHead className="min-w-28">分组</TableHead>
              <TableHead className="min-w-24">负责人</TableHead>
              <TableHead className="min-w-28">录入渠道</TableHead>
              <TableHead className="min-w-52">参与环节</TableHead>
              <TableHead className="min-w-32">备注</TableHead>
              <TableHead className="w-56 text-center">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQuery.isPending ? (
              Array.from({ length: 5 }, (_, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 骨架屏没有身份
                <TableRow key={index}>
                  {Array.from({ length: 9 }, (_, cell) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: 骨架屏没有身份
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
                        <UsersRoundIcon />
                      </EmptyMedia>
                      <EmptyTitle>本场活动还没有人员</EmptyTitle>
                      <EmptyDescription>
                        从全量人员库选人加入本活动，加入后可继续分配到具体环节。
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
                  <TableCell>{row.source || "-"}</TableCell>
                  <TableCell>{row.groupName || "-"}</TableCell>
                  <TableCell>{row.ownerName || "-"}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="font-normal">
                      {RELATION_ORIGIN_LABELS[row.originType]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {row.segments.length > 0 ? (
                      <ol className="flex min-w-48 flex-col gap-1">
                        {row.segments.map((segment, segmentIndex) => (
                          <li
                            key={segment.id}
                            className="flex items-baseline gap-1.5"
                          >
                            <span className="w-4 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
                              {segmentIndex + 1}.
                            </span>
                            <span>{segment.name}</span>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                  <TableCell className="max-w-40 truncate text-muted-foreground">
                    {row.remark || "-"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-center">
                    <div className="inline-flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-primary hover:text-primary"
                        onClick={() => setViewing(row)}
                      >
                        详情
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-primary hover:text-primary"
                        onClick={() => {
                          setEditing(row);
                          setEditForm({
                            source: row.source ?? "",
                            groupName: row.groupName ?? "",
                            ownerName: row.ownerName ?? "",
                            remark: row.remark ?? "",
                          });
                        }}
                      >
                        编辑关系
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setRemoving(row)}
                      >
                        移除
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

      <ActivityMemberDetailDialog
        member={viewing}
        onOpenChange={(open) => {
          if (!open) setViewing(undefined);
        }}
      />

      {/* 「本项目人员」放在前面当默认：加活动人员时绝大多数时候是从本项目
          已有的人里挑，全量库是名单上确实来了新人时才翻的兜底。 */}
      <MemberPickerDialog
        open={pickerOpen}
        title="从已有人员选择"
        description="选中的人员将加入本场活动；若他们还不在本项目内，系统会自动补齐项目人员关系。"
        scopes={[
          { value: "project", label: "本项目人员", projectId },
          { value: "all", label: "全量人员库" },
        ]}
        excludeIds={list.map((row) => row.memberId)}
        onOpenChange={setPickerOpen}
        onConfirm={(memberIds) => {
          setPendingIds(memberIds);
          setPickerOpen(false);
        }}
        onCreateNew={() => {
          setPickerOpen(false);
          setCreateForm(emptyRelationForm);
          setCreateOpen(true);
        }}
      />

      <MemberQuickCreateDialog
        open={createOpen}
        title="手动录入活动人员"
        description="全量人员库里还没有这个人时用这个入口。保存后会同时建立主档、项目关系和本活动关系。"
        submitting={createMutation.isPending}
        extraFields={
          <RelationFields
            value={createForm}
            onChange={setCreateForm}
            idPrefix="new"
          />
        }
        onOpenChange={setCreateOpen}
        onSubmit={(fields) => createMutation.mutate(fields)}
      />

      {/* 选完人再填关系字段：原型 activity-members.html 就是一组表单配一次
          多选，来源/分组/负责人整批套用，个别不同的进列表再单独改。 */}
      <Dialog
        open={pendingIds.length > 0}
        onOpenChange={(open) => {
          if (!open) setPendingIds([]);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>设置活动关系</DialogTitle>
            <DialogDescription>
              这 {pendingIds.length} 人将套用同一组关系字段，加入后可逐条调整。
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <RelationFields
              value={addForm}
              onChange={setAddForm}
              idPrefix="add"
            />
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingIds([])}>
              取消
            </Button>
            <Button
              disabled={addMutation.isPending}
              onClick={() => addMutation.mutate(pendingIds)}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) setEditing(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑活动关系</DialogTitle>
            <DialogDescription>
              {`「${editing?.name}」在本场活动下的关系字段。改动只影响当前活动，不会写回人员主档，也不影响其他活动。`}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <RelationFields
              value={editForm}
              onChange={setEditForm}
              idPrefix="edit"
            />
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(undefined)}>
              取消
            </Button>
            <Button
              disabled={updateMutation.isPending}
              onClick={() => updateMutation.mutate()}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* BR-DEV-029 的二次确认。清单由后端 /impact 给，前端不自己拼文案——
          将来排位、资源绑定、邀请函接进去时，这里一个字都不用改。 */}
      <Dialog
        open={!!removing}
        onOpenChange={(open) => {
          if (!open) setRemoving(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认移除该活动人员？</DialogTitle>
            <DialogDescription>
              {`将解除「${removing?.name}」在本场活动下的参与关系。人员主档和项目人员关系保留，之后仍可重新加入。`}
            </DialogDescription>
          </DialogHeader>

          <DialogBody>
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              {impactQuery.isPending ? (
                <Skeleton className="h-5 w-2/3" />
              ) : impactQuery.data && impactQuery.data.items.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <p className="font-medium text-destructive">
                    以下关联内容会被一并解除，且不支持复原：
                  </p>
                  {impactQuery.data.items.map((item) => (
                    <div key={item.kind}>
                      <span className="text-muted-foreground">
                        {item.label}：
                      </span>
                      {item.names.join("、")}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">
                  该人员暂无其他关联内容。
                </p>
              )}
            </div>
          </DialogBody>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(undefined)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={removeMutation.isPending || impactQuery.isPending}
              onClick={() => removing && removeMutation.mutate(removing)}
            >
              确认移除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type ActivityMemberDetailDialogProps = {
  member?: ActivityMember;
  onOpenChange: (open: boolean) => void;
};

function ActivityMemberDetailDialog({
  member,
  onOpenChange,
}: ActivityMemberDetailDialogProps) {
  return (
    <Dialog open={!!member} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl" showCloseButton={false}>
        <DialogHeader className="flex-row items-center justify-between pr-6">
          <DialogTitle>活动人员详情</DialogTitle>
          <DialogClose render={<Button variant="ghost" size="sm" />}>
            关闭
          </DialogClose>
        </DialogHeader>
        {member && <ActivityMemberDetailContent id={member.id} />}
      </DialogContent>
    </Dialog>
  );
}

function ActivityMemberDetailContent({ id }: { id: number }) {
  const detailQuery = useQuery(activityMemberDetailQueryOptions(id));

  if (detailQuery.isPending) {
    return (
      <DialogBody className="flex flex-col gap-4">
        {Array.from({ length: 3 }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 骨架屏没有身份
          <Skeleton className="h-44 w-full" key={index} />
        ))}
      </DialogBody>
    );
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <DialogBody>
        <Empty className="rounded-lg border border-dashed py-10">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UsersRoundIcon />
            </EmptyMedia>
            <EmptyTitle>活动人员详情加载失败</EmptyTitle>
            <EmptyDescription>请关闭弹窗后重试。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </DialogBody>
    );
  }

  const detail = detailQuery.data;
  const contact = [detail.mobile, detail.phone].filter(Boolean).join(" / ");

  return (
    <DialogBody className="flex flex-col gap-4">
      <DetailCard action="查看主档" title="人员主档摘要">
        <dl className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
          <DetailField label="姓名">{displayValue(detail.name)}</DetailField>
          <DetailField label="性别">{displayValue(detail.gender)}</DetailField>
          <DetailField label="国别/地区">
            {displayValue(detail.countryRegion)}
          </DetailField>
          <DetailField label="籍贯">
            {displayValue(detail.nativePlace)}
          </DetailField>
          <DetailField label="职务">
            {displayValue(detail.companyPosition)}
          </DetailField>
          <DetailField label="证件类型">
            {displayValue(detail.idType)}
          </DetailField>
          <DetailField label="证件号码">
            {maskIdNumber(detail.idNumber)}
          </DetailField>
          <DetailField label="联系方式">{contact || "-"}</DetailField>
          <DetailField label="邮箱">{displayValue(detail.email)}</DetailField>
          <DetailField label="语种">
            {displayValue(detail.language)}
          </DetailField>
        </dl>
      </DetailCard>

      <DetailCard action="编辑关系" title="当前活动关系">
        <dl className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
          <DetailField label="来源">{displayValue(detail.source)}</DetailField>
          <DetailField label="分组">
            {displayValue(detail.groupName)}
          </DetailField>
          <DetailField label="负责人">
            {displayValue(detail.ownerName)}
          </DetailField>
          <DetailField label="数据来源">
            {RELATION_ORIGIN_LABELS[detail.originType]}
          </DetailField>
          <div className="sm:col-span-2 lg:col-span-4">
            <dt className="font-medium text-sm">备注</dt>
            <dd className="mt-1 whitespace-pre-wrap text-sm leading-6">
              {displayValue(detail.remark)}
            </dd>
          </div>
        </dl>
      </DetailCard>

      <DetailCard action="调整" title="环节参与">
        <SegmentParticipationTable detail={detail} />
      </DetailCard>
    </DialogBody>
  );
}

function DetailCard({
  title,
  action,
  children,
}: {
  title: string;
  action: string;
  children: ReactNode;
}) {
  return (
    <Card size="sm" className="shrink-0">
      <CardHeader className="border-b">
        <CardTitle>{title}</CardTitle>
        {/* 原型中的详情内操作本期只保留位置，不接跳转或编辑逻辑。禁用态能明确
            表达“暂不可用”，也避免一个看似可点击、实际无响应的按钮。 */}
        <CardAction>
          <Button variant="outline" size="sm" disabled>
            {action}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function DetailField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <dt className="font-medium text-sm">{label}</dt>
      <dd className="mt-1 break-words text-sm leading-6">{children}</dd>
    </div>
  );
}

function SegmentParticipationTable({
  detail,
}: {
  detail: ActivityMemberDetail;
}) {
  if (detail.segments.length === 0) {
    return (
      <Empty className="border-0 py-8">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UsersRoundIcon />
          </EmptyMedia>
          <EmptyTitle>暂未参与任何环节</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Table>
      <TableHeader className="bg-muted/60">
        <TableRow className="hover:bg-transparent">
          <TableHead className="min-w-32">环节</TableHead>
          <TableHead className="min-w-24">环节身份</TableHead>
          <TableHead className="min-w-24">负责人</TableHead>
          <TableHead className="min-w-24">排位状态</TableHead>
          <TableHead className="min-w-40">座位</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {detail.segments.map((segment) => (
          <TableRow key={segment.id}>
            <TableCell className="font-medium">{segment.name}</TableCell>
            <TableCell>{displayValue(segment.segmentRole)}</TableCell>
            <TableCell>{displayValue(segment.ownerName)}</TableCell>
            <TableCell>
              <SeatingStatusBadge status={segment.seatingStatus} />
            </TableCell>
            <TableCell>{formatSeat(segment)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

type SeatingStatus = NonNullable<
  ActivityMemberDetail["segments"][number]["seatingStatus"]
>;

const SEATING_STATUS_LABELS = {
  pending: "待确认",
  confirmed: "已确认",
  rejected: "已退回",
  voided: "已作废",
} as const satisfies Record<SeatingStatus, string>;

function SeatingStatusBadge({ status }: { status: SeatingStatus | null }) {
  if (!status) return <Badge variant="outline">未配置</Badge>;

  return (
    <Badge variant={status === "confirmed" ? "default" : "secondary"}>
      {SEATING_STATUS_LABELS[status]}
    </Badge>
  );
}

function formatSeat(segment: ActivityMemberDetail["segments"][number]) {
  if (segment.seatLabel && segment.seatingStatus !== "confirmed") {
    return "待确认后展示";
  }

  return (
    [segment.venueName, segment.zoneName, segment.seatLabel]
      .filter(Boolean)
      .join(" ") || "-"
  );
}

function maskIdNumber(value: string | null) {
  if (!value) return "-";
  if (value.length <= 8) return value;

  const headLength = value.length >= 14 ? 6 : 2;
  const tailLength = 4;
  return `${value.slice(0, headLength)}${"*".repeat(
    value.length - headLength - tailLength,
  )}${value.slice(-tailLength)}`;
}

function displayValue(value: string | null | undefined) {
  return value || "-";
}
