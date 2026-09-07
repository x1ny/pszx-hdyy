import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  isNull,
  lte,
  sql,
} from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../../infra/db";
import { getH5BaseUrl } from "../../infra/h5-url";
import { toLimitOffset } from "../../shared/pagination";
import { err, ok } from "../../shared/result";
import { jsonBody } from "../../shared/validate";
import { activitySegment } from "../agenda/schema";
import { type AuthedVariables, requireUser } from "../auth";
import { deleteActivityCascade } from "./activity-delete";
import { activity, project } from "./schema";
import { createItineraryShareToken } from "./share-token";
import {
  ActivityIdInput,
  CreateActivityInput,
  CreateProjectInput,
  ListActivitiesInput,
  ListProjectsInput,
  ProjectIdInput,
  SetActivityDisplayEnabledInput,
  SetActivityPublishStatusInput,
  SetActivityRegistrationEnabledInput,
  SetProjectPublishStatusInput,
  UpdateActivityInput,
  UpdateProjectInput,
} from "./validation";

/**
 * 接口返回的列显式列出，不用 `select().from(project)`——加一列不会顺带
 * 改掉 API 契约，也不会把 createdBy/updatedBy 这种前端用不着的用户 id
 * 顺手发到浏览器。
 */
const projectFields = {
  id: project.id,
  name: project.name,
  location: project.location,
  startTime: project.startTime,
  endTime: project.endTime,
  totalBudget: project.totalBudget,
  hostOrg: project.hostOrg,
  organizerOrg: project.organizerOrg,
  supportOrg: project.supportOrg,
  guidingOrg: project.guidingOrg,
  description: project.description,
  publishStatus: project.publishStatus,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
};

/** 列表读取投影：活动数是派生值，不物化到 project 表。 */
const projectListFields = {
  ...projectFields,
  activityCount: count(activity.id),
};

const activityFields = {
  id: activity.id,
  projectId: activity.projectId,
  activityType: activity.activityType,
  name: activity.name,
  location: activity.location,
  startTime: activity.startTime,
  endTime: activity.endTime,
  totalBudget: activity.totalBudget,
  hostOrg: activity.hostOrg,
  organizerOrg: activity.organizerOrg,
  supportOrg: activity.supportOrg,
  guidingOrg: activity.guidingOrg,
  description: activity.description,
  publishStatus: activity.publishStatus,
  displayEnabled: activity.displayEnabled,
  registrationEnabled: activity.registrationEnabled,
  createdAt: activity.createdAt,
  updatedAt: activity.updatedAt,
};

/**
 * 活动列表的读取投影，比 /get 多一个 segmentCount，也和它一样带 projectName。
 *
 * projectName 原先只在 /get 上，理由是"列表永远从项目详情点进来，项目名就在
 * 标题里"。一级菜单「活动管理」跨项目看全部活动之后这条不成立了——那一屏上
 * "属于哪个项目"是真的缺失信息。项目详情页的活动列表不渲染这一列，多查一个
 * 名字换掉两条列表接口的分歧，划算。
 *
 * segmentCount 走相关子查询而不是 left join + group by：group by 得把上面
 * activityFields 的每一列都抄进去（项目列表那边就是这么写的，18 行），以后加
 * 一个字段就得记得同步一次。只统计 active 环节——作废在议程模块里等同于已删除。
 */
const activityListFields = {
  ...activityFields,
  projectName: sql<string>`(
    select ${project.name} from ${project}
    where ${eq(project.id, activity.projectId)}
  )`.as("project_name"),
  segmentCount: sql<number>`(
    select count(*)::int from ${activitySegment}
    where ${eq(activitySegment.activityId, activity.id)}
      and ${eq(activitySegment.status, "active")}
  )`.as("segment_count"),
};

const projectNotFound = () =>
  err({ code: "NOT_FOUND" as const, message: "项目不存在" });

const validationError = (message: string) =>
  err({ code: "VALIDATION_ERROR" as const, message });

/** Drizzle 可能把 Postgres 的外键错误包在 cause 里，需要递归检查。 */
const isForeignKeyViolation = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;
  const { code, cause } = error as { code?: unknown; cause?: unknown };
  return (
    code === "23503" || (cause !== undefined && isForeignKeyViolation(cause))
  );
};

/** Drizzle 可能把 Postgres 的唯一约束错误包在 cause 里，需要递归检查。 */
const isUniqueViolation = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;
  const { code, cause } = error as { code?: unknown; cause?: unknown };
  return code === "23505" || (cause !== undefined && isUniqueViolation(cause));
};

