import { and, asc, count, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../../infra/db";
import { toLimitOffset } from "../../shared/pagination";
import { err, ok } from "../../shared/result";
import { jsonBody } from "../../shared/validate";
import { type AuthedVariables, requireUser } from "../auth";
import { planSeats, planZones, resolveSeatZones } from "./layout";
import { venue, venueLayout, venueSeat, venueZone } from "./schema";
import {
  CreateVenueInput,
  GetVenueLayoutInput,
  ListVenuesInput,
  SaveVenueLayoutInput,
  type SaveVenueLayoutPayload,
  SetVenueStatusInput,
  UpdateVenueInput,
  VenueIdInput,
} from "./validation";

/** 事务句柄。drizzle 没导出这个类型，从 db.transaction 的回调参数上取。 */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 显式列出返回列，不用 `select().from(venue)`——表上加一列不会顺带改掉 API 契约，
 * 也不会把 createdBy/updatedBy 这种内部字段发到浏览器。
 */
const venueFields = {
  id: venue.id,
  name: venue.name,
  address: venue.address,
  description: venue.description,
  status: venue.status,
  createdAt: venue.createdAt,
  updatedAt: venue.updatedAt,
};

const zoneFields = {
  id: venueZone.id,
  externalId: venueZone.externalId,
  name: venueZone.name,
  kind: venueZone.kind,
  ordinal: venueZone.ordinal,
};

const seatFields = {
  id: venueSeat.id,
  zoneId: venueSeat.zoneId,
  externalId: venueSeat.externalId,
  label: venueSeat.label,
  kind: venueSeat.kind,
  rank: venueSeat.rank,
  ordinal: venueSeat.ordinal,
};

/**
 * 列表页要的两个统计数（原型 venue-library.html 就展示这两列）。
 *
 * ⚠️ 关联条件必须用 `eq(...)`，**不能**写成看着更直白的
 * `${venueZone.venueId} = ${venue.id}`。drizzle 的 buildSelection 在单表查询下
 * 会把 select 字段里顶层的 Column 片段降级成不带表名的裸列名，那句于是渲染成
 * `where "venue_id" = "id"`——在子查询里这两个名字都先匹配到 venue_zone 自己，
 * 关联整个断掉，count 退化成一个与外层无关的常数。这不是会报错的 bug，是一条
 * 语法完全合法、只是算错的 SQL。
 *
 * `eq()` 返回嵌套 SQL 片段，那层 map 不递归进去，列名保住全限定形式。
 * 跟 member 模块的 activityCount 是同一个坑，下面 routes.test.ts 有钉死它的用例。
 */
export const venueCountFields = {
  zoneCount: sql<number>`(
    select count(*)::int from ${venueZone}
    where ${eq(venueZone.venueId, venue.id)}
  )`.as("zone_count"),
  seatCount: sql<number>`(
    select count(*)::int from ${venueSeat}
    where ${eq(venueSeat.venueId, venue.id)}
  )`.as("seat_count"),
};

const notFound = () =>
  err({ code: "NOT_FOUND" as const, message: "场地不存在" });

/**
 * 画布归并的写入部分。计算在 layout.ts 的纯函数里，这里只负责把结果落库。
 *
 * 顺序是有讲究的：**区域先归并完，再读位置**。区域被删时它下面的位置会被
 * 复合外键 cascade 掉，先读位置的话拿到的是一批马上就不存在的行。
 */
async function applyLayout(
  tx: Tx,
  venueId: number,
  input: SaveVenueLayoutPayload,
) {
  const zoneRows = await tx
    .select(zoneFields)
    .from(venueZone)
    .where(eq(venueZone.venueId, venueId));

  const zonePlan = planZones(zoneRows, input.zones);

  if (zonePlan.remove.length) {
    await tx.delete(venueZone).where(inArray(venueZone.id, zonePlan.remove));
  }
  for (const { id, draft } of zonePlan.update) {
    await tx
      .update(venueZone)
      .set({ name: draft.name, kind: draft.kind, ordinal: draft.ordinal })
      .where(eq(venueZone.id, id));
  }
  const insertedZones = zonePlan.insert.length
    ? await tx
        .insert(venueZone)
        .values(zonePlan.insert.map((draft) => ({ ...draft, venueId })))
        .returning({ id: venueZone.id, externalId: venueZone.externalId })
    : [];

  // 存活的区域（未被删、未被新建的）+ 刚插入的，一起构成 externalId → id 映射。
  const zoneIdByExternalId = new Map<string, number>();
  const removed = new Set(zonePlan.remove);
  for (const row of zoneRows) {
    if (!removed.has(row.id)) zoneIdByExternalId.set(row.externalId, row.id);
  }
  for (const row of insertedZones) {
    zoneIdByExternalId.set(row.externalId, row.id);
  }

  const seatDrafts = resolveSeatZones(input.seats, zoneIdByExternalId);
  if (!seatDrafts) return null;

  const seatRows = await tx
    .select(seatFields)
    .from(venueSeat)
    .where(eq(venueSeat.venueId, venueId));

  const seatPlan = planSeats(seatRows, seatDrafts);

  if (seatPlan.remove.length) {
    await tx.delete(venueSeat).where(inArray(venueSeat.id, seatPlan.remove));
  }
  for (const { id, draft } of seatPlan.update) {
    await tx
      .update(venueSeat)
      .set({
        zoneId: draft.zoneId,
        label: draft.label,
        kind: draft.kind,
        rank: draft.rank,
        ordinal: draft.ordinal,
      })
      .where(eq(venueSeat.id, id));
  }
  if (seatPlan.insert.length) {
    await tx
      .insert(venueSeat)
      .values(seatPlan.insert.map((draft) => ({ ...draft, venueId })));
  }

  return {
    zones: {
      added: zonePlan.insert.length,
      updated: zonePlan.update.length,
      removed: zonePlan.remove.length,
    },
    seats: {
      added: seatPlan.insert.length,
      updated: seatPlan.update.length,
      removed: seatPlan.remove.length,
    },
  };
}

export const venueRoutes = new Hono<{ Variables: AuthedVariables }>()
  // 整条链都要求登录。前端的菜单和路由守卫不是安全边界，这里才是。
  .use(requireUser)

  .post("/list", jsonBody(ListVenuesInput), async (c) => {
    const { name, address, status, page, pageSize } = c.req.valid("json");

    const where = and(
      name ? ilike(venue.name, `%${name}%`) : undefined,
      address ? ilike(venue.address, `%${address}%`) : undefined,
      status ? eq(venue.status, status) : undefined,
    );

    const { limit, offset } = toLimitOffset({ page, pageSize });

    const [list, totalRows] = await Promise.all([
      db
        // 相关子查询而不是 join + group by：后者要把主表列全塞进 GROUP BY，
        // 加一列就要改一次分组。
        .select({ ...venueFields, ...venueCountFields })
        .from(venue)
        .where(where)
        // 按 id 倒序，不按 updatedAt——否则编辑或切状态会把那行弹到第一位，
        // 用户的视线和鼠标都得重新找。理由详见 docs/crud-page-guide.md。
        .orderBy(desc(venue.id))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(venue).where(where),
    ]);

    return c.json(ok({ list, total: totalRows[0]?.total ?? 0 }));
  })

  .post("/get", jsonBody(VenueIdInput), async (c) => {
    const [row] = await db
      .select(venueFields)
      .from(venue)
      .where(eq(venue.id, c.req.valid("json").id));

    return row ? c.json(ok(row)) : c.json(notFound());
  })

  .post("/create", jsonBody(CreateVenueInput), async (c) => {
    const input = c.req.valid("json");
    const userId = c.get("authedUser").id;

    const [row] = await db
      .insert(venue)
      .values({ ...input, createdBy: userId, updatedBy: userId })
      .returning(venueFields);

    return c.json(ok(row));
  })

  .post("/update", jsonBody(UpdateVenueInput), async (c) => {
    const { id, ...input } = c.req.valid("json");

    // 不先查再改：那是两次往返 + 一个竞态窗口。靠 returning 的空数组判断不存在。
    const [row] = await db
      .update(venue)
      .set({ ...input, updatedBy: c.get("authedUser").id })
      .where(eq(venue.id, id))
      .returning(venueFields);

    return row ? c.json(ok(row)) : c.json(notFound());
  })

  .post("/setStatus", jsonBody(SetVenueStatusInput), async (c) => {
    const { id, status } = c.req.valid("json");

    const [row] = await db
      .update(venue)
      .set({ status, updatedBy: c.get("authedUser").id })
      .where(eq(venue.id, id))
      .returning(venueFields);

    return row ? c.json(ok(row)) : c.json(notFound());
  })

  .post("/delete", jsonBody(VenueIdInput), async (c) => {
    /**
     * 物理删除，画布、区域、位置一起 cascade 掉。
     *
     * ⚠️ 还**没有**引用保护。等 activity_venue 建起来（底层设计 §12 第 2 步），
     * 这里要先查「有没有活动引用了这个场地」，有就拒绝并引导去停用——
     * 那时才是 BR-DEV-021「已被引用的不物理删除」真正有对象的时候。
     * 现在没有任何表引用 venue.id，提前写一个查不到东西的检查没有意义。
     */
    const [row] = await db
      .delete(venue)
      .where(eq(venue.id, c.req.valid("json").id))
      .returning({ id: venue.id });

    return row ? c.json(ok(row)) : c.json(notFound());
  })

  .post("/stats", async (c) => {
    // 故意不带筛选条件：这几个数字是「场地库整体长什么样」的概览，
    // 跟着筛选变的话每敲一个条件顶部就跳一次，没法当参照系。
    const [row] = await db
      .select({
        total: count(),
        enabled: sql<number>`count(*) filter (where ${venue.status} = 'enabled')::int`,
      })
      .from(venue);

    const [seatRow] = await db.select({ seats: count() }).from(venueSeat);

    const total = row?.total ?? 0;
    const enabled = row?.enabled ?? 0;
    return c.json(
      ok({
        total,
        enabled,
        disabled: total - enabled,
        seats: seatRow?.seats ?? 0,
      }),
    );
  })

  /**
   * 画布 + 它投影出来的区域和位置，一次拿全。
   *
   * 区域和位置跟着一起返回不是冗余：**降级视图靠的就是它们**。渲染器认不出
   * `rendererKind`、或者 blob 解析失败时，前端用这两个列表照样能显示
   * 「有哪些位置」，不至于白屏（docs/场地排位底层设计.md §9）。
   */
  .post("/getLayout", jsonBody(GetVenueLayoutInput), async (c) => {
    const { venueId } = c.req.valid("json");

    const [venueRow] = await db
      .select(venueFields)
      .from(venue)
      .where(eq(venue.id, venueId));
    if (!venueRow) return c.json(notFound());

    const [layoutRow, zones, seats] = await Promise.all([
      db
        .select({
          rendererKind: venueLayout.rendererKind,
          rendererVersion: venueLayout.rendererVersion,
          data: venueLayout.data,
          updatedAt: venueLayout.updatedAt,
        })
        .from(venueLayout)
        .where(eq(venueLayout.venueId, venueId))
        .then((rows) => rows[0] ?? null),
      db
        .select(zoneFields)
        .from(venueZone)
        .where(eq(venueZone.venueId, venueId))
        .orderBy(asc(venueZone.ordinal), asc(venueZone.id)),
      db
        .select(seatFields)
        .from(venueSeat)
        .where(eq(venueSeat.venueId, venueId))
        .orderBy(asc(venueSeat.ordinal), asc(venueSeat.id)),
    ]);

    return c.json(ok({ venue: venueRow, layout: layoutRow, zones, seats }));
  })

  .post("/saveLayout", jsonBody(SaveVenueLayoutInput), async (c) => {
    const input = c.req.valid("json");
    const userId = c.get("authedUser").id;

    const result = await db.transaction(async (tx) => {
      const [exists] = await tx
        .select({ id: venue.id })
        .from(venue)
        .where(eq(venue.id, input.venueId));
      if (!exists) return null;

      const counts = await applyLayout(tx, input.venueId, input);
      if (!counts) return null;

      /**
       * blob 整份覆盖。`rendererKind` 一经写入就不该再变（底层设计 §4），
       * 但这里不拦——拦的成本是给「同一个场地换渲染器」这件事定一套迁移规则，
       * 而现在只有一个渲染器，拦不拦都没有第二种取值。真出现第二个渲染器时，
       * 这里加一条「已有 kind 且不相同就拒绝」即可。
       */
      await tx
        .insert(venueLayout)
        .values({
          venueId: input.venueId,
          rendererKind: input.layout.rendererKind,
          rendererVersion: input.layout.rendererVersion,
          data: input.layout.data,
          updatedBy: userId,
        })
        .onConflictDoUpdate({
          target: venueLayout.venueId,
          set: {
            rendererKind: input.layout.rendererKind,
            rendererVersion: input.layout.rendererVersion,
            data: input.layout.data,
            updatedBy: userId,
            updatedAt: new Date(),
          },
        });

      return counts;
    });

    return result ? c.json(ok(result)) : c.json(notFound());
  });
