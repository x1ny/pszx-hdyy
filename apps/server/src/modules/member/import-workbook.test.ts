import { describe, expect, test } from "bun:test";
import ExcelJS from "exceljs";
import {
  MEMBER_IMPORT_COLUMNS,
  MEMBER_IMPORT_SHEET_NAME,
} from "./import-validation";
import {
  createMemberImportTemplate,
  MemberImportWorkbookError,
  parseMemberImportWorkbook,
  XLSX_MIME_TYPE,
} from "./import-workbook";

const loadWorkbook = async (content: Uint8Array) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    Buffer.from(content) as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  return workbook;
};

const toFile = async (workbook: ExcelJS.Workbook, name = "人员.xlsx") => {
  const content = (await workbook.xlsx.writeBuffer()) as unknown as Uint8Array;
  return new File([content], name, { type: XLSX_MIME_TYPE });
};

describe("人员导入模板", () => {
  test("包含固定表头、填写说明、数据字典、文本格式和枚举下拉", async () => {
    const workbook = await loadWorkbook(await createMemberImportTemplate());
    const worksheet = workbook.getWorksheet(MEMBER_IMPORT_SHEET_NAME);

    expect(worksheet).toBeDefined();
    expect(workbook.getWorksheet("填写说明")).toBeDefined();
    expect(workbook.getWorksheet("数据字典")).toBeDefined();
    expect(
      MEMBER_IMPORT_COLUMNS.map(
        (_, index) => worksheet?.getCell(1, index + 1).text,
      ),
    ).toEqual(MEMBER_IMPORT_COLUMNS.map((column) => column.header));

    const genderColumn =
      MEMBER_IMPORT_COLUMNS.findIndex((column) => column.key === "gender") + 1;
    const idNumberColumn =
      MEMBER_IMPORT_COLUMNS.findIndex((column) => column.key === "idNumber") +
      1;
    expect(worksheet?.getCell(2, genderColumn).dataValidation).toMatchObject({
      type: "list",
      allowBlank: true,
    });
    expect(worksheet?.getColumn(idNumberColumn).numFmt).toBe("@");
  });
});

describe("人员 Excel 解析", () => {
  test("按表头名称识别调整过顺序的列，并保留文本前导零", async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(MEMBER_IMPORT_SHEET_NAME);
    const reversed = [...MEMBER_IMPORT_COLUMNS].reverse();
    worksheet.addRow(reversed.map((column) => column.header));
    const values = {
      name: "张三",
      gender: "男",
      companyPosition: "会长",
      organizationName: "商会",
      countryRegion: "中国",
      nativeProvince: "浙江省",
      nativeCity: "杭州市",
      idType: "其他",
      idNumber: "0012345",
      mobile: "13800138000",
      phone: "010-12345678",
      email: "zhang@example.com",
      language: "中文",
      remark: "测试",
    };
    worksheet.addRow(reversed.map((column) => values[column.key]));

    const rows = await parseMemberImportWorkbook(await toFile(workbook));

    expect(rows).toEqual([{ sourceRow: 2, ...values }]);
  });

  test("未知或缺失表头会明确拒绝", async () => {
    const unknownWorkbook = new ExcelJS.Workbook();
    const unknownSheet = unknownWorkbook.addWorksheet(MEMBER_IMPORT_SHEET_NAME);
    unknownSheet.addRow([
      ...MEMBER_IMPORT_COLUMNS.map((column) => column.header),
      "自定义列",
    ]);

    await expect(
      parseMemberImportWorkbook(await toFile(unknownWorkbook)),
    ).rejects.toThrow("存在未知表头：自定义列");

    const missingWorkbook = new ExcelJS.Workbook();
    const missingSheet = missingWorkbook.addWorksheet(MEMBER_IMPORT_SHEET_NAME);
    missingSheet.addRow(
      MEMBER_IMPORT_COLUMNS.filter((column) => column.key !== "email").map(
        (column) => column.header,
      ),
    );

    await expect(
      parseMemberImportWorkbook(await toFile(missingWorkbook)),
    ).rejects.toThrow("缺少表头：邮箱");
  });

  test("损坏文件和空模板给出业务可读错误", async () => {
    await expect(
      parseMemberImportWorkbook(
        new File(["not xlsx"], "bad.xlsx", { type: XLSX_MIME_TYPE }),
      ),
    ).rejects.toBeInstanceOf(MemberImportWorkbookError);

    const template = await createMemberImportTemplate();
    await expect(
      parseMemberImportWorkbook(
        new File([template], "empty.xlsx", { type: XLSX_MIME_TYPE }),
      ),
    ).rejects.toThrow("Excel 中没有可导入的人员数据");
  });
});
