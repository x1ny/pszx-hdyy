import { CITIES, COUNTRY_REGIONS, PROVINCES } from "@repo/server/dict";
import { CircleAlertIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import { Button } from "#/shared/components/ui/button.tsx";
import { Input } from "#/shared/components/ui/input.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/shared/components/ui/table.tsx";
import { cn } from "#/shared/lib/utils.ts";
import type { MemberImportPreviewRow } from "../-queries";
import { MEMBER_IMPORT_COLUMNS, type MemberImportField } from "../-utils";

type ImportPreviewTableProps = {
  rows: MemberImportPreviewRow[];
  disabled: boolean;
  onChange: (
    sourceRow: number,
    field: MemberImportField,
    value: string,
  ) => void;
  onRemove: (sourceRow: number) => void;
};

const fieldListIds: Partial<Record<MemberImportField, string>> = {
  gender: "member-import-genders",
  countryRegion: "member-import-countries",
  nativeProvince: "member-import-provinces",
  nativeCity: "member-import-cities",
  idType: "member-import-id-types",
};

const GENDERS = ["男", "女"];
const ID_TYPES = [
  "身份证",
  "护照",
  "港澳居民来往内地通行证",
  "台湾居民来往大陆通行证",
  "其他",
];

export function ImportPreviewTable({
  rows,
  disabled,
  onChange,
  onRemove,
}: ImportPreviewTableProps) {
  return (
    <>
      <Table className="min-w-[2380px]">
        <TableHeader className="bg-muted/80">
          <TableRow className="hover:bg-transparent">
            <TableHead className="sticky left-0 z-20 w-24 bg-muted text-center">
              Excel 行
            </TableHead>
            {MEMBER_IMPORT_COLUMNS.map((column) => (
              <TableHead key={column.key} className={column.className}>
                {column.label}
                {column.key === "name" && (
                  <span className="ml-0.5 text-destructive">*</span>
                )}
              </TableHead>
            ))}
            <TableHead className="sticky right-0 z-20 w-20 bg-muted text-center">
              操作
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const rowErrors = row.issues.filter(
              (issue) => issue.severity === "error",
            );
            const rowWarnings = row.issues.filter(
              (issue) => issue.severity === "warning",
            );
            const rowIssues = row.issues.filter(
              (issue) => issue.field === "_row",
            );

            return (
              <TableRow
                key={row.sourceRow}
                className={cn(
                  rowErrors.length > 0 && "bg-destructive/[0.025]",
                  rowErrors.length === 0 &&
                    rowWarnings.length > 0 &&
                    "bg-amber-500/[0.035]",
                )}
              >
                <TableCell className="sticky left-0 z-10 bg-card text-center align-top shadow-[1px_0_0_var(--border)]">
                  <div className="pt-2 font-medium tabular-nums">
                    {row.sourceRow}
                  </div>
                  {(rowErrors.length > 0 || rowWarnings.length > 0) && (
                    <div className="mt-1 flex justify-center gap-1">
                      {rowErrors.length > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-destructive text-xs">
                          <CircleAlertIcon className="size-3" />
                          {rowErrors.length}
                        </span>
                      )}
                      {rowWarnings.length > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-amber-700 text-xs">
                          <TriangleAlertIcon className="size-3" />
                          {rowWarnings.length}
                        </span>
                      )}
                    </div>
                  )}
                  {rowIssues.map((issue) => (
                    <p
                      key={`${issue.code}-${issue.message}`}
                      className={cn(
                        "mt-1 max-w-24 whitespace-normal text-left text-xs leading-4",
                        issue.severity === "error"
                          ? "text-destructive"
                          : "text-amber-700",
                      )}
                    >
                      {issue.message}
                    </p>
                  ))}
                </TableCell>
                {MEMBER_IMPORT_COLUMNS.map((column) => {
                  const issues = row.issues.filter(
                    (issue) => issue.field === column.key,
                  );
                  const hasError = issues.some(
                    (issue) => issue.severity === "error",
                  );
                  const hasWarning = issues.some(
                    (issue) => issue.severity === "warning",
                  );

                  return (
                    <TableCell
                      key={column.key}
                      className="align-top whitespace-normal"
                    >
                      <Input
                        aria-label={`Excel 第 ${row.sourceRow} 行${column.label}`}
                        aria-invalid={hasError || undefined}
                        className={cn(
                          "h-8 bg-background",
                          hasWarning &&
                            !hasError &&
                            "border-amber-500/70 focus-visible:border-amber-500 focus-visible:ring-amber-500/20",
                        )}
                        disabled={disabled}
                        list={fieldListIds[column.key]}
                        value={row[column.key]}
                        onChange={(event) =>
                          onChange(
                            row.sourceRow,
                            column.key,
                            event.target.value,
                          )
                        }
                      />
                      {issues.map((issue) => (
                        <p
                          key={`${issue.severity}-${issue.code}-${issue.source ?? "validation"}`}
                          className={cn(
                            "mt-1 flex gap-1 text-xs leading-4",
                            issue.severity === "error"
                              ? "text-destructive"
                              : "text-amber-700",
                          )}
                        >
                          {issue.severity === "error" ? (
                            <CircleAlertIcon className="mt-0.5 size-3 shrink-0" />
                          ) : (
                            <TriangleAlertIcon className="mt-0.5 size-3 shrink-0" />
                          )}
                          <span>{issue.message}</span>
                        </p>
                      ))}
                    </TableCell>
                  );
                })}
                <TableCell className="sticky right-0 z-10 bg-card text-center align-top shadow-[-1px_0_0_var(--border)]">
                  <Button
                    aria-label={`删除 Excel 第 ${row.sourceRow} 行`}
                    className="text-destructive hover:text-destructive"
                    disabled={disabled}
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => onRemove(row.sourceRow)}
                  >
                    <Trash2Icon />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <datalist id="member-import-genders">
        {GENDERS.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
      <datalist id="member-import-id-types">
        {ID_TYPES.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
      <datalist id="member-import-countries">
        {COUNTRY_REGIONS.map((item) => (
          <option key={item.code} value={item.name} />
        ))}
      </datalist>
      <datalist id="member-import-provinces">
        {PROVINCES.map((item) => (
          <option key={item.code} value={item.name} />
        ))}
      </datalist>
      <datalist id="member-import-cities">
        {CITIES.map((item) => (
          <option key={`${item.provinceCode}-${item.code}`} value={item.name} />
        ))}
      </datalist>
    </>
  );
}