const activityNotFound = () =>
  err({ code: "NOT_FOUND" as const, message: "活动不存在" });

/**
 * 返回已有分享 token，或仅在首次分享时原子地写入一个新的。
 *
 * 不用「读到 null 就直接 update」：两个管理员同时点分享时，后到的请求会被
 * `isNull` 条件挡住，再读到先到请求写下的同一个 token。唯一索引处理极低概率
 * 的跨活动碰撞；单条 SQL 失败不会污染后续重试。
 */
async function getOrCreateItineraryShareToken(
  activityId: number,
  userId: string,
): Promise<string | null> {
  const [existing] = await db
    .select({ token: activity.itineraryShareToken })
    .from(activity)
    .where(eq(activity.id, activityId));

  if (!existing) return null;
  if (existing.token) return existing.token;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const [created] = await db
        .update(activity)
        .set({
          itineraryShareToken: createItineraryShareToken(),
          updatedBy: userId,
        })
        .where(
          and(
            eq(activity.id, activityId),
            isNull(activity.itineraryShareToken),
          ),
        )
        .returning({ token: activity.itineraryShareToken });

      if (created?.token) return created.token;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }

    // 没有更新到通常意味着并发请求已先写入；每条语句使用新的 Read Committed
    // 快照，因此这里能读到对方已经提交的稳定 token。
    const [raced] = await db
      .select({ token: activity.itineraryShareToken })
      .from(activity)
      .where(eq(activity.id, activityId));

    if (!raced) return null;
    if (raced.token) return raced.token;
  }

  throw new Error("生成行程分享链接失败，请重试");
}

// 项目平台的日期筛选按中国大陆业务时区计算整日边界，而不是按运行容器的
// 时区解析 YYYY-MM-DD，避免部署环境时区变化导致日期筛选偏移一天。
const startOfFilterDay = (value: string) =>
  new Date(`${value}T00:00:00.000+08:00`);
const endOfFilterDay = (value: string) =>
  new Date(`${value}T23:59:59.999+08:00`);

