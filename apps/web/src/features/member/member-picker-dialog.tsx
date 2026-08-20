import { useQuery } from "@tanstack/react-query";
import { SearchIcon, UsersRoundIcon } from "lucide-react";
import { useEffect, useState } from "react";
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
import { cn } from "#/shared/lib/utils.ts";
import {
  type CandidateScope,
  memberCandidateQueryOptions,
} from "./relation-queries";

/**
 * 从**已有人员**里选人。
 *
 * 数据源不是只有全量人员库，而是可以按上游范围切：加活动人员时通常从本项目
 * 已有的人里挑（他们已经是这个项目的人了，不必去几千人的全量库里翻）；加环节
 * 人员时通常从本活动人员里挑。全量库是兜底，名单上确实来了新人时才用。
 *
 * 各层可选的范围由调用方通过 `scopes` 传进来，这个组件不猜——项目层只有全量，
 * 活动层是全量+项目，环节层是全量+项目+活动。
 *
 * 禁用的人不出现在任何范围里：规则 7 说禁用后不能再新增关系，选出来也会被
 * ladder 挡回去（后端 /candidates 统一过滤）。
 */
export type PickerScope = {
  value: CandidateScope;
  label: string;
  projectId?: number;
  activityId?: number;
};

export function MemberPickerDialog({
  open,
  title,
  description,
  scopes,
  excludeIds,
  submitting,
  onOpenChange,
  onConfirm,
  onCreateNew,
}: {
  open: boolean;
  title: string;
  description?: string;
  /** 可选的数据源，第一个是默认选中的。 */
  scopes: readonly PickerScope[];
  /** 已经在当前范围里的人。仍然显示，但勾不动——比直接过滤掉更好解释。 */
  excludeIds?: readonly number[];
  submitting?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (memberIds: number[]) => void;
  /** 传了就在底部给一个"手动录入"的出口，把用户交给调用方的录入表单。 */
  onCreateNew?: () => void;
}) {
  const [scopeIndex, setScopeIndex] = useState(0);
  const [keyword, setKeyword] = useState("");
  const [applied, setApplied] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!open) return;
    setScopeIndex(0);
    setKeyword("");
    setApplied("");
    setPage(1);
    setSelected(new Set());
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
    enabled: open && !!scope,
  });

  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const excluded = new Set(excludeIds ?? []);

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          {/* 只有一个范围时不渲染切换器——项目层就是这种情况，多一排只有一个
              选项的按钮是噪音。 */}
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
                    // 换范围保留已勾选的人：同一个人可能同时出现在多个范围里，
                    // 切一下就清空会让"先从项目里挑几个、再去全量库补一个"
                    // 这种再正常不过的操作变成两轮。
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
              // 条件没变时 setState 会被 React 原地吞掉，显式重拉一次，让「查询」
              // 同时承担刷新语义（理由见 filter-bar.tsx）。
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
            {/* 弹窗里的选人表格也是表格筛选，触发方式和按钮样式跟列表页一致；
                只有一个关键字条件，不需要重置。 */}
            <FilterActions />
          </form>

          <div className="rounded-lg border">
            <Table>
              <TableHeader className="sticky top-0 bg-muted/60">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-12" />
                  <TableHead className="min-w-24">姓名</TableHead>
                  <TableHead className="min-w-40">企业（社会）职务</TableHead>
                  <TableHead className="min-w-32">手机号码</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listQuery.isPending ? (
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
                  ))
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
                        className={already ? "opacity-50" : "cursor-pointer"}
                        onClick={() => !already && toggle(candidate.id)}
                      >
                        <TableCell>
                          <Checkbox
                            checked={already || selected.has(candidate.id)}
                            disabled={already}
                            onCheckedChange={() => toggle(candidate.id)}
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
                onClick={() => setPage((prev) => prev - 1)}
              >
                上一页
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page * 10 >= total}
                onClick={() => setPage((prev) => prev + 1)}
              >
                下一页
              </Button>
            </div>
          </div>
        </DialogBody>

        <DialogFooter className="sm:justify-between">
          {onCreateNew ? (
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
            <Button
              type="button"
              disabled={selected.size === 0 || submitting}
              onClick={() => onConfirm([...selected])}
            >
              确定
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
