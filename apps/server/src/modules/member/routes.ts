import { and, asc, count, desc, eq, ilike, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../../infra/db";
import {
  findCity,
  findCountryRegion,
  findProvince,
} from "../../shared/dict/regions";
import { toLimitOffset } from "../../shared/pagination";
import { err, ok } from "../../shared/result";
import { jsonBody } from "../../shared/validate";
import { activitySegment } from "../agenda/schema";
import { type AuthedVariables, requireUser } from "../auth";
import { activity, project } from "../project/schema";
import {
  activityMember,
  type MemberIdType,
  member,
  projectMember,
  segmentMember,
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
  countryRegionCode: member.countryRegionCode,
  countryRegion: member.countryRegion,
  nativeProvinceCode: member.nativeProvinceCode,
  nativeProvince: member.nativeProvince,
  nativeCityCode: member.nativeCityCode,
  nativeCity: member.nativeCity,
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
 * 把客户端传来的字典码翻成名字快照。
 *
 * 客户端**只传码**，名字一律在这里派生——两样都收，迟早出现码是 US、名字是
 * "中国"的行。码已经过 validation 的白名单校验，查不到就是 null。
 */
const regionNames = (input: {
  countryRegionCode: string | null;
  nativeProvinceCode: string | null;
  nativeCityCode: string | null;
}) => ({
  countryRegion: findCountryRegion(input.countryRegionCode)?.name ?? null,
  nativeProvince: findProvince(input.nativeProvinceCode)?.name ?? null,
  nativeCity: findCity(input.nativeCityCode)?.name ?? null,
});

/**
 * 读取用的投影：多一个 activityCount。
 *
 * 这个数以前是 member 表上的一个物化列，现在改成相关子查询实时算。物化它要
 * 额外定义一整套回写时机（活动人员新增要不要加？活动下架算不算？移除回退
 * 吗？），文档一条都没定义，而现在这一列本来就恒为 0——趁关系表刚建，把它
 * 换成派生值最便宜。接口字段名保持不变，前端不用动。
 *
 * ⚠️ 关联条件必须写成 `eq(...)`，**不能**写回看着更直白的
 * `${activityMember.memberId} = ${member.id}`。drizzle 的 buildSelection 在
 * 单表查询（外层没有 join）下，会把 select 字段里顶层的 Column 片段统统降级成
 * 不带表名的裸列名，这句于是被渲染成 `where "member_id" = "id"`——在子查询里
 * 这两个名字都先匹配到 activity_member（它自己就有 id 列），关联整个断掉，
 * count 退化成一个与外层无关的常数（activity_member 里 id = member_id 的行数），
 * 结果就是每个人显示的活动数完全一样，没参加过活动的人也显示非零。
 * `eq()` 返回的是嵌套 SQL 片段，那层 map 不递归进去，列名因此保住
 * `"activity_member"."member_id" = "member"."id"` 的全限定形式。
 * 见 routes.test.ts 里钉住这条的用例——`export` 只是为了让那个用例拿到同一份
 * 投影，别的模块不要复用它。
 */
export const memberReadFields = {
  ...memberFields,
  activityCount: sql<number>`(
    select count(*)::int from ${activityMember}
    where ${eq(activityMember.memberId, member.id)}
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
  return (
    code === "23503" || (cause !== undefined && isForeignKeyViolation(cause))
  );
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

  /**
   * 人员详情里的"参与信息"：这个人进过哪些项目、在每个项目下参与了哪些活动。
   *
   * 驱动表是 project_member 而不是 activity_member。人可以进了项目还没被分到
   * 任何活动（项目人员导入完、活动还没建就是这个状态），那种项目照样要出现在
   * 列表里，只是活动表为空——按 activity_member 驱动会把这一整类项目漏掉，而
   * 它恰恰是运营最需要看见的"这个人还没安排活动"。
   *
   * 三层关系表当初就为这个方向留了索引（idx_project_member_member /
   * idx_activity_member_member / idx_segment_member_member），是按 memberId 正查。
   *
   * ⚠️ 没有分页，也没有数据范围过滤。前者是因为一个人的项目数在几十量级，
   * 分页要先定"按什么排、默认展开几个"，那是产品口径；后者是因为
   * 授权（docs/authorization.md）整体还没实施，全系统都还没有"只看我授权的
   * 项目"这个能力。等它落地，这个接口是必须回来加过滤的——人员主档是全局的，
   * 而这里返回的分组、来源、活动安排是项目内信息。
   */
  .post("/participation", jsonBody(MemberIdInput), async (c) => {
    const { id } = c.req.valid("json");

    const [projects, activities] = await Promise.all([
      db
        .select({
          projectId: project.id,
          projectName: project.name,
          location: project.location,
          startTime: project.startTime,
          endTime: project.endTime,
        })
        .from(projectMember)
        .innerJoin(project, eq(project.id, projectMember.projectId))
        .where(eq(projectMember.memberId, id))
        // 起止时间可空，`desc` 在 Postgres 下默认 nulls first，会把没填时间的
        // 项目顶到最前面。手写 nulls last 让"最近的项目在最上面"真的成立。
        .orderBy(sql`${project.startTime} desc nulls last`, desc(project.id)),

      db
        .select({
          activityMemberId: activityMember.id,
          projectId: activityMember.projectId,
          activityId: activity.id,
          activityName: activity.name,
          location: activity.location,
          startTime: activity.startTime,
          endTime: activity.endTime,
          groupName: activityMember.groupName,
          source: activityMember.source,

          /**
           * 参与环节取名字而不是计数：这一列是给人看"他在这场活动里干什么"的，
           * "3 个环节"回答不了。作废环节排除在外——参与关系还在（历史引用保留），
           * 但那个环节已经不发生了，列出来只会让人以为还有安排。
           *
           * 关联条件必须写 `eq(...)`，理由见 memberReadFields 上那段注释。
           */
          segmentNames: sql<string[]>`coalesce((
            select array_agg(${activitySegment.name} order by ${activitySegment.startTime})
            from ${segmentMember}
            join ${activitySegment} on ${eq(activitySegment.id, segmentMember.segmentId)}
            where ${eq(segmentMember.activityMemberId, activityMember.id)}
              and ${eq(activitySegment.status, "active")}
          ), '{}'::text[])`.as("segment_names"),
        })
        .from(activityMember)
        .innerJoin(activity, eq(activity.id, activityMember.activityId))
        .where(eq(activityMember.memberId, id))
        .orderBy(asc(activity.startTime), asc(activity.id)),
    ]);

    const byProject = new Map<number, typeof activities>();
    for (const row of activities) {
      const bucket = byProject.get(row.projectId);
      if (bucket) bucket.push(row);
      else byProject.set(row.projectId, [row]);
    }

    return c.json(
      ok({
        list: projects.map((row) => ({
          ...row,
          activities: byProject.get(row.projectId) ?? [],
        })),
      }),
    );
  })

  .post("/create", jsonBody(CreateMemberInput), async (c) => {
    const input = c.req.valid("json");
    if (await hasDuplicateIdDocument(input.idType, input.idNumber)) {
      return c.json(validationError("相同证件类型和证件号码的人员已存在"));
    }

    const userId = c.get("authedUser").id;
    const [row] = await db
      .insert(member)
      .values({
        ...input,
        ...regionNames(input),
        createdBy: userId,
        updatedBy: userId,
      })
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
      .set({
        ...input,
        ...regionNames(input),
        updatedBy: c.get("authedUser").id,
      })
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
          validationError(
            "该人员已被其他业务引用，不能删除；如需停用请改用禁用",
          ),
        );
      }
      throw error;
    }
  });
