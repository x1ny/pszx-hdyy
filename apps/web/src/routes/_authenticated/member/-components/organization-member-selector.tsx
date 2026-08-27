import { useQuery } from "@tanstack/react-query";
import { UsersRoundIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { MEMBER_STATUS_LABELS } from "#/features/member/utils.ts";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "#/shared/components/ui/alert.tsx";
import { Badge } from "#/shared/components/ui/badge.tsx";
import { Button } from "#/shared/components/ui/button.tsx";
import { Checkbox } from "#/shared/components/ui/checkbox.tsx";
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
import { memberListQueryOptions, type OrganizationOption } from "../-queries";

const PAGE_SIZE = 8;

type OrganizationMemberSelectorProps = {
  currentOrganizationId?: number;
  organizationOptions: OrganizationOption[];
  selectedMemberIds: number[];
  disabled?: boolean;
  onChange: (memberIds: number[]) => void;
};

/**
 * 批量变更一页成员的选择，同时保留其他页已选成员。
 *
 * 提交给组织接口的是完整 memberIds，因此筛选、翻页绝不能把屏幕外的选择丢掉。
 */
export function changeMemberSelection(
  selectedMemberIds: readonly number[],
  changedMemberIds: readonly number[],
  checked: boolean,
) {
  const next = new Set(selectedMemberIds);
  for (const memberId of changedMemberIds) {
    if (checked) next.add(memberId);
    else next.delete(memberId);
  }
  return [...next].sort((left, right) => left - right);
}

export function shouldWarnOrganizationMove(
  memberOrganizationId: number | null,
  currentOrganizationId: number | undefined,
  selected: boolean,
) {
  return (
    selected &&
    memberOrganizationId !== null &&
    memberOrganizationId !== currentOrganizationId
  );
}

export function OrganizationMemberSelector({
  currentOrganizationId,
  organizationOptions,
  selectedMemberIds,
  disabled = false,
  onChange,
}: OrganizationMemberSelectorProps) {
  const [nameInput, setNameInput] = useState("");
  const [appliedName, setAppliedName] = useState("");
  const [page, setPage] = useState(1);
  const filters = {
    name: appliedName || undefined,
    page,
    pageSize: PAGE_SIZE,
  };
  const listQuery = useQuery(memberListQueryOptions(filters));
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const pageMemberIds = list.map((member) => member.id);
  const selectedSet = useMemo(
    () => new Set(selectedMemberIds),
    [selectedMemberIds],
  );
  const selectedOnPage = pageMemberIds.filter((id) => selectedSet.has(id));
  const allOnPageSelected =
    pageMemberIds.length > 0 && selectedOnPage.length === pageMemberIds.length;
  const someOnPageSelected = selectedOnPage.length > 0 && !allOnPageSelected;
  const organizationNames = useMemo(
    () => new Map(organizationOptions.map((item) => [item.id, item.name])),
    [organizationOptions],
  );
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);
  const hasNext = rangeEnd < total;

  const applyNameFilter = () => {
    setAppliedName(nameInput.trim());
    setPage(1);
    if (nameInput.trim() === appliedName) listQuery.refetch();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
        <Input
          className="w-56"
          placeholder="按姓名搜索成员"
          value={nameInput}
          disabled={disabled}
          onChange={(event) => setNameInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            applyNameFilter();
          }}
        />
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={applyNameFilter}
          >
            查询
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled || (!nameInput && !appliedName)}
            onClick={() => {
              setNameInput("");
              setAppliedName("");
              setPage(1);
            }}
          >
            重置
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <label
            htmlFor="organization-select-current-page"
            className="flex cursor-pointer items-center gap-2 text-sm"
          >
            <Checkbox
              id="organization-select-current-page"
              aria-label="全选当前页成员"
              checked={allOnPageSelected}
              indeterminate={someOnPageSelected}
              disabled={disabled || pageMemberIds.length === 0}
              onCheckedChange={(checked) =>
                onChange(
                  changeMemberSelection(
                    selectedMemberIds,
                    pageMemberIds,
                    !!checked,
                  ),
                )
              }
            />
            全选当前页
          </label>
          <span className="text-muted-foreground text-sm">
            已选 {selectedMemberIds.length} 人
          </span>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled || selectedMemberIds.length === 0}
          onClick={() => onChange([])}
        >
          清空已选
        </Button>
      </div>

      {listQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>成员列表载入失败</AlertTitle>
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
          <Table className="min-w-[720px]">
            <TableHeader className="bg-muted/60">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-12" />
                <TableHead className="min-w-28">姓名</TableHead>
                <TableHead className="min-w-56">企业（社会）职务</TableHead>
                <TableHead className="min-w-52">当前所属团体</TableHead>
                <TableHead className="w-24">状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listQuery.isPending ? (
                Array.from({ length: 4 }, (_, index) => (
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
                    <Empty className="border-0 py-8">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <UsersRoundIcon />
                        </EmptyMedia>
                        <EmptyTitle>没有匹配的成员</EmptyTitle>
                        <EmptyDescription>
                          换个姓名关键词再试。
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  </TableCell>
                </TableRow>
              ) : (
                list.map((member) => {
                  const selected = selectedSet.has(member.id);
                  const organizationName = member.organizationId
                    ? (organizationNames.get(member.organizationId) ??
                      `团体 #${member.organizationId}`)
                    : "未加入团体";
                  const warnMove = shouldWarnOrganizationMove(
                    member.organizationId,
                    currentOrganizationId,
                    selected,
                  );

                  return (
                    <TableRow
                      key={member.id}
                      data-state={selected && "selected"}
                    >
                      <TableCell>
                        <Checkbox
                          aria-label={`选择${member.name}`}
                          checked={selected}
                          disabled={disabled}
                          onCheckedChange={(checked) =>
                            onChange(
                              changeMemberSelection(
                                selectedMemberIds,
                                [member.id],
                                !!checked,
                              ),
                            )
                          }
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        {member.name}
                      </TableCell>
                      <TableCell className="max-w-64 truncate">
                        {member.companyPosition || "-"}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          <Badge
                            variant={
                              member.organizationId === currentOrganizationId
                                ? "secondary"
                                : "outline"
                            }
                          >
                            {organizationName}
                          </Badge>
                          {warnMove && (
                            <span className="text-warning-foreground text-xs">
                              保存后将移入当前团体
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            member.status === "enabled"
                              ? "secondary"
                              : "outline"
                          }
                        >
                          {MEMBER_STATUS_LABELS[member.status]}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })
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
            disabled={disabled || page <= 1}
            onClick={() => setPage((current) => current - 1)}
          >
            上一页
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || !hasNext}
            onClick={() => setPage((current) => current + 1)}
          >
            下一页
          </Button>
        </div>
      </div>
    </div>
  );
}
