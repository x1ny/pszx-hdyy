import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  Loader2Icon,
  SearchIcon,
  UsersRoundIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { DocxPreview } from "#/features/invitation/docx-preview";
import {
  INVITATION_BATCH_MAX,
  maskMobile,
  todayIsoDate,
} from "#/features/invitation/labels";
import {
  createInvitationBatch,
  getInvitationTemplate,
  getLastVariableValues,
  type InvitationTemplate,
  invitationTemplateListQueryOptions,
  previewInvitationTemplate,
} from "#/features/invitation/queries";
import {
  activityMemberAllEnabledQueryOptions,
  activityMemberListQueryOptions,
} from "#/features/member/relation-queries";
import { FilterActions } from "#/shared/components/filter-bar.tsx";
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
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "#/shared/components/ui/field.tsx";
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

export const Route = createFileRoute(
  "/_authenticated/project/$projectId_/activity/$activityId/invitations/generate",
)({
  component: GeneratePage,
});

const MEMBER_PAGE_SIZE = 10;

/**
 * 生成邀请函。
 *
 * 三件事按顺序定下来：**选谁**（只能从本活动人员里选，BR-DEV-033A）、
 * **用哪个模板**（全局模板池里已启用的）、**这次的变量填什么**。
 *
 * 变量表单是**跟着模板动态长出来的**——模板里有哪几个 `{{}}`，这里就有几个
 * 输入框。系统变量（姓名、发函日期）不出现在这里：姓名逐人自动填，发函日期
 * 单独一个日期选择器。
 */
