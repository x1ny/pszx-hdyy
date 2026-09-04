import { describe, expect, test } from "bun:test";
import {
  buildMemberImportPlan,
  MEMBER_IMPORT_MAX_ROWS,
  type MemberImportContext,
  type MemberImportRow,
  ValidateMemberImportInput,
} from "./import-validation";

const row = (
  sourceRow: number,
  patch: Partial<Omit<MemberImportRow, "sourceRow">> = {},
): MemberImportRow => ({
  sourceRow,
  name: "张三",
  gender: "",
  companyPosition: "",
  organizationName: "",
  countryRegion: "",
  nativeProvince: "",
  nativeCity: "",
  idType: "",
  idNumber: "",
  mobile: "",
  phone: "",
  email: "",
  language: "",
  remark: "",
  ...patch,
});

const emptyContext: MemberImportContext = {
  organizations: [],
  members: [],
};

const issuesFor = (
  rows: MemberImportRow[],
  context: MemberImportContext = emptyContext,
) => buildMemberImportPlan(rows, context).validation.rows;

describe("人员导入字段校验", () => {
  test("裁剪文本并把中文地区解析成现有主档使用的字典码", () => {
    const plan = buildMemberImportPlan(
      [
        row(2, {
          name: "  张三  ",
          organizationName: "  商会  ",
          countryRegion: "  中国  ",
          nativeProvince: "  浙江省  ",
          nativeCity: "  杭州市  ",
        }),
      ],
      { organizations: [{ id: 7, name: "商会" }], members: [] },
    );

    expect(plan.validation.summary.errorCount).toBe(0);
    expect(plan.validation.rows[0]).toMatchObject({
      name: "张三",
      organizationName: "商会",
      countryRegion: "中国",
    });
    expect(plan.preparedRows[0]?.values).toMatchObject({
      countryRegionCode: "CN",
      nativeProvinceCode: "330000",
      nativeCityCode: "330100",
      organizationId: 7,
    });
  });

  test("证件类型和号码必须成对填写", () => {
    const onlyType = issuesFor([row(2, { idType: "身份证" })])[0]?.issues;
    const onlyNumber = issuesFor([
      row(2, { idNumber: "330102199001011234" }),
    ])[0]?.issues;

    expect(onlyType).toContainEqual(
      expect.objectContaining({
        severity: "error",
        field: "idNumber",
        message: "请填写证件号码",
      }),
    );
    expect(onlyNumber).toContainEqual(
      expect.objectContaining({
        severity: "error",
        field: "idType",
        message: "请先选择证件类型",
      }),
    );
  });

  test("完全复用人员新增的格式与地区交叉校验", () => {
    const issues = issuesFor([
      row(2, {
        mobile: "123",
        email: "not-an-email",
        countryRegion: "美国",
        nativeProvince: "浙江省",
      }),
    ])[0]?.issues;

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "mobile", severity: "error" }),
        expect.objectContaining({ field: "email", severity: "error" }),
        expect.objectContaining({
          field: "nativeProvince",
          severity: "error",
          message: "外籍无需填写籍贯",
        }),
      ]),
    );
  });

  test("非法枚举值返回中文字段错误", () => {
    const issues = issuesFor([
      row(2, { gender: "未知", idType: "工作证", idNumber: "ABC001" }),
    ])[0]?.issues;

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "gender", message: "性别不正确" }),
        expect.objectContaining({
          field: "idType",
          message: "证件类型不正确",
        }),
      ]),
    );
  });

  test("不存在的团体是警告并进入自动创建候选，不阻断导入", () => {
    const plan = buildMemberImportPlan(
      [row(2, { organizationName: " 新团体 " })],
      emptyContext,
    );

    expect(plan.validation.summary).toMatchObject({
      errorCount: 0,
      warningCount: 1,
      newOrganizationCount: 1,
    });
    expect(plan.validation.newOrganizations).toEqual(["新团体"]);
    expect(plan.validation.rows[0]?.issues).toContainEqual(
      expect.objectContaining({
        field: "organizationName",
        code: "create_organization",
      }),
    );
  });
});

describe("人员导入重复判定", () => {
  test("文件内和数据库中的重复证件都是阻断错误", () => {
    const duplicate = {
      idType: "身份证",
      idNumber: "330102199001011234",
    };
    const context: MemberImportContext = {
      organizations: [],
      members: [
        {
          id: 8,
          name: "系统人员",
          organizationId: null,
          idType: duplicate.idType,
          idNumber: duplicate.idNumber,
          mobile: null,
          email: null,
        },
      ],
    };
    const validation = buildMemberImportPlan(
      [row(2, duplicate), row(3, { ...duplicate, name: "李四" })],
      context,
    ).validation;

    expect(validation.summary.errorRowCount).toBe(2);
    for (const current of validation.rows) {
      expect(current.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "duplicate_id_document",
            source: "file",
            severity: "error",
          }),
          expect.objectContaining({
            code: "duplicate_id_document",
            source: "database",
            severity: "error",
          }),
        ]),
      );
    }
  });

  test("手机号、邮箱、姓名加团体重复只警告并标明来源", () => {
    const common = {
      organizationName: "商会",
      mobile: "13800138000",
      email: "same@example.com",
    };
    const context: MemberImportContext = {
      organizations: [{ id: 7, name: "商会" }],
      members: [
        {
          id: 8,
          name: "张三",
          organizationId: 7,
          idType: null,
          idNumber: null,
          mobile: common.mobile,
          email: common.email,
        },
      ],
    };
    const validation = buildMemberImportPlan(
      [row(2, common), row(3, common)],
      context,
    ).validation;

    expect(validation.summary.errorCount).toBe(0);
    expect(validation.summary.warningRowCount).toBe(2);
    expect(validation.rows[0]?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "duplicate_mobile", source: "file" }),
        expect.objectContaining({
          code: "duplicate_mobile",
          source: "database",
        }),
        expect.objectContaining({ code: "duplicate_email", source: "file" }),
        expect.objectContaining({
          code: "duplicate_name_organization",
          source: "database",
        }),
      ]),
    );
  });

  test("姓名相同但团体为空时不按姓名单独警告", () => {
    const validation = buildMemberImportPlan(
      [row(2), row(3)],
      emptyContext,
    ).validation;

    expect(validation.summary.warningCount).toBe(0);
  });
});

describe("人员导入请求边界", () => {
  test("最多接收 2000 行且至少保留一行", () => {
    expect(ValidateMemberImportInput.safeParse({ rows: [] }).success).toBe(
      false,
    );
    expect(
      ValidateMemberImportInput.safeParse({
        rows: Array.from({ length: MEMBER_IMPORT_MAX_ROWS }, (_, index) =>
          row(index + 2),
        ),
      }).success,
    ).toBe(true);
    expect(
      ValidateMemberImportInput.safeParse({
        rows: Array.from({ length: MEMBER_IMPORT_MAX_ROWS + 1 }, (_, index) =>
          row(index + 2),
        ),
      }).success,
    ).toBe(false);
  });
});
