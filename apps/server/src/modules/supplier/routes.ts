import { and, arrayContains, asc, count, desc, eq, ilike, sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../../infra/db";
import { toLimitOffset } from "../../shared/pagination";
import { err, ok } from "../../shared/result";
import { jsonBody } from "../../shared/validate";
import { type AuthedVariables, requireUser } from "../auth";
import { supplier } from "./schema";
import {
  CreateSupplierInput,
  ListSuppliersInput,
  SetSupplierStatusInput,
  SupplierIdInput,
  UpdateSupplierInput,
} from "./validation";

/**
 * 接口返回的列，显式列出而不是 `select().from(supplier)`。
 * 这样往表上加一列不会顺带改掉 API 契约（也不会把 createdBy/updatedBy
 * 这种前端用不着的用户 id 顺手发到浏览器）。
 */
const supplierFields = {
  id: supplier.id,
  name: supplier.name,
  serviceCategories: supplier.serviceCategories,
  city: supplier.city,
  contactPerson: supplier.contactPerson,
  contactPhone: supplier.contactPhone,
  status: supplier.status,
  remark: supplier.remark,
  createdAt: supplier.createdAt,
  updatedAt: supplier.updatedAt,
};

const notFound = () =>
  err({ code: "NOT_FOUND" as const, message: "供应商不存在" });

export const supplierRoutes = new Hono<{ Variables: AuthedVariables }>()
  // 整条链都要求登录。前端的菜单和路由守卫不是安全边界，这里才是。
  .use(requireUser)

  .post("/api/listSuppliers", jsonBody(ListSuppliersInput), async (c) => {
    const { name, serviceCategory, city, status, page, pageSize } =
      c.req.valid("json");

    // and(...) 会忽略 undefined，所以没填的筛选项自然不进 WHERE。
    const where = and(
      name ? ilike(supplier.name, `%${name}%`) : undefined,
      serviceCategory
        ? arrayContains(supplier.serviceCategories, [serviceCategory])
        : undefined,
      city ? eq(supplier.city, city) : undefined,
      status ? eq(supplier.status, status) : undefined,
    );

    const { limit, offset } = toLimitOffset({ page, pageSize });

    // 列表和总数互不依赖，并发发出去省一个往返。
    const [list, totalRows] = await Promise.all([
      db
        .select(supplierFields)
        .from(supplier)
        .where(where)
        // 按 id 倒序（= 创建时间倒序，identity 单调递增），**不按 updatedAt**。
        //
        // 旧系统排的是 updateTime，副作用是「改任何字段都会把这行弹到第一」——
        // 想停用第三行，点完它跳到第一，视线和鼠标都得重新找，列表越长越难受。
        // 排序键选一个**不会因为编辑而变化**的列，行才会待在原地。
        //
        // 顺带解决翻页漂移：id 唯一，不需要兜底排序键；而 updatedAt 可能撞毫秒，
        // 两页之间的相对顺序不保证，会出现某行重复出现或整页被跳过。
        .orderBy(desc(supplier.id))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(supplier).where(where),
    ]);

    return c.json(ok({ list, total: totalRows[0]?.total ?? 0 }));
  })

  .post("/api/getSupplier", jsonBody(SupplierIdInput), async (c) => {
    const [row] = await db
      .select(supplierFields)
      .from(supplier)
      .where(eq(supplier.id, c.req.valid("json").id));

    return row ? c.json(ok(row)) : c.json(notFound());
  })

  .post("/api/createSupplier", jsonBody(CreateSupplierInput), async (c) => {
    const input = c.req.valid("json");
    const userId = c.get("authedUser").id;

    const [row] = await db
      .insert(supplier)
      .values({ ...input, createdBy: userId, updatedBy: userId })
      .returning(supplierFields);

    return c.json(ok(row));
  })

  .post("/api/updateSupplier", jsonBody(UpdateSupplierInput), async (c) => {
    const { id, ...input } = c.req.valid("json");

    // 不先查再改：那是两次往返 + 一个竞态窗口。直接写，靠 returning 的空数组
    // 判断「这行不存在」，一次查询既原子又少一跳。
    const [row] = await db
      .update(supplier)
      .set({ ...input, updatedBy: c.get("authedUser").id })
      .where(eq(supplier.id, id))
      .returning(supplierFields);

    return row ? c.json(ok(row)) : c.json(notFound());
  })

  .post("/api/setSupplierStatus", jsonBody(SetSupplierStatusInput), async (c) => {
    const { id, status } = c.req.valid("json");

    const [row] = await db
      .update(supplier)
      .set({ status, updatedBy: c.get("authedUser").id })
      .where(eq(supplier.id, id))
      .returning(supplierFields);

    return row ? c.json(ok(row)) : c.json(notFound());
  })

  .post("/api/deleteSupplier", jsonBody(SupplierIdInput), async (c) => {
    // 物理删除。旧库的 del_flag 去掉了：它和 status(enabled/disabled) 是同一
    // 张表上的两套「删除」语义，必然长歪，而 status 本来就是停用通道。
    // 等哪天有别的表引用 supplier_id，再回来加 deletedAt 软删。
    const [row] = await db
      .delete(supplier)
      .where(eq(supplier.id, c.req.valid("json").id))
      .returning({ id: supplier.id });

    return row ? c.json(ok(row)) : c.json(notFound());
  })

  .post("/api/getSupplierStats", async (c) => {
    // **故意不带筛选条件**：这几个数字是「供应商库整体长什么样」的概览，
    // 跟着筛选一起变的话，用户每敲一个筛选条件顶部数字就跳一次，反而没法当参照。
    //
    // 三个计数用 FILTER 挤进同一条 SQL：分开发就是三次往返 + 三次全表扫描。
    const [row] = await db
      .select({
        total: count(),
        enabled: sql<number>`count(*) filter (where ${supplier.status} = 'enabled')::int`,
        cities: sql<number>`count(distinct ${supplier.city})::int`,
      })
      .from(supplier);

    const total = row?.total ?? 0;
    const enabled = row?.enabled ?? 0;
    return c.json(
      ok({ total, enabled, disabled: total - enabled, cities: row?.cities ?? 0 }),
    );
  })

  .post("/api/listSupplierCities", async (c) => {
    // 城市是自由填写的，选项只能从存量数据里归纳 —— 没有城市字典表。
    const rows = await db
      .selectDistinct({ city: supplier.city })
      .from(supplier)
      .orderBy(asc(supplier.city));

    return c.json(ok(rows.map((row) => row.city)));
  });