// 项目和活动挂在两个不同的前缀（/api/project、/api/activity）下，各自的
// requireUser 因此也各自生效——不是同一条链，是两条并列的链，共享本文件
// 只是因为两张表关系紧密、字段投影和删除保护的理由长得一样。
export const projectRoutes = new Hono<{ Variables: AuthedVariables }>()
  .use(requireUser)

  .post("/list", jsonBody(ListProjectsInput), async (c) => {
    const { name, publishStatus, startTime, endTime, page, pageSize } =
      c.req.valid("json");

    const where = and(
      name ? ilike(project.name, `%${name}%`) : undefined,
      publishStatus ? eq(project.publishStatus, publishStatus) : undefined,
      startTime
        ? gte(project.startTime, startOfFilterDay(startTime))
        : undefined,
      endTime ? lte(project.endTime, endOfFilterDay(endTime)) : undefined,
    );

    const { limit, offset } = toLimitOffset({ page, pageSize });

    // 列表和总数互不依赖，并发发出去省一个往返。
    const [list, totalRows] = await Promise.all([
      db
        .select(projectListFields)
        .from(project)
        .leftJoin(activity, eq(activity.projectId, project.id))
        .where(where)
        .groupBy(
          project.id,
          project.name,
          project.location,
          project.startTime,
          project.endTime,
          project.totalBudget,
          project.hostOrg,
          project.organizerOrg,
          project.supportOrg,
          project.guidingOrg,
          project.description,
          project.publishStatus,
          project.createdAt,
          project.updatedAt,
        )
        // 按 id 倒序，不按 updatedAt——排序键选一个不会因为编辑而变化的列，
        // 行才会待在原地，改一个字段不会把它弹到列表最前面。
        .orderBy(desc(project.id))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(project).where(where),
    ]);

    return c.json(ok({ list, total: totalRows[0]?.total ?? 0 }));
  })

  .post("/get", jsonBody(ProjectIdInput), async (c) => {
    const [row] = await db
      .select(projectFields)
      .from(project)
      .where(eq(project.id, c.req.valid("json").id));

    return row ? c.json(ok(row)) : c.json(projectNotFound());
  })

  /**
   * 仅供下拉选择的轻量项目选项，不返回预算、单位或审计时间。
   *
   * 不复用 /list：那条接口有分页上界（每页最多 100），而"所属项目"下拉要的是
   * 全部项目，靠 pageSize 撑到某个大数字迟早会在第 101 个项目上静默截断。
   */
  .post("/options", async (c) => {
    const list = await db
      .select({ id: project.id, name: project.name })
      .from(project)
      .orderBy(desc(project.id));

    return c.json(ok(list));
  })

  .post("/create", jsonBody(CreateProjectInput), async (c) => {
    const { totalBudget, ...input } = c.req.valid("json");
    const userId = c.get("authedUser").id;

    const [row] = await db
      .insert(project)
      .values({
        ...input,
        // numeric 列在 drizzle 里是字符串类型（保精度，不用浮点），
        // 表单传的是数字，这里是唯一需要转换的地方。
        totalBudget: totalBudget?.toString(),
        createdBy: userId,
        updatedBy: userId,
      })
      .returning(projectFields);

    return c.json(ok(row));
  })

  .post("/update", jsonBody(UpdateProjectInput), async (c) => {
    const { id, totalBudget, ...input } = c.req.valid("json");

    // 不先查再改：那是两次往返 + 一个竞态窗口。直接写，靠 returning 的
    // 空数组判断"这行不存在"，一次查询既原子又少一跳。
    const [row] = await db
      .update(project)
      .set({
        ...input,
        totalBudget: totalBudget?.toString(),
        updatedBy: c.get("authedUser").id,
      })
      .where(eq(project.id, id))
      .returning(projectFields);

    return row ? c.json(ok(row)) : c.json(projectNotFound());
  })

  .post(
    "/setPublishStatus",
    jsonBody(SetProjectPublishStatusInput),
    async (c) => {
      const { id, publishStatus } = c.req.valid("json");

      const [row] = await db
        .update(project)
        .set({ publishStatus, updatedBy: c.get("authedUser").id })
        .where(eq(project.id, id))
        .returning(projectFields);

      return row ? c.json(ok(row)) : c.json(projectNotFound());
    },
  )

  .post("/delete", jsonBody(ProjectIdInput), async (c) => {
    const { id } = c.req.valid("json");

    const [relatedActivities] = await db
      .select({ total: count() })
      .from(activity)
      .where(eq(activity.projectId, id));

    if ((relatedActivities?.total ?? 0) > 0) {
      return c.json(
        validationError(
          `该项目下有 ${relatedActivities?.total} 场活动，不能删除；如需隐藏请改为下架`,
        ),
      );
    }

    try {
      const [row] = await db
        .delete(project)
        .where(eq(project.id, id))
        .returning({ id: project.id });

      return row ? c.json(ok(row)) : c.json(projectNotFound());
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        return c.json(
          validationError(
            "该项目已被其他业务数据引用，不能删除；如需隐藏请改为下架",
          ),
        );
      }
      throw error;
    }
  });

// 删除接口只允许没有活动或其他外键引用的项目通过；已被使用的项目仍然用
// "下架"（publishStatus = delisted）隐藏，避免级联删除活动及其下游数据。

