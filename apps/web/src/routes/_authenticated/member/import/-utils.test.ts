import { describe, expect, test } from "vitest";
import type { MemberImportPreviewRow } from "./-queries";
import { memberImportIssuesCsv } from "./-utils";

const previewRow = (
  overrides: Partial<MemberImportPreviewRow> = {},
): MemberImportPreviewRow => ({
  sourceRow: 2,
  name: "张三",
  gender: "男",
  companyPosition: "",
  organizationName: "示例团体",
  countryRegion: "中国",
  nativeProvince: "浙江省",
  nativeCity: "杭州市",
  idType: "",
  idNumber: "",
  mobile: "13800138000",
  phone: "",
  email: "",
  language: "中文",
  remark: "",
  issues: [],
  ...overrides,
});

describe("人员导入问题明细 CSV", () => {
  test("导出中文字段名、问题来源和 Excel 原始行号", () => {
    const csv = memberImportIssuesCsv([
      previewRow({
        sourceRow: 18,
        issues: [
          {
            severity: "warning",
            field: "organizationName",
            code: "duplicate_name_organization",
            source: "database",
            message: "系统中已有相同姓名和所属团体的人员",
          },
        ],
      }),
    ]);

    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"18","张三","警告","所属团体"');
    expect(csv).toContain('"系统已有数据"');
  });

  test("用户单元格以公式字符开头时加前缀，避免 Excel 执行公式", () => {
    const csv = memberImportIssuesCsv([
      previewRow({
        mobile: "=2+3",
        issues: [
          {
            severity: "error",
            field: "mobile",
            code: "field_validation",
            message: "请输入正确的手机号",
          },
        ],
      }),
    ]);

    expect(csv).toContain('"\'=2+3"');
    expect(csv).not.toContain(',"=2+3",');
  });
});
