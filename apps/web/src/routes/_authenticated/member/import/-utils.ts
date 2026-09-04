import type {
  MemberImportIssue,
  MemberImportPreviewRow,
  MemberImportRow,
} from "./-queries";

export type MemberImportField = Exclude<keyof MemberImportRow, "sourceRow">;

export const MEMBER_IMPORT_COLUMNS = [
  { key: "name", label: "姓名", className: "min-w-40" },
  { key: "gender", label: "性别", className: "min-w-28" },
  { key: "companyPosition", label: "职务", className: "min-w-52" },
  { key: "organizationName", label: "所属团体", className: "min-w-52" },
  { key: "countryRegion", label: "国别/地区", className: "min-w-40" },
  { key: "nativeProvince", label: "籍贯省", className: "min-w-36" },
  { key: "nativeCity", label: "籍贯市", className: "min-w-40" },
  { key: "idType", label: "证件类型", className: "min-w-60" },
  { key: "idNumber", label: "证件号码", className: "min-w-60" },
  { key: "mobile", label: "手机号", className: "min-w-44" },
  { key: "phone", label: "固定电话", className: "min-w-48" },
  { key: "email", label: "邮箱", className: "min-w-64" },
  { key: "language", label: "语种", className: "min-w-36" },
  { key: "remark", label: "备注", className: "min-w-72" },
] as const satisfies ReadonlyArray<{
  key: MemberImportField;
  label: string;
  className: string;
}>;

export const MEMBER_IMPORT_FIELD_LABELS = Object.fromEntries(
  MEMBER_IMPORT_COLUMNS.map((column) => [column.key, column.label]),
) as Record<MemberImportField, string>;

export const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

export const downloadBase64File = (
  contentBase64: string,
  mimeType: string,
  fileName: string,
) => {
  const binary = atob(contentBase64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  downloadBlob(new Blob([bytes], { type: mimeType }), fileName);
};

const issueValue = (row: MemberImportPreviewRow, issue: MemberImportIssue) =>
  issue.field === "_row" ? "" : row[issue.field];

/** 防止问题明细被 Excel 打开时把用户内容解释成公式。 */
const spreadsheetSafe = (value: string | number) => {
  const text = String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
};

const csvCell = (value: string | number) =>
  `"${spreadsheetSafe(value).replaceAll('"', '""')}"`;

export const memberImportIssuesCsv = (rows: MemberImportPreviewRow[]) => {
  const lines: Array<Array<string | number>> = [
    ["Excel 行号", "姓名", "级别", "字段", "当前值", "问题原因", "来源"],
  ];

  for (const row of rows) {
    for (const issue of row.issues) {
      lines.push([
        row.sourceRow,
        row.name,
        issue.severity === "error" ? "错误" : "警告",
        issue.field === "_row"
          ? "整行"
          : MEMBER_IMPORT_FIELD_LABELS[issue.field],
        issueValue(row, issue),
        issue.message,
        issue.source === "file"
          ? "当前 Excel"
          : issue.source === "database"
            ? "系统已有数据"
            : "字段校验",
      ]);
    }
  }

  return `\uFEFF${lines.map((line) => line.map(csvCell).join(",")).join("\r\n")}`;
};

export const downloadMemberImportIssues = (rows: MemberImportPreviewRow[]) => {
  const date = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date())
    .replaceAll("/", "");
  downloadBlob(
    new Blob([memberImportIssuesCsv(rows)], {
      type: "text/csv;charset=utf-8",
    }),
    `人员导入问题明细-${date}.csv`,
  );
};
