import ExcelJS from "exceljs";
import { CITIES, COUNTRY_REGIONS, PROVINCES } from "../../shared/dict/regions";
import {
  MEMBER_IMPORT_COLUMNS,
  MEMBER_IMPORT_MAX_ROWS,
  MEMBER_IMPORT_SHEET_NAME,
  type MemberImportField,
  type MemberImportRow,
} from "./import-validation";
import { MEMBER_GENDERS, MEMBER_ID_TYPES } from "./schema";

export const MEMBER_IMPORT_TEMPLATE_FILE_NAME = "人员导入模板.xlsx";
export const XLSX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export class MemberImportWorkbookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemberImportWorkbookError";
  }
}

const columnNotes = {
  name: "必填，最多 64 个字符。",
  gender: "选填，只能从下拉列表中选择。",
  companyPosition: "选填，最多 255 个字符。",
  organizationName: "选填。系统中不存在时会提示，并在确认导入后自动创建团体。",
  countryRegion: "选填，填写“数据字典”工作表中的标准中文名称。",
  nativeProvince: "选填，仅中国籍人员填写标准省级名称。",
  nativeCity: "选填，必须属于所填省份；直辖市和港澳台无需填写。",
  idType: "与证件号码同时填写或同时留空，只能从下拉列表中选择。",
  idNumber: "与证件类型同时填写或同时留空；本列已设置为文本格式。",
  mobile: "选填，中国大陆 11 位手机号；本列已设置为文本格式。",
  phone: "选填，如 010-12345678；本列已设置为文本格式。",
  email: "选填，最多 128 个字符。",
  language: "选填，最多 32 个字符。",
  remark: "选填，最多 2000 个字符。",
} as const satisfies Record<MemberImportField, string>;

const applyListValidation = (
  worksheet: ExcelJS.Worksheet,
  columnNumber: number,
  values: readonly string[],
) => {
  const formula = `"${values.join(",")}"`;
  for (
    let rowNumber = 2;
    rowNumber <= MEMBER_IMPORT_MAX_ROWS + 1;
    rowNumber++
  ) {
    worksheet.getCell(rowNumber, columnNumber).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [formula],
      showErrorMessage: true,
      errorStyle: "stop",
      errorTitle: "值不在允许范围内",
      error: "请从下拉列表中选择标准值",
      showInputMessage: true,
      promptTitle: "请选择标准值",
      prompt: values.join("、"),
    };
  }
};

/** 生成带填写说明、文本格式和枚举下拉的固定人员导入模板。 */
export async function createMemberImportTemplate(): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "活动运营管理平台";
  workbook.created = new Date();
  workbook.modified = new Date();

  const worksheet = workbook.addWorksheet(MEMBER_IMPORT_SHEET_NAME, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  worksheet.columns = MEMBER_IMPORT_COLUMNS.map((column) => ({
    key: column.key,
    header: column.header,
    width: column.width,
    style: { numFmt: "@" },
  }));
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: MEMBER_IMPORT_COLUMNS.length },
  };

  const headerRow = worksheet.getRow(1);
  headerRow.height = 28;
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF2563EB" },
  };
  headerRow.eachCell((cell, columnNumber) => {
    const column = MEMBER_IMPORT_COLUMNS[columnNumber - 1];
    if (!column) return;
    cell.note = columnNotes[column.key];
  });

  const genderColumn =
    MEMBER_IMPORT_COLUMNS.findIndex((column) => column.key === "gender") + 1;
  const idTypeColumn =
    MEMBER_IMPORT_COLUMNS.findIndex((column) => column.key === "idType") + 1;
  applyListValidation(worksheet, genderColumn, MEMBER_GENDERS);
  applyListValidation(worksheet, idTypeColumn, MEMBER_ID_TYPES);

  const instructions = workbook.addWorksheet("填写说明");
  instructions.columns = [{ width: 18 }, { width: 90 }];
  instructions.addRows([
    ["项目", "说明"],
    [
      "使用方式",
      "请在“人员导入”工作表中填写数据，不要修改表头名称。列顺序可以调整。",
    ],
    [
      "数据范围",
      `每个文件最多 ${MEMBER_IMPORT_MAX_ROWS} 行人员数据，空白行会被忽略。`,
    ],
    ["必填字段", "只有姓名必填；证件类型和证件号码必须同时填写或同时留空。"],
    [
      "文本字段",
      "证件号码、手机号、固定电话均按文本处理，请勿改为数值或科学计数法。",
    ],
    [
      "地区字段",
      "国别/地区、籍贯省、籍贯市请使用“数据字典”工作表中的标准中文名称。",
    ],
    ["所属团体", "系统中不存在的团体会在预览中提示，确认导入后自动创建。"],
    [
      "重复规则",
      "相同证件类型和证件号码属于错误；手机号、邮箱、姓名与团体相同只提示警告。",
    ],
  ]);
  instructions.getRow(1).font = { bold: true };
  instructions.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFDCEAFE" },
  };
  instructions.eachRow((row) => {
    row.alignment = { vertical: "top", wrapText: true };
  });

  const dictionary = workbook.addWorksheet("数据字典", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  dictionary.columns = [
    { header: "类别", key: "category", width: 18 },
    { header: "标准中文名称", key: "name", width: 32 },
    { header: "所属省份", key: "province", width: 24 },
  ];
  const provinceNames = new Map(
    PROVINCES.map((province) => [province.code, province.name]),
  );
  dictionary.addRows([
    ...COUNTRY_REGIONS.map((item) => ({
      category: "国别/地区",
      name: item.name,
      province: "",
    })),
    ...PROVINCES.map((item) => ({
      category: "籍贯省",
      name: item.name,
      province: "",
    })),
    ...CITIES.map((item) => ({
      category: "籍贯市",
      name: item.name,
      province: provinceNames.get(item.provinceCode) ?? "",
    })),
  ]);
  const dictionaryHeader = dictionary.getRow(1);
  dictionaryHeader.font = { bold: true, color: { argb: "FFFFFFFF" } };
  dictionaryHeader.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF475569" },
  };
  dictionary.autoFilter = "A1:C1";

  return (await workbook.xlsx.writeBuffer()) as unknown as Uint8Array;
}

