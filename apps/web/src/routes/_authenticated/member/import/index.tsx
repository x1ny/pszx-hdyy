import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useBlocker } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  DownloadIcon,
  FileSpreadsheetIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
  UploadIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { memberKeys } from "#/features/member/queries.ts";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "#/shared/components/ui/alert.tsx";
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
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/shared/components/ui/card.tsx";
import { Input } from "#/shared/components/ui/input.tsx";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/shared/components/ui/select.tsx";
import { cn } from "#/shared/lib/utils.ts";
import { ImportPreviewTable } from "./-components/import-preview-table";
import {
  commitMemberImport,
  editableMemberImportRows,
  getMemberImportTemplate,
  type MemberImportPreviewRow,
  type MemberImportRow,
  type MemberImportValidation,
  previewMemberImport,
  validateMemberImport,
} from "./-queries";
import {
  downloadBase64File,
  downloadMemberImportIssues,
  type MemberImportField,
} from "./-utils";

export const Route = createFileRoute("/_authenticated/member/import/")({
  component: MemberImportPage,
});

type IssueFilter = "all" | "error" | "warning";

const ISSUE_FILTERS: ReadonlyArray<{ value: IssueFilter; label: string }> = [
  { value: "all", label: "全部数据" },
  { value: "error", label: "仅看错误" },
  { value: "warning", label: "仅看警告" },
];
const PAGE_SIZE_OPTIONS = [20, 50, 100];
const ORGANIZATION_QUERY_KEY = ["organization"] as const;