export const activityRoutes = new Hono<{ Variables: AuthedVariables }>()
  .use(requireUser)

  .post("/list", jsonBody(ListActivitiesInput), async (c) => {
    const {
      projectId,
      name,
      activityType,
      publishStatus,
      startTime,
      endTime,
      page,
      pageSize,
    } = c.req.valid("json");

    const where = and(
      // 不传 projectId 就是跨项目看全部（一级菜单「活动管理」）。
      projectId ? eq(activity.projectId, projectId) : undefined,
      name ? ilike(activity.name, `%${name}%`) : undefined,
      activityType ? eq(activity.activityType, activityType) : undefined,
      publishStatus ? eq(activity.publishStatus, publishStatus) : undefined,
      startTime
        ? gte(activity.startTime, startOfFilterDay(startTime))
        : undefined,
      endTime ? lte(activity.endTime, endOfFilterDay(endTime)) : undefined,
    );

    const { limit, offset } = toLimitOffset({ page, pageSize });

    const [list, totalRows] = await Promise.all([
      db
        .select(activityListFields)
        .from(activity)
        .where(where)
        .orderBy(desc(activity.id))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(activity).where(where),
    ]);

    return c.json(ok({ list, total: totalRows[0]?.total ?? 0 }));
  })

  /**
   * 详情比列表多带一个 `projectName`：活动概览要展示"所属项目"。
   *
   * 只加在 /get 不加在 /list——列表永远是从项目详情点进来的，那一屏上项目
   * 名字就在标题里，每行再重复一遍是噪音；而活动详情可以从收藏夹、从别人
   * 发来的链接直接打开，这时"这活动属于哪个项目"是真的缺失信息。
   */
  .post("/get", jsonBody(ActivityIdInput), async (c) => {
    const [row] = await db
      .select({ ...activityFields, projectName: project.name })
      .from(activity)
      .innerJoin(project, eq(project.id, activity.projectId))
      .where(eq(activity.id, c.req.valid("json").id));

    return row ? c.json(ok(row)) : c.json(activityNotFound());
  })

  /**
   * 取得活动的 H5 行程分享链接。
   *
   * 老活动首次调用会生成并保存一个 12 位随机 token；以后始终返回同一链接，
   * 不在浏览器路径里暴露连续的活动 id。H5 的公开域名由运行时 `H5_URL` 配置，
   * 让同一个管理端镜像能部署到不同环境。
   */
  .post("/shareItinerary", jsonBody(ActivityIdInput), async (c) => {
    // 先校验配置再写库：部署漏配时不应留下一个用户根本拿不到的 token。
    const h5BaseUrl = getH5BaseUrl();
    const token = await getOrCreateItineraryShareToken(
      c.req.valid("json").id,
      c.get("authedUser").id,
    );

    if (!token) return c.json(activityNotFound());

    return c.json(
      ok({
        url: new URL(`/a/${token}`, h5BaseUrl.origin).toString(),
      }),
    );
  })

  .post("/create", jsonBody(CreateActivityInput), async (c) => {
    const { totalBudget, ...input } = c.req.valid("json");
    const userId = c.get("authedUser").id;

    // projectId 指向的项目存不存在，交给外键约束兜底——多一次查询确认
    // "项目存在"只是把同一个检查做两遍，插入失败时的外键错误已经说明问题。
    const [row] = await db
      .insert(activity)
      .values({
        ...input,
        totalBudget: totalBudget?.toString(),
        createdBy: userId,
        updatedBy: userId,
      })
      .returning(activityFields);

    return c.json(ok(row));
  })

  .post("/update", jsonBody(UpdateActivityInput), async (c) => {
    const { id, totalBudget, ...input } = c.req.valid("json");

    const [row] = await db
      .update(activity)
      .set({
        ...input,
        totalBudget: totalBudget?.toString(),
        updatedBy: c.get("authedUser").id,
      })
      .where(eq(activity.id, id))
      .returning(activityFields);

    return row ? c.json(ok(row)) : c.json(activityNotFound());
  })

  .post("/delete", jsonBody(ActivityIdInput), async (c) => {
    const { id } = c.req.valid("json");

    try {
      const row = await deleteActivityCascade(id);

      return row ? c.json(ok(row)) : c.json(activityNotFound());
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        return c.json(
          validationError(
            "该活动仍被尚未纳入清理范围的关联数据引用，暂时不能删除",
          ),
        );
      }
      throw error;
    }
  })

  .post(
    "/setPublishStatus",
    jsonBody(SetActivityPublishStatusInput),
    async (c) => {
      const { id, publishStatus } = c.req.valid("json");

      const [row] = await db
        .update(activity)
        .set({ publishStatus, updatedBy: c.get("authedUser").id })
        .where(eq(activity.id, id))
        .returning(activityFields);

      return row ? c.json(ok(row)) : c.json(activityNotFound());
    },
  )

  .post(
    "/setDisplayEnabled",
    jsonBody(SetActivityDisplayEnabledInput),
    async (c) => {
      const { id, displayEnabled } = c.req.valid("json");

      const [row] = await db
        .update(activity)
        .set({ displayEnabled, updatedBy: c.get("authedUser").id })
        .where(eq(activity.id, id))
        .returning(activityFields);

      return row ? c.json(ok(row)) : c.json(activityNotFound());
    },
  )

  .post(
    "/setRegistrationEnabled",
    jsonBody(SetActivityRegistrationEnabledInput),
    async (c) => {
      const { id, registrationEnabled } = c.req.valid("json");

      const [row] = await db
        .update(activity)
        .set({ registrationEnabled, updatedBy: c.get("authedUser").id })
        .where(eq(activity.id, id))
        .returning(activityFields);

      return row ? c.json(ok(row)) : c.json(activityNotFound());
    },
  );

// 活动物理删除会在一个事务里清理全部活动级业务数据；共享主档和下载审计
// 不会被删除。需要保留活动及其历史时，应使用 publishStatus = "delisted" 下架。
