import { and, count, desc, eq, ilike, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../../infra/db";
import { toLimitOffset } from "../../shared/pagination";
import { err, ok } from "../../shared/result";
import { jsonBody } from "../../shared/validate";
import { type AuthedVariables, requireUser } from "../auth";
import {
  activityMember,
  member,
  type MemberIdType,
  projectMember,
} from "./schema";
import {
  CreateMemberInput,
  ListMemberCandidatesInput,
  ListMembersInput,
  MemberIdInput,
  SetMemberStatusInput,
  UpdateMemberInput,
} from "./validation";

/** 主档自身的列。`returning()` 只能用这一份——相关子查询在 RETURNING 里非法。 */
const memberFields = {
  id: member.id,
  name: member.name,
  gender: member.gender,
  companyPosition: member.companyPosition,
  countryRegion: member.countryRegion,
  nativePlace: member.nativePlace,
  idType: member.idType,
  idNumber: member.idNumber,
  mobile: member.mobile,
  phone: member.phone,
  email: member.email,
  language: member.language,
  remark: member.remark,
  status: member.status,
  createdAt: member.createdAt,
  updatedAt: member.updatedAt,
};

/**
 * 读取用的投影：多一个 activityCount。
 *
 * 这个数以前是 member 表上的一个物化列，现在改成相关子查询实时算。物化它要
 * 额外定义一整套回写时机（活动人员新增要不要加？活动下架算不算？移除回退
 * 吗？），文档一条都没定义，而现在这一列本来就恒为 0——趁关系表刚建，把它
 * 换成派生值最便宜。接口字段名保持不变，前端不用动。
 */
const memberReadFields = {
  ...memberFields,
  activityCount: sql<number>`(
    select count(*)::int from ${activityMember}
    where ${activityMember.memberId} = ${member.id}
  )`.as("activity_count"),
};

const notFound = () =>
  err({ code: "NOT_FOUND" as const, message: "人员不存在" });

const validationError = (message: string) =>
  err({ code: "VALIDATION_ERROR" as const, message });

/**
 * 外键违反（Postgres 23503）。
 *
 * ⚠️ 必须连 `cause` 一起看：drizzle 0.45 把驱动抛出的 DatabaseError 包进
 * DrizzleQueryError，错误码在 `error.cause.code` 上，顶层的 `error.code` 是
 * undefined。只查顶层的话这个判断永远不成立，删一个被引用的人员会直接
 * 变成 500 而不是一句提示——这条是实测出来的，不是防御性写法。
 */
const isForeignKeyViolation = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;
  const { code, cause } = error as { code?: unknown; cause?: unknown };
  return code === "23503" || (cause !== undefined && isForeignKeyViolation(cause));
};

/**
 * BR-DEV-028 的唯一性是**证件类型 + 证件号码**的组合，不是号码单独唯一。
 * 之前这里只比 idNumber，会把"护照 A1234567"和"其他证件 A1234567"判成重复。
 *
 * 数据库侧已经有 uk_member_id_document 这条 partial unique index 兜底了，这次
 * 查询留着是为了把约束违反变成一句人话——索引负责保证撞不了，这里负责好好说。
 */
async function hasDuplicateIdDocument(
  idType: MemberIdType | null | undefined,
  idNumber: string | null | undefined,
  excludeId?: number,
) {
  if (!idType || !idNumber) return false;

  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .where(
      and(
        eq(member.idType, idType),
        eq(member.idNumber, idNumber),
        excludeId === undefined ? undefined : ne(member.id, excludeId),
      ),
    )
    .limit(1);

  return Boolean(row);
}

