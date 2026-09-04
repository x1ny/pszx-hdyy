import { inArray, or, type SQL } from "drizzle-orm";
import { db } from "../../infra/db";
import { organization } from "../organization/schema";
import {
  buildMemberImportPlan,
  type MemberImportContext,
  type MemberImportRow,
} from "./import-validation";
import { member } from "./schema";
import { memberRegionNames } from "./values";

const uniqueValues = (values: readonly string[]) => [
  ...new Set(values.filter(Boolean)),
];

/** 只读取本批可能命中的主档，避免为了 2,000 行预检扫描整个人员库。 */
async function loadMemberImportContext(
  rows: readonly MemberImportRow[],
): Promise<MemberImportContext> {
  const organizationNames = uniqueValues(
    rows.map((row) => row.organizationName.trim()),
  );
  const idNumbers = uniqueValues(rows.map((row) => row.idNumber.trim()));
  const mobiles = uniqueValues(rows.map((row) => row.mobile.trim()));
  const emails = uniqueValues(rows.map((row) => row.email.trim()));
  const names = uniqueValues(rows.map((row) => row.name.trim()));

  const memberConditions: SQL[] = [];
  if (idNumbers.length > 0) {
    memberConditions.push(inArray(member.idNumber, idNumbers));
  }
  if (mobiles.length > 0) {
    memberConditions.push(inArray(member.mobile, mobiles));
  }
  if (emails.length > 0) {
    memberConditions.push(inArray(member.email, emails));
  }
  if (names.length > 0) {
    memberConditions.push(inArray(member.name, names));
  }

  const [organizations, members] = await Promise.all([
    organizationNames.length > 0
      ? db
          .select({ id: organization.id, name: organization.name })
          .from(organization)
          .where(inArray(organization.name, organizationNames))
      : Promise.resolve([]),
    memberConditions.length > 0
      ? db
          .select({
            id: member.id,
            name: member.name,
            organizationId: member.organizationId,
            idType: member.idType,
            idNumber: member.idNumber,
            mobile: member.mobile,
            email: member.email,
          })
          .from(member)
          .where(or(...memberConditions))
      : Promise.resolve([]),
  ]);

  return { organizations, members };
}

/** 上传预览与编辑后重校验共用的权威校验入口。 */
export async function validateMemberImportRows(
  rows: readonly MemberImportRow[],
) {
  const context = await loadMemberImportContext(rows);
  return buildMemberImportPlan(rows, context).validation;
}

export class MemberImportCommitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemberImportCommitError";
  }
}

/**
 * 最终提交前重新校验，并把自动建团体与所有人员写入放进同一事务。
 * 任意一行或一个团体失败都会由数据库事务整体回滚。
 */
export async function commitMemberImport(
  rows: readonly MemberImportRow[],
  userId: string,
  acknowledgeWarnings: boolean,
) {
  const context = await loadMemberImportContext(rows);
  const plan = buildMemberImportPlan(rows, context);
  if (plan.validation.summary.errorCount > 0) {
    throw new MemberImportCommitError("仍有错误未处理，请重新校验后再导入");
  }
  if (plan.validation.summary.warningCount > 0 && !acknowledgeWarnings) {
    throw new MemberImportCommitError("存在警告，请确认后再导入");
  }
  if (plan.preparedRows.length !== rows.length) {
    throw new MemberImportCommitError("导入数据校验不完整，请重新校验");
  }

  return db.transaction(async (tx) => {
    const newOrganizationNames = plan.validation.newOrganizations;
    const createdOrganizations =
      newOrganizationNames.length > 0
        ? await tx
            .insert(organization)
            .values(
              newOrganizationNames.map((name) => ({
                name,
                remark: null,
                createdBy: userId,
                updatedBy: userId,
              })),
            )
            // 预检和提交之间可能有人创建同名团体；复用并发创建的记录即可。
            .onConflictDoNothing({ target: organization.name })
            .returning({ id: organization.id, name: organization.name })
        : [];

    const referencedOrganizationNames = uniqueValues(
      plan.preparedRows
        .map((row) => row.organizationName ?? "")
        .filter(Boolean),
    );
    const resolvedOrganizations =
      referencedOrganizationNames.length > 0
        ? await tx
            .select({ id: organization.id, name: organization.name })
            .from(organization)
            .where(inArray(organization.name, referencedOrganizationNames))
        : [];
    const organizationIdByName = new Map(
      resolvedOrganizations.map((row) => [row.name, row.id]),
    );
    if (organizationIdByName.size !== referencedOrganizationNames.length) {
      throw new MemberImportCommitError("所属团体解析失败，请重新校验");
    }

    const values = plan.preparedRows.map((row) => {
      const resolved = {
        ...row.values,
        organizationId: row.organizationName
          ? (organizationIdByName.get(row.organizationName) ?? null)
          : null,
      };
      return {
        ...resolved,
        ...memberRegionNames(resolved),
        createdBy: userId,
        updatedBy: userId,
      };
    });

    await tx.insert(member).values(values);

    return {
      importedCount: values.length,
      createdOrganizationCount: createdOrganizations.length,
      createdOrganizations: createdOrganizations.map((row) => row.name),
    };
  });
}

/** Drizzle 把驱动错误包在 cause 里，递归读取才能拿到 Postgres 错误码。 */
export const hasMemberImportDatabaseCode = (
  error: unknown,
  expectedCode: string,
): boolean => {
  if (typeof error !== "object" || error === null) return false;
  const { code, cause } = error as { code?: unknown; cause?: unknown };
  return (
    code === expectedCode ||
    (cause !== undefined && hasMemberImportDatabaseCode(cause, expectedCode))
  );
};