function MemberImportPage() {
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const latestRevisionRef = useRef(0);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<MemberImportRow[] | null>(null);
  const [validation, setValidation] = useState<MemberImportValidation | null>(
    null,
  );
  const [revision, setRevision] = useState(0);
  const [validatedRevision, setValidatedRevision] = useState(0);
  const [isRevalidating, setIsRevalidating] = useState(false);
  const [revalidationError, setRevalidationError] = useState("");
  const [issueFilter, setIssueFilter] = useState<IssueFilter>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const blocker = useBlocker({
    shouldBlockFn: () => rows !== null,
    enableBeforeUnload: rows !== null,
    withResolver: true,
  });

  const previewMutation = useMutation({
    mutationFn: previewMemberImport,
    onSuccess: (result, file) => {
      const nextRows = editableMemberImportRows(result.rows);
      latestRevisionRef.current = 0;
      setFileName(file.name);
      setRows(nextRows);
      setValidation(result);
      setRevision(0);
      setValidatedRevision(0);
      setRevalidationError("");
      setIssueFilter("all");
      setPage(1);
      toast.success(`已读取 ${result.summary.total} 行人员数据`);
    },
    onError: (error) => toast.error(error.message),
  });

  const templateMutation = useMutation({
    mutationFn: getMemberImportTemplate,
    onSuccess: (result) => {
      downloadBase64File(
        result.contentBase64,
        result.mimeType,
        result.fileName,
      );
      toast.success("人员导入模板已下载");
    },
    onError: (error) => toast.error(error.message),
  });

  const commitMutation = useMutation({
    mutationFn: async () => {
      if (!rows || !validation) throw new Error("请先上传并校验导入数据");
      return commitMemberImport(rows, validation.summary.warningCount > 0);
    },
    onSuccess: async (result) => {
      latestRevisionRef.current = -1;
      setRows(null);
      setValidation(null);
      setConfirmOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: memberKeys.all }),
        queryClient.invalidateQueries({ queryKey: ORGANIZATION_QUERY_KEY }),
      ]);
      const organizationMessage =
        result.createdOrganizationCount > 0
          ? `，并新建 ${result.createdOrganizationCount} 个团体`
          : "";
      toast.success(
        `已成功导入 ${result.importedCount} 名人员${organizationMessage}`,
      );
      navigate({ to: "/member", ignoreBlocker: true });
    },
    onError: (error) => {
      setConfirmOpen(false);
      toast.error(error.message);
      if (rows) {
        const nextRevision = latestRevisionRef.current + 1;
        latestRevisionRef.current = nextRevision;
        setRevision(nextRevision);
      }
    },
  });

  useEffect(() => {
    if (!rows || revision === validatedRevision) return;

    let active = true;
    const validatingRevision = revision;
    const rowsSnapshot = rows;
    const timer = window.setTimeout(async () => {
      setIsRevalidating(true);
      setRevalidationError("");
      try {
        const result = await validateMemberImport(rowsSnapshot);
        if (active && latestRevisionRef.current === validatingRevision) {
          setValidation(result);
          setValidatedRevision(validatingRevision);
        }
      } catch (error) {
        if (active && latestRevisionRef.current === validatingRevision) {
          setRevalidationError(
            error instanceof Error ? error.message : "重新校验失败",
          );
        }
      } finally {
        if (active && latestRevisionRef.current === validatingRevision) {
          setIsRevalidating(false);
        }
      }
    }, 500);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [revision, rows, validatedRevision]);

  const previewRows = useMemo<MemberImportPreviewRow[]>(() => {
    if (!rows) return [];
    const issuesBySourceRow = new Map(
      validation?.rows.map((row) => [row.sourceRow, row.issues]) ?? [],
    );
    return rows.map((row) => ({
      ...row,
      issues: issuesBySourceRow.get(row.sourceRow) ?? [],
    }));
  }, [rows, validation]);

  const filteredRows = useMemo(
    () =>
      previewRows.filter((row) => {
        if (issueFilter === "all") return true;
        return row.issues.some((issue) => issue.severity === issueFilter);
      }),
    [issueFilter, previewRows],
  );
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const visibleRows = filteredRows.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  );
  const rangeStart =
    filteredRows.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeEnd = Math.min(safePage * pageSize, filteredRows.length);
  const validationIsCurrent =
    rows !== null && revision === validatedRevision && !revalidationError;
  const canImport =
    validationIsCurrent &&
    !isRevalidating &&
    !previewMutation.isPending &&
    !commitMutation.isPending &&
    validation !== null &&
    validation.summary.errorCount === 0;

  const markRowsChanged = (nextRows: MemberImportRow[]) => {
    const nextRevision = latestRevisionRef.current + 1;
    latestRevisionRef.current = nextRevision;
    setRows(nextRows);
    setRevision(nextRevision);
  };

  const handleCellChange = (
    sourceRow: number,
    field: MemberImportField,
    value: string,
  ) => {
    if (!rows) return;
    markRowsChanged(
      rows.map((row) =>
        row.sourceRow === sourceRow ? { ...row, [field]: value } : row,
      ),
    );
  };

  const handleRemoveRow = (sourceRow: number) => {
    if (!rows) return;
    if (rows.length === 1) {
      toast.error("至少保留一行人员数据");
      return;
    }
    const removedIndex = rows.findIndex((row) => row.sourceRow === sourceRow);
    const removed = rows[removedIndex];
    if (!removed) return;
    markRowsChanged(rows.filter((row) => row.sourceRow !== sourceRow));
    toast(`已移除 Excel 第 ${sourceRow} 行`, {
      action: {
        label: "撤销",
        onClick: () => {
          setRows((current) => {
            if (
              !current ||
              current.some((row) => row.sourceRow === sourceRow)
            ) {
              return current;
            }
            const next = [...current];
            next.splice(Math.min(removedIndex, next.length), 0, removed);
            return next;
          });
          const nextRevision = latestRevisionRef.current + 1;
          latestRevisionRef.current = nextRevision;
          setRevision(nextRevision);
        },
      },
    });
  };

  const handleFile = (file?: File) => {
    if (file) previewMutation.mutate(file);
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            aria-label="返回人员管理"
            className={buttonVariants({ variant: "outline", size: "icon" })}
            to="/member"
          >
            <ArrowLeftIcon />
          </Link>
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileSpreadsheetIcon className="size-5" />
          </div>
          <div>
            <h1 className="font-semibold text-xl tracking-tight">
              批量导入人员
            </h1>
            <p className="text-muted-foreground text-sm">
              上传固定模板，检查并修正识别结果后一次性导入。
            </p>
          </div>
        </div>
        <Button
          disabled={templateMutation.isPending}
          variant="outline"
          onClick={() => templateMutation.mutate()}
        >
          {templateMutation.isPending ? (
            <LoaderCircleIcon
              className="animate-spin"
              data-icon="inline-start"
            />
          ) : (
            <DownloadIcon data-icon="inline-start" />
          )}
          下载固定模板
        </Button>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>上传 Excel 文件</CardTitle>
          <CardDescription>
            仅支持 .xlsx，单次最多 2,000 行。系统只读取数据，不保存原文件。
          </CardDescription>
          {fileName && (
            <CardAction>
              <Badge variant="outline">当前：{fileName}</Badge>
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed bg-muted/25 p-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-background text-primary shadow-xs ring-1 ring-foreground/10">
              <UploadIcon className="size-5" />
            </div>
            <div className="min-w-52 flex-1">
              <p className="font-medium text-sm">
                {rows ? "重新选择文件会替换当前预览" : "选择填写完成的导入模板"}
              </p>
              <p className="text-muted-foreground text-xs">
                表头可调整顺序，但不能新增、删除或重命名。
              </p>
            </div>
            <Input
              ref={fileInputRef}
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="max-w-80 bg-background"
              disabled={previewMutation.isPending || commitMutation.isPending}
              type="file"
              onChange={(event) => {
                handleFile(event.currentTarget.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
            {previewMutation.isPending && (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground text-sm">
                <LoaderCircleIcon className="size-4 animate-spin" />
                正在读取并校验…
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {rows && validation && (
        <>
          <Card size="sm">
            <CardHeader>
              <CardTitle>校验概览</CardTitle>
              <CardDescription>
                修改单元格或删除行后，系统会自动重新校验。
              </CardDescription>
              <CardAction>
                {isRevalidating ? (
                  <Badge variant="secondary">
                    <LoaderCircleIcon className="animate-spin" />
                    正在校验
                  </Badge>
                ) : validationIsCurrent ? (
                  <Badge variant="outline">
                    <CheckCircle2Icon />
                    已是最新结果
                  </Badge>
                ) : (
                  <Badge variant="secondary">等待校验</Badge>
                )}
              </CardAction>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <SummaryItem label="待导入" value={rows.length} />
                <SummaryItem
                  danger={validation.summary.errorCount > 0}
                  label="错误行 / 项"
                  value={`${validation.summary.errorRowCount} / ${validation.summary.errorCount}`}
                />
                <SummaryItem
                  warning={validation.summary.warningCount > 0}
                  label="警告行 / 项"
                  value={`${validation.summary.warningRowCount} / ${validation.summary.warningCount}`}
                />
                <SummaryItem
                  label="将新建团体"
                  value={validation.summary.newOrganizationCount}
                  warning={validation.summary.newOrganizationCount > 0}
                />
                <SummaryItem label="导入方式" value="只新增" />
              </div>

              {revalidationError ? (
                <Alert variant="destructive">
                  <TriangleAlertIcon />
                  <AlertTitle>重新校验失败</AlertTitle>
                  <AlertDescription>{revalidationError}</AlertDescription>
                  <Button
                    className="mt-2 w-fit"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const nextRevision = latestRevisionRef.current + 1;
                      latestRevisionRef.current = nextRevision;
                      setRevision(nextRevision);
                    }}
                  >
                    <RefreshCwIcon data-icon="inline-start" />
                    重试校验
                  </Button>
                </Alert>
              ) : validation.summary.errorCount > 0 ? (
                <Alert variant="destructive">
                  <TriangleAlertIcon />
                  <AlertTitle>存在错误，暂不能导入</AlertTitle>
                  <AlertDescription>
                    请直接修改标红单元格，或移除对应行，直到错误数归零。
                  </AlertDescription>
                </Alert>
              ) : validation.summary.warningCount > 0 ? (
                <Alert className="border-amber-500/40 bg-amber-500/5 text-amber-900">
                  <TriangleAlertIcon />
                  <AlertTitle>可以导入，但需要确认警告</AlertTitle>
                  <AlertDescription>
                    重复手机号、邮箱、姓名加团体以及自动新建团体不会阻止导入；提交前会再次确认。
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert>
                  <CheckCircle2Icon />
                  <AlertTitle>数据校验通过</AlertTitle>
                  <AlertDescription>
                    提交时还会重新校验一次，并以整批事务写入。
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {ISSUE_FILTERS.map((filter) => {
                const count =
                  filter.value === "all"
                    ? rows.length
                    : filter.value === "error"
                      ? validation.summary.errorRowCount
                      : validation.summary.warningRowCount;
                return (
                  <Button
                    key={filter.value}
                    aria-pressed={issueFilter === filter.value}
                    size="sm"
                    variant={
                      issueFilter === filter.value ? "secondary" : "outline"
                    }
                    onClick={() => {
                      setIssueFilter(filter.value);
                      setPage(1);
                    }}
                  >
                    {filter.label}
                    <span className="text-muted-foreground tabular-nums">
                      {count}
                    </span>
                  </Button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                disabled={
                  validation.summary.errorCount +
                    validation.summary.warningCount ===
                  0
                }
                size="sm"
                variant="outline"
                onClick={() => downloadMemberImportIssues(previewRows)}
              >
                <DownloadIcon data-icon="inline-start" />
                下载问题明细
              </Button>
              <Button
                disabled={!canImport}
                size="sm"
                onClick={() => setConfirmOpen(true)}
              >
                {commitMutation.isPending ? (
                  <LoaderCircleIcon
                    className="animate-spin"
                    data-icon="inline-start"
                  />
                ) : (
                  <UploadIcon data-icon="inline-start" />
                )}
                确认导入 {rows.length} 人
              </Button>
            </div>
          </div>

          {visibleRows.length > 0 ? (
            <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
              <ImportPreviewTable
                disabled={commitMutation.isPending}
                rows={visibleRows}
                onChange={handleCellChange}
                onRemove={handleRemoveRow}
              />
            </div>
          ) : (
            <div className="rounded-lg border border-dashed bg-muted/20 py-12 text-center text-muted-foreground text-sm">
              当前筛选下没有数据。
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-muted-foreground text-sm">
              第 {rangeStart}-{rangeEnd} 条 / 当前筛选共 {filteredRows.length}{" "}
              条
            </span>
            <div className="flex items-center gap-2">
              <Select
                items={PAGE_SIZE_OPTIONS.map((size) => ({
                  value: size,
                  label: `${size} 条/页`,
                }))}
                value={pageSize}
                onValueChange={(value) => {
                  setPageSize(Number(value));
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-28" size="sm">
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
                disabled={safePage <= 1}
                size="sm"
                variant="outline"
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                上一页
              </Button>
              <span className="min-w-16 text-center text-muted-foreground text-sm tabular-nums">
                {safePage} / {pageCount}
              </span>
              <Button
                disabled={safePage >= pageCount}
                size="sm"
                variant="outline"
                onClick={() =>
                  setPage((value) => Math.min(pageCount, value + 1))
                }
              >
                下一页
              </Button>
            </div>
          </div>
        </>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {validation?.summary.warningCount
                ? "确认忽略警告并整批导入？"
                : "确认整批导入人员？"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              将新增 {rows?.length ?? 0} 名人员
              {validation?.summary.newOrganizationCount
                ? `，同时自动新建 ${validation.summary.newOrganizationCount} 个团体`
                : ""}
              。不会修改系统中的已有人员；任意写入失败时，本批数据会全部回滚。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {validation && validation.newOrganizations.length > 0 && (
            <div className="max-h-32 overflow-y-auto rounded-md bg-muted p-3 text-sm">
              <p className="mb-1 font-medium">将自动新建：</p>
              <p className="text-muted-foreground">
                {validation.newOrganizations.join("、")}
              </p>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={commitMutation.isPending}>
              返回检查
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={!canImport || commitMutation.isPending}
              onClick={() => commitMutation.mutate()}
            >
              {commitMutation.isPending && (
                <LoaderCircleIcon
                  className="animate-spin"
                  data-icon="inline-start"
                />
              )}
              {validation?.summary.warningCount ? "确认并导入" : "确认导入"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>离开批量导入页面？</AlertDialogTitle>
            <AlertDialogDescription>
              当前预览和修改不会保存，离开后需要重新上传 Excel 文件。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => blocker.reset?.()}>
              继续检查
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => blocker.proceed?.()}
            >
              放弃并离开
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SummaryItem({
  label,
  value,
  danger = false,
  warning = false,
}: {
  label: string;
  value: string | number;
  danger?: boolean;
  warning?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-muted/20 px-4 py-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p
        className={cn(
          "mt-1 font-semibold text-xl tabular-nums",
          danger && "text-destructive",
          !danger && warning && "text-amber-700",
        )}
      >
        {value}
      </p>
    </div>
  );
}
