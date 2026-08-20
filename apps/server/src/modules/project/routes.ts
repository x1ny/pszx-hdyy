import { and, count, desc, eq, gte, ilike, lte } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../../infra/db";
import { toLimitOffset } from "../../shared/pagination";
import { err, ok } from "../../shared/result";
import { jsonBody } from "../../shared/validate";
import { type AuthedVariables, requireUser } from "../auth";
import { activity, project } from "./schema";
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

const projectNotFound = () =>
  err({ code: "NOT_FOUND" as const, message: "项目不存在" });

const activityNotFound = () =>
  err({ code: "NOT_FOUND" as const, message: "活动不存在" });

// 项目平台的日期筛选按中国大陆业务时区计算整日边界，而不是按运行容器的
// 时区解析 YYYY-MM-DD，避免部署环境时区变化导致日期筛选偏移一天。
const startOfFilterDay = (value: string) =>
  new Date(`${value}T00:00:00.000+08:00`);
const endOfFilterDay = (value: string) =>
  new Date(`${value}T23:59:59.999+08:00`);

// 项目和活动挂在两个不同的前缀（/api/project、/api/activity）下，各自的
// requireUser 因此也各自生效——不是同一条链，是两条并列的链，共享本文件
// 只是因为两张表关系紧密、字段投影和"下架代替删除"的理由长得一样。
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
        .select(projectFields)
        .from(project)
        .where(where)
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
  );

// 故意没有 deleteProject 接口——项目一旦建成会被活动（进而被人员/资源/
// 排位/邀请函）反向引用，物理删除要么级联炸掉一整棵树，要么留一堆
// 悬空引用。"下架"（publishStatus = delisted）就是这张表的删除通道，
// 效果一样（隐藏、数据留痕），但不会踩中上面任何一个坑。

export const activityRoutes = new Hono<{ Variables: AuthedVariables }>()
  .use(requireUser)

  .post("/list", jsonBody(ListActivitiesInput), async (c) => {
    const { projectId, name, activityType, publishStatus, page, pageSize } =
      c.req.valid("json");

    const where = and(
      eq(activity.projectId, projectId),
      name ? ilike(activity.name, `%${name}%`) : undefined,
      activityType ? eq(activity.activityType, activityType) : undefined,
      publishStatus ? eq(activity.publishStatus, publishStatus) : undefined,
    );

    const { limit, offset } = toLimitOffset({ page, pageSize });

    const [list, totalRows] = await Promise.all([
      db
        .select(activityFields)
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

// 同样故意没有 deleteActivity 接口——理由同 project，活动接下来会被
// 人员分层/报名/资源/排位/邀请函大量反向引用。"下架"是删除通道。
