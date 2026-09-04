import { z } from "zod";
import { CITIES, COUNTRY_REGIONS, PROVINCES } from "../../shared/dict/regions";
import { CreateMemberInput } from "./validation";

export const MEMBER_IMPORT_MAX_ROWS = 2_000;
export const MEMBER_IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MEMBER_IMPORT_SHEET_NAME = "人员导入";

export const MEMBER_IMPORT_COLUMNS = [
  { key: "name", header: "姓名", width: 14 },
  { key: "gender", header: "性别", width: 10 },
  { key: "companyPosition", header: "职务", width: 24 },
  { key: "organizationName", header: "所属团体", width: 24 },
  { key: "countryRegion", header: "国别/地区", width: 16 },
  { key: "nativeProvince", header: "籍贯省", width: 14 },
  { key: "nativeCity", header: "籍贯市", width: 16 },
  { key: "idType", header: "证件类型", width: 28 },
  { key: "idNumber", header: "证件号码", width: 24 },
  { key: "mobile", header: "手机号", width: 16 },
  { key: "phone", header: "固定电话", width: 18 },
  { key: "email", header: "邮箱", width: 26 },
  { key: "language", header: "语种", width: 14 },
  { key: "remark", header: "备注", width: 32 },
] as const;

export type MemberImportField = (typeof MEMBER_IMPORT_COLUMNS)[number]["key"];

const boundedText = z.string().max(10_000, "单元格内容过长");

export const MemberImportRowInput = z.object({
  sourceRow: z.number().int().positive().max(1_048_576),
  name: boundedText,
  gender: boundedText,
  companyPosition: boundedText,
  organizationName: boundedText,
  countryRegion: boundedText,
  nativeProvince: boundedText,
  nativeCity: boundedText,
  idType: boundedText,
  idNumber: boundedText,
  mobile: boundedText,
  phone: boundedText,
  email: boundedText,
  language: boundedText,
  remark: boundedText,
});

export const ValidateMemberImportInput = z.object({
  rows: z
    .array(MemberImportRowInput)
    .min(1, "至少保留一行人员数据")
    .max(MEMBER_IMPORT_MAX_ROWS, `一次最多导入 ${MEMBER_IMPORT_MAX_ROWS} 人`),
});

export const CommitMemberImportInput = ValidateMemberImportInput.extend({
  acknowledgeWarnings: z.boolean(),
});

export const PreviewMemberImportInput = z.object({
  file: z
    .file({ error: "请选择要导入的 Excel 文件" })
    .min(1, { error: "不能上传空文件" })
    .max(MEMBER_IMPORT_MAX_FILE_BYTES, {
      error: `Excel 文件大小不能超过 ${MEMBER_IMPORT_MAX_FILE_BYTES / 1024 / 1024} MB`,
    })
    .refine((file) => file.name.toLowerCase().endsWith(".xlsx"), {
      error: "只支持 .xlsx 文件",
    }),
});

export type MemberImportRow = z.infer<typeof MemberImportRowInput>;

export type MemberImportIssue = {
  severity: "error" | "warning";
  field: MemberImportField | "_row";
  code:
    | "field_validation"
    | "duplicate_id_document"
    | "duplicate_mobile"
    | "duplicate_email"
    | "duplicate_name_organization"
    | "create_organization";
  source?: "file" | "database";
  message: string;
};

export type ExistingMemberImportMatch = {
  id: number;
  name: string;
  organizationId: number | null;
  idType: string | null;
  idNumber: string | null;
  mobile: string | null;
  email: string | null;
};

export type MemberImportContext = {
  organizations: ReadonlyArray<{ id: number; name: string }>;
  members: ReadonlyArray<ExistingMemberImportMatch>;
};

export type MemberImportValidationResult = {
  rows: Array<MemberImportRow & { issues: MemberImportIssue[] }>;
  summary: {
    total: number;
    errorCount: number;
    errorRowCount: number;
    warningCount: number;
    warningRowCount: number;
    newOrganizationCount: number;
  };
  newOrganizations: string[];
};

type ParsedMemberInput = z.output<typeof CreateMemberInput>;

export type PreparedMemberImportRow = {
  sourceRow: number;
  organizationName: string | null;
  values: ParsedMemberInput;
};

export type MemberImportPlan = {
  validation: MemberImportValidationResult;
  preparedRows: PreparedMemberImportRow[];
};

const importFields = MEMBER_IMPORT_COLUMNS.map((column) => column.key);
const countryByName = new Map(
  COUNTRY_REGIONS.map((item) => [item.name, item.code]),
);
const provinceByName = new Map(PROVINCES.map((item) => [item.name, item.code]));
const cityByProvinceAndName = new Map(
  CITIES.map((item) => [
    JSON.stringify([item.provinceCode, item.name]),
    item.code,
  ]),
);