export const memberRoutes = new Hono<{ Variables: AuthedVariables }>()
  .use(requireUser)

  .post("/list", jsonBody(ListMembersInput), async (c) => {
    const { name, companyPosition, status, page, pageSize } =
      c.req.valid("json");
    const where = and(
      name ? ilike(member.name, `%${name}%`) : undefined,
      companyPosition
        ? ilike(member.companyPosition, `%${companyPosition}%`)
        : undefined,
      status ? eq(member.status, status) : undefined,
    );
    const { limit, offset } = toLimitOffset({ page, pageSize });

    const [list, totalRows] = await Promise.all([
      db
        .select(memberReadFields)
        .from(member)
        .where(where)
        .orderBy(desc(member.id))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(member).where(where),
    ]);

    return c.json(ok({ list, total: totalRows[0]?.total ?? 0 }));
  })

  /**
   * 选择器的数据源。三个 scope 走三条不同的 from/join，但**返回同一种行**，
   * 前端的选择器因此不用按 scope 分支渲染。
   *
   * 一律只返回启用的人：规则 7 说禁用后不能再新增关系，选出来也会被 ladder
   * 挡回去，不如一开始就不给选。
   */
  .post("/candidates", jsonBody(ListMemberCandidatesInput), async (c) => {
    const { scope, projectId, activityId, name, page, pageSize } =
      c.req.valid("json");

    const fields = {
      id: member.id,
      name: member.name,
      companyPosition: member.companyPosition,
      mobile: member.mobile,
    };

    const nameFilter = name ? ilike(member.name, `%${name}%`) : undefined;
    const enabled = eq(member.status, "enabled");
    const { limit, offset } = toLimitOffset({ page, pageSize });

    // 三个分支各自建查询而不是拼一个可变的 builder：drizzle 的链式类型在
    // 条件 join 下会散架，而且三条 SQL 摆在一起比一堆 if 更好读。
    const [list, totalRows] = await (() => {
      if (scope === "project") {
        const where = and(
          eq(projectMember.projectId, projectId ?? 0),
          enabled,
          nameFilter,
        );
        return Promise.all([
          db
            .select(fields)
            .from(projectMember)
            .innerJoin(member, eq(member.id, projectMember.memberId))
            .where(where)
            .orderBy(desc(member.id))
            .limit(limit)
            .offset(offset),
          db
            .select({ total: count() })
            .from(projectMember)
            .innerJoin(member, eq(member.id, projectMember.memberId))
            .where(where),
        ]);
      }

      if (scope === "activity") {
        const where = and(
          eq(activityMember.activityId, activityId ?? 0),
          enabled,
          nameFilter,
        );
        return Promise.all([
          db
            .select(fields)
            .from(activityMember)
            .innerJoin(member, eq(member.id, activityMember.memberId))
            .where(where)
            .orderBy(desc(member.id))
            .limit(limit)
            .offset(offset),
          db
            .select({ total: count() })
            .from(activityMember)
            .innerJoin(member, eq(member.id, activityMember.memberId))
            .where(where),
        ]);
      }

      const where = and(enabled, nameFilter);
      return Promise.all([
        db
          .select(fields)
          .from(member)
          .where(where)
          .orderBy(desc(member.id))
          .limit(limit)
          .offset(offset),
        db.select({ total: count() }).from(member).where(where),
      ]);
    })();

    return c.json(ok({ list, total: totalRows[0]?.total ?? 0 }));
  })

  .post("/get", jsonBody(MemberIdInput), async (c) => {
    const [row] = await db
      .select(memberReadFields)
      .from(member)
      .where(eq(member.id, c.req.valid("json").id));

    return row ? c.json(ok(row)) : c.json(notFound());
  })

  .post("/create", jsonBody(CreateMemberInput), async (c) => {
    const input = c.req.valid("json");
    if (await hasDuplicateIdDocument(input.idType, input.idNumber)) {
      return c.json(validationError("相同证件类型和证件号码的人员已存在"));
    }

    const userId = c.get("authedUser").id;
    const [row] = await db
      .insert(member)
      .values({ ...input, createdBy: userId, updatedBy: userId })
      .returning(memberFields);

    return c.json(ok(row));
  })

  .post("/update", jsonBody(UpdateMemberInput), async (c) => {
    const { id, ...input } = c.req.valid("json");
    if (await hasDuplicateIdDocument(input.idType, input.idNumber, id)) {
      return c.json(validationError("相同证件类型和证件号码的人员已存在"));
    }

    const [row] = await db
      .update(member)
      .set({ ...input, updatedBy: c.get("authedUser").id })
      .where(eq(member.id, id))
      .returning(memberFields);

    return row ? c.json(ok(row)) : c.json(notFound());
  })

  .post("/setStatus", jsonBody(SetMemberStatusInput), async (c) => {
    const { id, status } = c.req.valid("json");
    const [row] = await db
      .update(member)
      .set({ status, updatedBy: c.get("authedUser").id })
      .where(eq(member.id, id))
      .returning(memberFields);

    return row ? c.json(ok(row)) : c.json(notFound());
  })

  /**
   * 物理删除，只对"建错了、还没用过"的行有意义。
   *
   * BR-DEV-021/029：已被引用的人员不物理删除，主档只禁用。关系表那三条外键
   * 会真的拦住这次删除，所以这里先查一次把拦截翻译成人话——只查 project_member
   * 就够了：活动关系必有项目关系、环节关系必有活动关系（复合外键保证），
   * 项目关系为空就等于三层都为空。
   */
  .post("/delete", jsonBody(MemberIdInput), async (c) => {
    const id = c.req.valid("json").id;

    const [related] = await db
      .select({ total: count() })
      .from(projectMember)
      .where(eq(projectMember.memberId, id));

    if ((related?.total ?? 0) > 0) {
      return c.json(
        validationError(
          `该人员已加入 ${related?.total} 个项目，不能删除；如需停用请改用禁用`,
        ),
      );
    }

    try {
      const [row] = await db
        .delete(member)
        .where(eq(member.id, id))
        .returning({ id: member.id });

      return row ? c.json(ok(row)) : c.json(notFound());
    } catch (error) {
      // 上面那次预查只覆盖了人员关系。邀请函记录也直接引用 member，将来还会有
      // 排位、资源绑定——与其每加一张表就往预查里补一条，不如把外键违反
      // （Postgres 23503）统一翻成业务失败：新模块加了外键也不会变成 500。
      if (isForeignKeyViolation(error)) {
        return c.json(
          validationError("该人员已被其他业务引用，不能删除；如需停用请改用禁用"),
        );
      }
      throw error;
    }
  });