function GeneratePage() {
  const { projectId, activityId: activityIdParam } = Route.useParams();
  const navigate = Route.useNavigate();
  const activityId = Number(activityIdParam);

  const [nameInput, setNameInput] = useState("");
  const [nameFilter, setNameFilter] = useState<string>();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Map<number, string>>(new Map());
  const [organizationDialogOpen, setOrganizationDialogOpen] = useState(false);
  const [selectedOrganizations, setSelectedOrganizations] = useState<
    Set<number>
  >(new Set());

  const [template, setTemplate] = useState<InvitationTemplate>();
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [issueDate, setIssueDate] = useState(todayIsoDate());
  const [previewOpen, setPreviewOpen] = useState(false);

  const membersQuery = useQuery(
    activityMemberListQueryOptions({
      activityId,
      name: nameFilter,
      memberStatus: "enabled",
      page,
      pageSize: MEMBER_PAGE_SIZE,
    }),
  );
  const members = membersQuery.data?.list ?? [];
  const memberTotal = membersQuery.data?.total ?? 0;

  const organizationMembersQuery = useQuery({
    ...activityMemberAllEnabledQueryOptions(activityId),
    enabled: organizationDialogOpen,
  });
  const organizationMembers = organizationMembersQuery.data ?? [];
  const organizationOptions = useMemo(() => {
    const groups = new Map<
      number,
      { id: number; name: string; memberCount: number }
    >();

    for (const member of organizationMembers) {
      if (member.organizationId === null || !member.organizationName) continue;
      const current = groups.get(member.organizationId);
      if (current) {
        current.memberCount += 1;
      } else {
        groups.set(member.organizationId, {
          id: member.organizationId,
          name: member.organizationName,
          memberCount: 1,
        });
      }
    }

    return [...groups.values()].sort((left, right) =>
      left.name.localeCompare(right.name, "zh-CN"),
    );
  }, [organizationMembers]);

  const templatesQuery = useQuery(
    invitationTemplateListQueryOptions({
      status: "enabled",
      page: 1,
      pageSize: 100,
    }),
  );
  const templates = templatesQuery.data?.list ?? [];

  const customVariables = useMemo(
    () => template?.variables.filter((item) => item.kind === "custom") ?? [],
    [template],
  );

  /**
   * 换模板时把上一次生成填过的值带出来做默认。
   *
   * 模板页刻意不预填变量值（业务决策），但同一个模板的联系人/落款通常一成不变，
   * 每次重敲一遍很蠢。取的是**该模板最近一个批次**填的值，只带出名字仍然存在
   * 的变量——模板文件换过之后变量集可能已经变了。
   */
  const handleTemplateChange = async (templateId: number) => {
    const detail = await getInvitationTemplate(templateId);
    if (!detail) {
      toast.error("模板不存在");
      return;
    }
    setTemplate(detail);

    const last = await getLastVariableValues(templateId).catch(() => undefined);
    const next: Record<string, string> = {};
    for (const item of detail.variables) {
      if (item.kind !== "custom") continue;
      next[item.name] = last?.variables?.[item.name] ?? "";
    }
    setVariables(next);
  };

  const toggleMember = (memberId: number, name: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (checked) next.set(memberId, name);
      else next.delete(memberId);
      return next;
    });
  };

  const toggleOrganization = (organizationId: number, checked: boolean) => {
    setSelectedOrganizations((prev) => {
      const next = new Set(prev);
      if (checked) next.add(organizationId);
      else next.delete(organizationId);
      return next;
    });
  };

  const openOrganizationDialog = () => {
    setSelectedOrganizations(new Set());
    setOrganizationDialogOpen(true);
  };

  const applyOrganizationSelection = () => {
    setSelected((prev) => {
      const next = new Map(prev);
      for (const member of organizationMembers) {
        if (
          member.organizationId !== null &&
          selectedOrganizations.has(member.organizationId)
        ) {
          next.set(member.memberId, member.name);
        }
      }
      return next;
    });
    setOrganizationDialogOpen(false);
    setSelectedOrganizations(new Set());
  };

  const organizationSelectionMemberCount = organizationMembers.filter(
    (member) =>
      member.organizationId !== null &&
      selectedOrganizations.has(member.organizationId) &&
      !selected.has(member.memberId),
  ).length;

  const allOnPageSelected =
    members.length > 0 && members.every((row) => selected.has(row.memberId));

  const missingVariables = customVariables
    .filter((item) => !variables[item.name]?.trim())
    .map((item) => item.name);

  /**
   * 上限只在前端**提前拦一道**，服务端仍然会校验一次。
   * 不做「勾满就不让勾」——那样用户只会觉得复选框坏了；让他勾出来、看见超了
   * 多少、自己决定去掉谁，比替他截断清楚。
   */
  const overLimit = selected.size > INVITATION_BATCH_MAX;

  const canSubmit =
    !!template &&
    selected.size > 0 &&
    !overLimit &&
    missingVariables.length === 0;

  const submitMutation = useMutation({
    mutationFn: () =>
      createInvitationBatch({
        activityId,
        templateId: template?.id as number,
        issueDate,
        variables,
        memberIds: [...selected.keys()],
      }),
    onSuccess: () => {
      toast.success(`已生成 ${selected.size} 份邀请函`);
      navigate({
        to: "/project/$projectId/activity/$activityId/invitations",
        params: { projectId, activityId: activityIdParam },
      });
    },
    onError: (error) => toast.error(error.message),
  });

  const rangeEnd = Math.min(page * MEMBER_PAGE_SIZE, memberTotal);

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            to="/project/$projectId/activity/$activityId/invitations"
            params={{ projectId, activityId: activityIdParam }}
            className="mb-1 inline-flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
          >
            <ArrowLeftIcon className="size-3.5" />
            返回生成记录
          </Link>
          <h2 className="font-semibold text-lg tracking-tight">生成邀请函</h2>
          <p className="text-muted-foreground text-sm">
            每次生成独立留档，不会影响之前已经生成过的批次。单次最多{" "}
            {INVITATION_BATCH_MAX} 人，超出请分批生成。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            disabled={!template}
            onClick={() => setPreviewOpen(true)}
          >
            预览一份
          </Button>
          <Button
            disabled={!canSubmit || submitMutation.isPending}
            // 按钮灰了必须说得出为什么——这里离左边的「已选 x / 200 人」有
            // 一段距离，光靠那行红字不够。
            title={
              overLimit
                ? `单次最多 ${INVITATION_BATCH_MAX} 人，请取消部分选择后再生成`
                : undefined
            }
            onClick={() => submitMutation.mutate()}
          >
            {submitMutation.isPending ? (
              <Loader2Icon className="animate-spin" />
            ) : null}
            生成 {selected.size > 0 ? `${selected.size} 份` : ""}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        {/* 选人 */}
        <div className="rounded-lg border bg-card shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
            <div className="font-medium text-sm">
              邀请对象
              {/* 上限常驻显示，不等超了才冒出来——用户是在这里一个个勾的，
                  额度必须跟着计数一起看得见。 */}
              <span
                className={cn(
                  "ml-2 font-normal",
                  overLimit ? "text-destructive" : "text-muted-foreground",
                )}
              >
                已选 {selected.size} / {INVITATION_BATCH_MAX} 人
                {overLimit
                  ? ` · 超出 ${selected.size - INVITATION_BATCH_MAX} 人，请取消部分选择`
                  : null}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={openOrganizationDialog}
              >
                <UsersRoundIcon data-icon="inline-start" />
                按团体勾选
              </Button>
              <form
                className="flex items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const next = nameInput.trim() || undefined;
                  // 条件没变时 setState 会被 React 原地吞掉，显式重拉一次，让
                  // 「查询」同时承担刷新语义（理由见 filter-bar.tsx）。
                  if (next === nameFilter && page === 1) {
                    membersQuery.refetch();
                    return;
                  }
                  setNameFilter(next);
                  setPage(1);
                }}
              >
                <div className="relative">
                  <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="w-48 pl-8"
                    placeholder="搜索姓名"
                    value={nameInput}
                    onChange={(event) => setNameInput(event.target.value)}
                  />
                </div>
                {/* 卡片头里的一条内嵌筛选，不套 FilterBar 的边框和底色，但触发方式
                    和按钮样式跟列表页保持一致。这里没有别的条件，不需要重置。 */}
                <FilterActions />
              </form>
            </div>
          </div>

          <Table>
            <TableHeader className="bg-muted/60">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10">
                  <Checkbox
                    checked={allOnPageSelected}
                    onCheckedChange={(checked) => {
                      for (const row of members) {
                        toggleMember(row.memberId, row.name, checked === true);
                      }
                    }}
                  />
                </TableHead>
                <TableHead>姓名</TableHead>
                <TableHead>所属团体</TableHead>
                <TableHead>单位职务</TableHead>
                <TableHead>手机号</TableHead>
                <TableHead>来源</TableHead>
                <TableHead>分组</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {membersQuery.isPending ? (
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
              ) : members.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <Empty className="border-0">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <UsersRoundIcon />
                        </EmptyMedia>
                        <EmptyTitle>没有可邀请的活动人员</EmptyTitle>
                        <EmptyDescription>
                          先到「活动人员」页把人加进来，邀请函只能发给本活动人员。
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  </TableCell>
                </TableRow>
              ) : (
                members.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(row.memberId)}
                        onCheckedChange={(checked) =>
                          toggleMember(row.memberId, row.name, checked === true)
                        }
                      />
                    </TableCell>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.organizationName || "-"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.companyPosition || "-"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {maskMobile(row.mobile)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.source || "-"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.groupName || "-"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between gap-2 border-t p-3">
            <span className="text-muted-foreground text-sm">
              共 {memberTotal} 名可邀请人员
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((prev) => prev - 1)}
              >
                上一页
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={rangeEnd >= memberTotal}
                onClick={() => setPage((prev) => prev + 1)}
              >
                下一页
              </Button>
            </div>
          </div>
        </div>

        {/* 模板 + 变量 */}
        <div className="flex flex-col gap-4">
          <div className="space-y-3 rounded-lg border bg-card p-4 shadow-sm">
            <Field>
              <FieldLabel htmlFor="template">发函文件模板</FieldLabel>
              <Select
                items={templates.map((item) => ({
                  value: item.id,
                  label: item.name,
                }))}
                value={template?.id ?? null}
                onValueChange={(value) =>
                  value && handleTemplateChange(Number(value))
                }
              >
                <SelectTrigger id="template">
                  <SelectValue placeholder="请选择模板" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {templates.length === 0 && !templatesQuery.isPending ? (
                <p className="text-muted-foreground text-xs">
                  还没有启用的模板，先到「邀请函模板」上传一份 .docx。
                </p>
              ) : null}
            </Field>

            <Field>
              <FieldLabel htmlFor="issueDate">发函日期</FieldLabel>
              <Input
                id="issueDate"
                type="date"
                value={issueDate}
                onChange={(event) => setIssueDate(event.target.value)}
              />
            </Field>
          </div>

          {template ? (
            <div className="space-y-3 rounded-lg border bg-card p-4 shadow-sm">
              <div className="font-medium text-sm">变量填写</div>

              {customVariables.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  这个模板没有需要填写的变量，内容全部固定在文件里。
                </p>
              ) : (
                customVariables.map((item) => (
                  <Field key={item.name}>
                    <FieldLabel htmlFor={`var-${item.name}`}>
                      {item.name}
                    </FieldLabel>
                    <Input
                      id={`var-${item.name}`}
                      value={variables[item.name] ?? ""}
                      placeholder={`填入 {{${item.name}}} 的内容`}
                      onChange={(event) =>
                        setVariables((prev) => ({
                          ...prev,
                          [item.name]: event.target.value,
                        }))
                      }
                    />
                  </Field>
                ))
              )}

              <p className="border-t pt-3 text-muted-foreground text-xs">
                {"{{姓名}}"} 按每个邀请对象自动填充，{"{{发函日期}}"}{" "}
                取上面的发函日期，都不需要在这里填。
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <Dialog
        open={organizationDialogOpen}
        onOpenChange={(open) => {
          setOrganizationDialogOpen(open);
          if (!open) setSelectedOrganizations(new Set());
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>按团体勾选</DialogTitle>
            <DialogDescription>
              选择一个或多个团体，确认后会勾选这些团体在当前活动中的全部启用人员。
              你仍可以回到人员列表逐人调整。
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            {organizationMembersQuery.isPending ? (
              <FieldGroup className="gap-2">
                {Array.from({ length: 4 }, (_, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: 骨架屏没有业务身份
                  <Skeleton key={index} className="h-14 w-full" />
                ))}
              </FieldGroup>
            ) : organizationMembersQuery.isError ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <p className="text-muted-foreground text-sm">
                  团体加载失败，请重试。
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => organizationMembersQuery.refetch()}
                >
                  重试
                </Button>
              </div>
            ) : organizationOptions.length === 0 ? (
              <Empty className="border-0">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <UsersRoundIcon />
                  </EmptyMedia>
                  <EmptyTitle>当前活动没有可选团体</EmptyTitle>
                  <EmptyDescription>
                    只有当前活动中仍有启用人员的团体会显示在这里；无团体人员仍可在下方列表中单独勾选。
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    选择后将批量勾选团体成员
                  </span>
                  <span className="font-medium">
                    已选 {selectedOrganizations.size} 个团体
                  </span>
                </div>
                <FieldGroup className="gap-2">
                  {organizationOptions.map((organization) => {
                    const checkboxId = `invitation-organization-${organization.id}`;
                    return (
                      <Field
                        key={organization.id}
                        orientation="horizontal"
                        className="rounded-md border px-3 py-3"
                      >
                        <Checkbox
                          id={checkboxId}
                          checked={selectedOrganizations.has(organization.id)}
                          onCheckedChange={(checked) =>
                            toggleOrganization(
                              organization.id,
                              checked === true,
                            )
                          }
                        />
                        <FieldContent>
                          <FieldLabel htmlFor={checkboxId}>
                            {organization.name}
                          </FieldLabel>
                          <FieldDescription>
                            {organization.memberCount} 名可邀请人员
                          </FieldDescription>
                        </FieldContent>
                      </Field>
                    );
                  })}
                </FieldGroup>
                {selectedOrganizations.size > 0 ? (
                  <p className="text-muted-foreground text-xs">
                    本次将新增勾选 {organizationSelectionMemberCount}{" "}
                    名人员；已勾选的人不会重复计算。
                  </p>
                ) : null}
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOrganizationDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              disabled={
                selectedOrganizations.size === 0 ||
                organizationMembersQuery.isPending ||
                organizationMembersQuery.isError
              }
              onClick={applyOrganizationSelection}
            >
              确认勾选
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>预览</DialogTitle>
          </DialogHeader>
          <DialogBody>
            {template ? (
              <DocxPreview
                // 变量值进 key：改完一个字重开预览必须看到新的。
                queryKey={[
                  "invitationGeneratePreview",
                  template.templateFileId,
                  variables,
                  issueDate,
                  [...selected.values()][0] ?? "",
                ]}
                enabled={previewOpen}
                load={() =>
                  previewInvitationTemplate({
                    templateFileId: template.templateFileId,
                    variables,
                    // 用第一个选中的人预览，比样例「张三」更能说明问题。
                    recipientName: [...selected.values()][0],
                    issueDate,
                  })
                }
              />
            ) : null}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  );
}