const internalToImportField = {
  name: "name",
  gender: "gender",
  organizationId: "organizationName",
  countryRegionCode: "countryRegion",
  nativeProvinceCode: "nativeProvince",
  nativeCityCode: "nativeCity",
  companyPosition: "companyPosition",
  idType: "idType",
  idNumber: "idNumber",
  mobile: "mobile",
  phone: "phone",
  email: "email",
  language: "language",
  remark: "remark",
} as const satisfies Partial<Record<string, MemberImportField>>;

const normalizeRow = (row: MemberImportRow): MemberImportRow => {
  const normalized = { ...row };
  for (const field of importFields) normalized[field] = row[field].trim();
  return normalized;
};

const lookupCode = (value: string, values: ReadonlyMap<string, string>) => {
  // CreateMemberInput 的公开契约用空字符串表达“未填写”，再统一 transform 成 null。
  if (!value) return "";
  return values.get(value) ?? "__INVALID_IMPORT_VALUE__";
};

const duplicateKey = (...values: string[]) => JSON.stringify(values);

const countKeys = (
  rows: readonly MemberImportRow[],
  keyOf: (row: MemberImportRow) => string | null,
) => {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

const addIssue = (issues: MemberImportIssue[], issue: MemberImportIssue) => {
  const duplicate = issues.some(
    (current) =>
      current.severity === issue.severity &&
      current.field === issue.field &&
      current.code === issue.code &&
      current.source === issue.source,
  );
  if (!duplicate) issues.push(issue);
};

const hasFieldError = (
  issues: readonly MemberImportIssue[],
  ...fields: MemberImportField[]
) =>
  issues.some(
    (issue) =>
      issue.severity === "error" &&
      fields.includes(issue.field as MemberImportField),
  );

/**
 * 同一套纯函数同时服务上传预检、编辑后重校验和最终提交前复核。
 * 数据库查询在外层完成后作为 context 传入，单元测试无需连接数据库。
 */
export function buildMemberImportPlan(
  inputRows: readonly MemberImportRow[],
  context: MemberImportContext,
): MemberImportPlan {
  const rows = inputRows.map(normalizeRow);
  const organizationByName = new Map(
    context.organizations.map((item) => [item.name, item]),
  );
  const idDocumentCounts = countKeys(rows, (row) =>
    row.idType && row.idNumber ? duplicateKey(row.idType, row.idNumber) : null,
  );
  const mobileCounts = countKeys(rows, (row) => row.mobile || null);
  const emailCounts = countKeys(rows, (row) => row.email || null);
  const nameOrganizationCounts = countKeys(rows, (row) =>
    row.name && row.organizationName
      ? duplicateKey(row.name, row.organizationName)
      : null,
  );

  const preparedRows: PreparedMemberImportRow[] = [];
  const validatedRows = rows.map((row) => {
    const issues: MemberImportIssue[] = [];
    const organizationRow = organizationByName.get(row.organizationName);
    const countryRegionCode = lookupCode(row.countryRegion, countryByName);
    const nativeProvinceCode = lookupCode(row.nativeProvince, provinceByName);
    const nativeCityCode = row.nativeCity
      ? nativeProvinceCode && nativeProvinceCode !== "__INVALID_IMPORT_VALUE__"
        ? (cityByProvinceAndName.get(
            duplicateKey(nativeProvinceCode, row.nativeCity),
          ) ?? "__INVALID_IMPORT_VALUE__")
        : "__INVALID_IMPORT_VALUE__"
      : "";

    if (row.organizationName.length > 255) {
      addIssue(issues, {
        severity: "error",
        field: "organizationName",
        code: "field_validation",
        message: "所属团体过长",
      });
    }

    const parsed = CreateMemberInput.safeParse({
      name: row.name,
      status: "enabled",
      gender: row.gender,
      organizationId: organizationRow?.id ?? null,
      countryRegionCode,
      nativeProvinceCode,
      nativeCityCode,
      companyPosition: row.companyPosition,
      idType: row.idType,
      idNumber: row.idNumber,
      mobile: row.mobile,
      phone: row.phone,
      email: row.email,
      language: row.language,
      remark: row.remark,
    });

    if (parsed.success) {
      preparedRows.push({
        sourceRow: row.sourceRow,
        organizationName: row.organizationName || null,
        values: parsed.data,
      });
    } else {
      for (const issue of parsed.error.issues) {
        const internalField = String(issue.path[0] ?? "");
        addIssue(issues, {
          severity: "error",
          field:
            internalToImportField[
              internalField as keyof typeof internalToImportField
            ] ?? "_row",
          code: "field_validation",
          message: issue.message,
        });
      }
    }

    if (
      row.organizationName &&
      row.organizationName.length <= 255 &&
      !organizationRow
    ) {
      addIssue(issues, {
        severity: "warning",
        field: "organizationName",
        code: "create_organization",
        message: "团体不存在，确认导入后将自动创建",
      });
    }

    const idDocumentKey =
      row.idType && row.idNumber
        ? duplicateKey(row.idType, row.idNumber)
        : null;
    if (idDocumentKey && !hasFieldError(issues, "idType", "idNumber")) {
      if ((idDocumentCounts.get(idDocumentKey) ?? 0) > 1) {
        addIssue(issues, {
          severity: "error",
          field: "idNumber",
          code: "duplicate_id_document",
          source: "file",
          message: "当前 Excel 内存在相同证件类型和证件号码",
        });
      }
      if (
        context.members.some(
          (item) =>
            item.idType === row.idType && item.idNumber === row.idNumber,
        )
      ) {
        addIssue(issues, {
          severity: "error",
          field: "idNumber",
          code: "duplicate_id_document",
          source: "database",
          message: "系统中已存在相同证件类型和证件号码的人员",
        });
      }
    }

    if (row.mobile && !hasFieldError(issues, "mobile")) {
      if ((mobileCounts.get(row.mobile) ?? 0) > 1) {
        addIssue(issues, {
          severity: "warning",
          field: "mobile",
          code: "duplicate_mobile",
          source: "file",
          message: "当前 Excel 内还有相同手机号",
        });
      }
      if (context.members.some((item) => item.mobile === row.mobile)) {
        addIssue(issues, {
          severity: "warning",
          field: "mobile",
          code: "duplicate_mobile",
          source: "database",
          message: "系统中已有相同手机号的人员",
        });
      }
    }

    if (row.email && !hasFieldError(issues, "email")) {
      if ((emailCounts.get(row.email) ?? 0) > 1) {
        addIssue(issues, {
          severity: "warning",
          field: "email",
          code: "duplicate_email",
          source: "file",
          message: "当前 Excel 内还有相同邮箱",
        });
      }
      if (context.members.some((item) => item.email === row.email)) {
        addIssue(issues, {
          severity: "warning",
          field: "email",
          code: "duplicate_email",
          source: "database",
          message: "系统中已有相同邮箱的人员",
        });
      }
    }

    const nameOrganizationKey =
      row.name && row.organizationName
        ? duplicateKey(row.name, row.organizationName)
        : null;
    if (
      nameOrganizationKey &&
      !hasFieldError(issues, "name", "organizationName")
    ) {
      if ((nameOrganizationCounts.get(nameOrganizationKey) ?? 0) > 1) {
        addIssue(issues, {
          severity: "warning",
          field: "organizationName",
          code: "duplicate_name_organization",
          source: "file",
          message: "当前 Excel 内还有相同姓名和所属团体",
        });
      }
      if (
        organizationRow &&
        context.members.some(
          (item) =>
            item.name === row.name &&
            item.organizationId === organizationRow.id,
        )
      ) {
        addIssue(issues, {
          severity: "warning",
          field: "organizationName",
          code: "duplicate_name_organization",
          source: "database",
          message: "系统中已有相同姓名和所属团体的人员",
        });
      }
    }

    return { ...row, issues };
  });

  const errorCount = validatedRows.reduce(
    (total, row) =>
      total + row.issues.filter((issue) => issue.severity === "error").length,
    0,
  );
  const warningCount = validatedRows.reduce(
    (total, row) =>
      total + row.issues.filter((issue) => issue.severity === "warning").length,
    0,
  );
  const newOrganizations = [
    ...new Set(
      rows
        .map((row) => row.organizationName)
        .filter(
          (name) =>
            Boolean(name) &&
            name.length <= 255 &&
            !organizationByName.has(name),
        ),
    ),
  ];

  return {
    validation: {
      rows: validatedRows,
      summary: {
        total: rows.length,
        errorCount,
        errorRowCount: validatedRows.filter((row) =>
          row.issues.some((issue) => issue.severity === "error"),
        ).length,
        warningCount,
        warningRowCount: validatedRows.filter((row) =>
          row.issues.some((issue) => issue.severity === "warning"),
        ).length,
        newOrganizationCount: newOrganizations.length,
      },
      newOrganizations,
    },
    preparedRows,
  };
}