const cellText = (cell: ExcelJS.Cell) => cell.text.trim();

/** 解析固定模板；只读取“人员导入”工作表，列由表头名称识别而非固定位置。 */
export async function parseMemberImportWorkbook(
  file: File,
): Promise<MemberImportRow[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    const content = Buffer.from(await file.arrayBuffer());
    await workbook.xlsx.load(
      content as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
  } catch {
    throw new MemberImportWorkbookError(
      "无法读取该文件，请确认它是未加密且未损坏的 .xlsx 文件",
    );
  }

  const worksheet = workbook.getWorksheet(MEMBER_IMPORT_SHEET_NAME);
  if (!worksheet) {
    throw new MemberImportWorkbookError(
      `找不到“${MEMBER_IMPORT_SHEET_NAME}”工作表，请使用系统下载的模板`,
    );
  }

  const expectedByHeader = new Map<string, MemberImportField>(
    MEMBER_IMPORT_COLUMNS.map((column) => [column.header, column.key]),
  );
  const columnByField = new Map<MemberImportField, number>();
  const unknownHeaders: string[] = [];

  for (
    let columnNumber = 1;
    columnNumber <= worksheet.columnCount;
    columnNumber++
  ) {
    const header = cellText(worksheet.getCell(1, columnNumber));
    if (!header) continue;
    const field = expectedByHeader.get(header);
    if (!field) {
      unknownHeaders.push(header);
      continue;
    }
    if (columnByField.has(field)) {
      throw new MemberImportWorkbookError(`表头“${header}”重复`);
    }
    columnByField.set(field, columnNumber);
  }

  if (unknownHeaders.length > 0) {
    throw new MemberImportWorkbookError(
      `存在未知表头：${unknownHeaders.join("、")}，请使用系统下载的模板`,
    );
  }

  const missingHeaders = MEMBER_IMPORT_COLUMNS.filter(
    (column) => !columnByField.has(column.key),
  ).map((column) => column.header);
  if (missingHeaders.length > 0) {
    throw new MemberImportWorkbookError(
      `缺少表头：${missingHeaders.join("、")}，请使用系统下载的模板`,
    );
  }

  const rows: MemberImportRow[] = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = Object.fromEntries(
      MEMBER_IMPORT_COLUMNS.map((column) => [
        column.key,
        cellText(row.getCell(columnByField.get(column.key) as number)),
      ]),
    ) as Record<MemberImportField, string>;
    if (MEMBER_IMPORT_COLUMNS.every((column) => !values[column.key])) return;
    rows.push({ sourceRow: rowNumber, ...values });
  });

  if (rows.length === 0) {
    throw new MemberImportWorkbookError("Excel 中没有可导入的人员数据");
  }
  if (rows.length > MEMBER_IMPORT_MAX_ROWS) {
    throw new MemberImportWorkbookError(
      `一次最多导入 ${MEMBER_IMPORT_MAX_ROWS} 人，当前文件有 ${rows.length} 行数据`,
    );
  }

  return rows;
}
