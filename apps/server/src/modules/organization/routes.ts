import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  notInArray,
  sql,
} from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../../infra/db";
import { toLimitOffset } from "../../shared/pagination";
import { err, ok } from "../../shared/result";
import { jsonBody } from "../../shared/validate";
import { type AuthedVariables, requireUser } from "../auth";
import {
  activityMember,
  member,
  projectMember,
  segmentMember,
} from "../member/schema";
import { organization } from "./schema";
import {
  CreateOrganizationInput,
  ListOrganizationsInput,
  OrganizationIdInput,
  UpdateOrganizationInput,
} from "./validation";

/** 主档自身的公开字段；审计用户 id 不是浏览器需要的 API 契约。 */
const organizationFields = {
  id: organization.id,
  name: organization.name,
  remark: organization.remark,
  createdAt: organization.createdAt,
  updatedAt: organization.updatedAt,
};

/**
 * 列表额外带当前成员数。实时相关子查询避免维护一列很容易写漏的物化计数。
 * `eq()` 让 Drizzle 保留两边的表名前缀，不能改成裸 SQL 模板插值。
 */
export const organizationListFields = {
  ...organizationFields,
  memberCount: sql<number>`(
    select count(*)::int from ${member}
    where ${eq(member.organizationId, organization.id)}
  )`.as("member_count"),
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const notFound = () =>
  err({ code: "NOT_FOUND" as const, message: "团体不存在" });

const validationError = (message: string) =>
  err({ code: "VALIDATION_ERROR" as const, message });

/** 在事务内抛出会自动回滚；路由层再把它翻译成业务错误。 */
class OrganizationValidationError extends Error {}

const fail = (message: string): never => {
  throw new OrganizationValidationError(message);
};

/**
 * Drizzle 会把驱动异常包在 `cause` 里，递归读才能可靠识别 Postgres 错误码。
 */
const hasDatabaseCode = (error: unknown, expectedCode: string): boolean => {
  if (typeof error !== "object" || error === null) return false;
  const { code, cause } = error as { code?: unknown; cause?: unknown };
  return (
    code === expectedCode ||
    (cause !== undefined && hasDatabaseCode(cause, expectedCode))
  );
};

/**
 * 保存的成员集合必须全部存在，不能让无效 id 因为 UPDATE 影响零行而静默丢失。
 */
async function assertSelectedMembersExist(
  tx: Tx,
  memberIds: readonly number[],
) {
  if (memberIds.length === 0) return;

  const [row] = await tx
    .select({ total: count() })
    .from(member)
    .where(inArray(member.id, [...memberIds]));

  if ((row?.total ?? 0) !== memberIds.length) {
    fail("选中的成员中有已不存在的记录，请刷新后重试");
  }
}

/**
 * 用完整成员集合同步当前所属团体。
 *
 * 先把选中的成员移动到目标团体，再解除目标团体内未被选中的成员。顺序不能反：
 * 一名成员从别的团体移入时，后一步只按当前团体 + not in memberIds 清理，不会
 * 误解绑刚选中的人。整个过程只改 `member.organizationId`，绝不改项目/活动/环节
 * 的组织范围快照或任何 `groupName` 历史分组。
 */
async function syncMembers(
  tx: Tx,
  organizationId: number,
  memberIds: readonly number[],
  userId: string,
) {
  await assertSelectedMembersExist(tx, memberIds);

  if (memberIds.length > 0) {
    await tx
      .update(member)
      .set({ organizationId, updatedBy: userId })
      .where(inArray(member.id, [...memberIds]));
  }

  await tx
    .update(member)
    .set({ organizationId: null, updatedBy: userId })
    .where(
      and(
        eq(member.organizationId, organizationId),
        memberIds.length > 0
          ? notInArray(member.id, [...memberIds])
          : undefined,
      ),
    );
}

export const organizationRoutes = new Hono<{ Variables: AuthedVariables }>()
  .use(requireUser)

  /** 按团体名称筛选的分页列表，成员数按当前主档关系实时计算。 */
  .post("/list", jsonBody(ListOrganizationsInput), async (c) => {
    const { name, page, pageSize } = c.req.valid("json");
    const where = name ? ilike(organization.name, `%${name}%`) : undefined;
    const { limit, offset } = toLimitOffset({ page, pageSize });

    const [list, totalRows] = await Promise.all([
      db
        .select(organizationListFields)
        .from(organization)
        .where(where)
        // id 不会因编辑改变，列表行和翻页顺序因此稳定。
        .orderBy(desc(organization.id))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(organization).where(where),
    ]);

    return c.json(ok({ list, total: totalRows[0]?.total ?? 0 }));
  })

  /** 团体详情带当前成员完整 id 集合，供编辑器回填。 */
  .post("/get", jsonBody(OrganizationIdInput), async (c) => {
    const { id } = c.req.valid("json");
    const [row] = await db
      .select(organizationFields)
      .from(organization)
      .where(eq(organization.id, id));

    if (!row) return c.json(notFound());

    const members = await db
      .select({ id: member.id })
      .from(member)
      .where(eq(member.organizationId, id))
      .orderBy(asc(member.id));

    return c.json(ok({ ...row, memberIds: members.map((item) => item.id) }));
  })

  /** 仅供下拉选择的轻量团体选项，不返回成员数、备注或审计时间。 */
  .post("/options", async (c) => {
    const list = await db
      .select({ id: organization.id, name: organization.name })
      .from(organization)
      .orderBy(asc(organization.name), asc(organization.id));

    return c.json(ok(list));
  })

  /** 新建团体并在同一事务内写入其完整成员集合。 */
  .post("/create", jsonBody(CreateOrganizationInput), async (c) => {
    const input = c.req.valid("json");
    const userId = c.get("authedUser").id;

    try {
      const row = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(organization)
          .values({
            name: input.name,
            remark: input.remark,
            createdBy: userId,
            updatedBy: userId,
          })
          .returning(organizationFields);

        if (!created) fail("创建团体失败，请重试");
        await syncMembers(tx, created.id, input.memberIds, userId);
        return created;
      });

      return c.json(ok(row));
    } catch (error) {
      if (error instanceof OrganizationValidationError) {
        return c.json(validationError(error.message));
      }
      if (hasDatabaseCode(error, "23505")) {
        return c.json(validationError("团体名称已存在"));
      }
      if (hasDatabaseCode(error, "23503")) {
        return c.json(validationError("选中的成员关联数据无效，请刷新后重试"));
      }
      throw error;
    }
  })

  /** 修改团体资料并以客户端传来的完整成员集合覆盖当前成员归属。 */
  .post("/update", jsonBody(UpdateOrganizationInput), async (c) => {
    const { id, ...input } = c.req.valid("json");
    const userId = c.get("authedUser").id;

    try {
      const row = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(organization)
          .set({
            name: input.name,
            remark: input.remark,
            updatedBy: userId,
          })
          .where(eq(organization.id, id))
          .returning(organizationFields);

        if (!updated) return null;
        await syncMembers(tx, id, input.memberIds, userId);
        return updated;
      });

      return row ? c.json(ok(row)) : c.json(notFound());
    } catch (error) {
      if (error instanceof OrganizationValidationError) {
        return c.json(validationError(error.message));
      }
      if (hasDatabaseCode(error, "23505")) {
        return c.json(validationError("团体名称已存在"));
      }
      if (hasDatabaseCode(error, "23503")) {
        return c.json(validationError("选中的成员关联数据无效，请刷新后重试"));
      }
      throw error;
    }
  })

  /**
   * 仅删除当前没有成员和范围快照引用的团体。
   *
   * 范围快照是业务历史，主档成员改组不能改它；反过来，快照也必须阻止主档
   * 被删除，不能以级联或静默置空来破坏历史可追溯性。
   */
  .post("/delete", jsonBody(OrganizationIdInput), async (c) => {
    const { id } = c.req.valid("json");

    const [
      [currentMembers],
      [projectReferences],
      [activityReferences],
      [segmentReferences],
    ] = await Promise.all([
      db
        .select({ total: count() })
        .from(member)
        .where(eq(member.organizationId, id)),
      db
        .select({ total: count() })
        .from(projectMember)
        .where(eq(projectMember.organizationId, id)),
      db
        .select({ total: count() })
        .from(activityMember)
        .where(eq(activityMember.organizationId, id)),
      db
        .select({ total: count() })
        .from(segmentMember)
        .where(eq(segmentMember.organizationId, id)),
    ]);

    const reasons = [
      currentMembers?.total
        ? `当前仍有 ${currentMembers.total} 名成员`
        : undefined,
      projectReferences?.total
        ? `项目人员范围快照有 ${projectReferences.total} 条引用`
        : undefined,
      activityReferences?.total
        ? `活动人员范围快照有 ${activityReferences.total} 条引用`
        : undefined,
      segmentReferences?.total
        ? `环节人员范围快照有 ${segmentReferences.total} 条引用`
        : undefined,
    ].filter((reason): reason is string => Boolean(reason));

    if (reasons.length > 0) {
      return c.json(
        validationError(
          `该团体${reasons.join("；")}，不能删除；请先解除相关引用`,
        ),
      );
    }

    try {
      const [row] = await db
        .delete(organization)
        .where(eq(organization.id, id))
        .returning({ id: organization.id });

      return row ? c.json(ok(row)) : c.json(notFound());
    } catch (error) {
      // 查询与删除之间可能有并发写入；外键是最终兜底，不能让它变成 500。
      if (hasDatabaseCode(error, "23503")) {
        return c.json(
          validationError(
            "该团体已被其他业务数据引用，不能删除；请先解除相关引用",
          ),
        );
      }
      throw error;
    }
  });
