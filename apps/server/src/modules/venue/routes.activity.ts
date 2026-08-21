import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../../infra/db";
import { err, ok } from "../../shared/result";
import { jsonBody } from "../../shared/validate";
import { type AuthedVariables, requireUser } from "../auth";
import type { ZoneDraft } from "./schema";
import {
  activityVenue,
  activityVenueLayout,
  activityVenueZone,
  DEFAULT_PURPOSE_BY_KIND,
  venue,
  venueLayout,
  venueSeat,
  venueZone,
} from "./schema";
import {
  ActivityIdInput,
  ActivityVenueIdInput,
  GetActivityVenueLayoutInput,
  ImportActivityVenueInput,
  SaveActivityVenueLayoutInput,
  type SaveActivityVenueLayoutPayload,
  SetActivityVenueZoneStatusInput,
  UpdateActivityVenueInput,
  UpdateActivityVenueZoneInput,
} from "./validation";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 活动场地空间：`/api/activityVenue/*`。
 *
 * 归在 venue 模块下（底层设计 §2 的前缀表），因为它读的是场地库；但它**不认识
 * 排位**——seating 单向依赖这里，反过来不行。
 *
 * 这一层的性质由一句话决定：**它是场地库的一份拷贝，不是一条关联。** 导入之后，
 * 页面上显示的每一个字都来自这一层自己的行和自己的 blob，`sourceVenueId` /
 * `sourceZoneId` 只是出处标记，不参与任何读取路径。
 */

const activityVenueFields = {
  id: activityVenue.id,
  activityId: activityVenue.activityId,
  sourceVenueId: activityVenue.sourceVenueId,
  name: activityVenue.name,
  address: activityVenue.address,
  note: activityVenue.note,
  status: activityVenue.status,
  ordinal: activityVenue.ordinal,
};

const activityZoneFields = {
  id: activityVenueZone.id,
  activityVenueId: activityVenueZone.activityVenueId,
  sourceZoneId: activityVenueZone.sourceZoneId,
  externalId: activityVenueZone.externalId,
  name: activityVenueZone.name,
  kind: activityVenueZone.kind,
  purpose: activityVenueZone.purpose,
  capacity: activityVenueZone.capacity,
  status: activityVenueZone.status,
  note: activityVenueZone.note,
  ordinal: activityVenueZone.ordinal,
};

const notFound = (message = "活动场地不存在") =>
  err({ code: "NOT_FOUND" as const, message });

/** 业务规则被违反。同 agenda / member：信封里没有 CONFLICT，这类走 VALIDATION_ERROR。 */
const invalid = (message: string) =>
  err({ code: "VALIDATION_ERROR" as const, message });

export const activityVenueRoutes = new Hono<{ Variables: AuthedVariables }>()
  .use(requireUser)

  /**
   * 一个活动的全部场地 + 区域 + 每个场地的画布 blob，一次拿全。
   *
   * 不分页：一个活动引用的场地是个位数，区域是十位数，分页只会让前端为了画
   * 一张分布图去翻页。真出现上百个区域的活动时再说。
   */
  .post("/list", jsonBody(ActivityIdInput), async (c) => {
    const { activityId } = c.req.valid("json");

    const venues = await db
      .select(activityVenueFields)
      .from(activityVenue)
      .where(eq(activityVenue.activityId, activityId))
      .orderBy(asc(activityVenue.ordinal), asc(activityVenue.id));

    const [zones, layouts] = await Promise.all([
      db
        .select(activityZoneFields)
        .from(activityVenueZone)
        .where(eq(activityVenueZone.activityId, activityId))
        .orderBy(asc(activityVenueZone.ordinal), asc(activityVenueZone.id)),
      venues.length
        ? db
            .select({
              activityVenueId: activityVenueLayout.activityVenueId,
              rendererKind: activityVenueLayout.rendererKind,
              rendererVersion: activityVenueLayout.rendererVersion,
              data: activityVenueLayout.data,
            })
            .from(activityVenueLayout)
            .innerJoin(
              activityVenue,
              eq(activityVenue.id, activityVenueLayout.activityVenueId),
            )
            .where(eq(activityVenue.activityId, activityId))
        : [],
    ]);

    return c.json(ok({ venues, zones, layouts }));
  })

  /**
   * 顶部四张统计卡（原型 activity-space.html）。
   *
   * "被排位引用"这个数**这里算不了**——它要数有多少个活动区域被环节排位方案
   * 引用，而 venue 模块不认识 seating（§2 的单向依赖）。反过来由 seating 提供
   * 一个按活动数方案的接口，前端把两个数字拼在一起。宁可前端多发一个请求，
   * 也不能为了省一次往返把依赖方向弄反。
   */
  .post("/stats", jsonBody(ActivityIdInput), async (c) => {
    const { activityId } = c.req.valid("json");

    const [venueRow] = await db
      .select({ total: count() })
      .from(activityVenue)
      .where(eq(activityVenue.activityId, activityId));

    const [zoneRow] = await db
      .select({
        total: count(),
        // 只统计启用区域的点位：禁用的区域本活动不用，把它的点位算进"可用"
        // 会让这个数字失去意义。
        capacity: sql<number>`coalesce(sum(${activityVenueZone.capacity})
          filter (where ${activityVenueZone.status} = 'active'), 0)::int`,
      })
      .from(activityVenueZone)
      .where(eq(activityVenueZone.activityId, activityId));

    return c.json(
      ok({
        venues: venueRow?.total ?? 0,
        zones: zoneRow?.total ?? 0,
        capacity: zoneRow?.capacity ?? 0,
      }),
    );
  })

  /**
   * 从场地库导入一个场地。整份拷贝：主记录、画布 blob、全部区域。
   *
   * 入参只有两个 id，拷什么由服务端当场从场地库读——让前端传的话，这份快照
   * 到底快照了哪一刻就说不清了。
   */
  .post("/import", jsonBody(ImportActivityVenueInput), async (c) => {
    const { activityId, venueId } = c.req.valid("json");
    const userId = c.get("authedUser").id;

    const result = await db.transaction(async (tx) => {
      const [source] = await tx
        .select({
          id: venue.id,
          name: venue.name,
          address: venue.address,
          status: venue.status,
        })
        .from(venue)
        .where(eq(venue.id, venueId));
      if (!source) return { ok: false as const, error: "场地不存在" };
      if (source.status === "disabled") {
        return { ok: false as const, error: "该场地已停用，不能引用" };
      }

      const [dup] = await tx
        .select({ id: activityVenue.id })
        .from(activityVenue)
        .where(
          and(
            eq(activityVenue.activityId, activityId),
            eq(activityVenue.sourceVenueId, venueId),
          ),
        );
      if (dup) return { ok: false as const, error: "这个场地已经引用过了" };

      const [maxRow] = await tx
        .select({
          next: sql<number>`coalesce(max(${activityVenue.ordinal}), -1) + 1`,
        })
        .from(activityVenue)
        .where(eq(activityVenue.activityId, activityId));

      const [created] = await tx
        .insert(activityVenue)
        .values({
          activityId,
          sourceVenueId: venueId,
          name: source.name,
          address: source.address,
          ordinal: maxRow?.next ?? 0,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning(activityVenueFields);
      if (!created) return { ok: false as const, error: "创建失败" };

      /**
       * 画布 blob 原样搬过来，一个字节都不看。搬它是因为活动空间页要画区域
       * 的真实形状，排位方案建立时还要从里面取某块区域的几何——两件事都需要，
       * 重画一遍没有道理。
       */
      const [sourceLayout] = await tx
        .select({
          rendererKind: venueLayout.rendererKind,
          rendererVersion: venueLayout.rendererVersion,
          data: venueLayout.data,
        })
        .from(venueLayout)
        .where(eq(venueLayout.venueId, venueId));

      if (sourceLayout) {
        await tx.insert(activityVenueLayout).values({
          activityVenueId: created.id,
          rendererKind: sourceLayout.rendererKind,
          rendererVersion: sourceLayout.rendererVersion,
          data: sourceLayout.data,
          updatedBy: userId,
        });
      }

      /**
       * 区域逐条拷贝，`capacity` 用源区域**当前的座位数**当初值。
       *
       * 这是个规划数字不是权威集合（§3.3）：之后运营改成 236 也好、改成 0 也好，
       * 都不影响环节实际能排几个位。这里给初值只是让"可用点位"一栏不至于开局
       * 全是 0，让人以为导入失败了。
       */
      const sourceZones = await tx
        .select({
          id: venueZone.id,
          externalId: venueZone.externalId,
          name: venueZone.name,
          kind: venueZone.kind,
          ordinal: venueZone.ordinal,
          seatCount: sql<number>`(
            select count(*)::int from ${venueSeat}
            where ${eq(venueSeat.zoneId, venueZone.id)}
          )`.as("seat_count"),
        })
        .from(venueZone)
        .where(eq(venueZone.venueId, venueId))
        .orderBy(asc(venueZone.ordinal), asc(venueZone.id));

      if (sourceZones.length) {
        await tx.insert(activityVenueZone).values(
          sourceZones.map((zone) => ({
            activityVenueId: created.id,
            activityId,
            sourceZoneId: zone.id,
            externalId: zone.externalId,
            name: zone.name,
            kind: zone.kind,
            purpose: DEFAULT_PURPOSE_BY_KIND[zone.kind],
            capacity: zone.seatCount,
            ordinal: zone.ordinal,
          })),
        );
      }

      return { ok: true as const, venue: created, zones: sourceZones.length };
    });

    if (!result.ok) return c.json(invalid(result.error));
    return c.json(ok({ venue: result.venue, zones: result.zones }));
  })

  .post("/update", jsonBody(UpdateActivityVenueInput), async (c) => {
    const { id, ...input } = c.req.valid("json");

    const [row] = await db
      .update(activityVenue)
      .set({ ...input, updatedBy: c.get("authedUser").id })
      .where(eq(activityVenue.id, id))
      .returning(activityVenueFields);

    return row ? c.json(ok(row)) : c.json(notFound());
  })

  /**
   * 移除一个引用的场地，连带它的区域和画布。
   *
   * ⚠️ 有排位方案引用它下面的区域时**不能删**——但那个检查在 seating 侧，
   * 这里查不到（单向依赖）。数据库那边 `segment_seating_plan` 对
   * `activity_venue_zone` 的外键会把这次删除挡下来，报的是外键冲突。
   * 前端在调用前先问一次 seating 有没有引用，好给出人话提示。
   */
  .post("/remove", jsonBody(ActivityVenueIdInput), async (c) => {
    const [row] = await db
      .delete(activityVenue)
      .where(eq(activityVenue.id, c.req.valid("json").id))
      .returning({ id: activityVenue.id });

    return row ? c.json(ok(row)) : c.json(notFound());
  })

  .post("/updateZone", jsonBody(UpdateActivityVenueZoneInput), async (c) => {
    const { id, ...input } = c.req.valid("json");

    const [row] = await db
      .update(activityVenueZone)
      .set(input)
      .where(eq(activityVenueZone.id, id))
      .returning(activityZoneFields);

    return row ? c.json(ok(row)) : c.json(notFound("活动区域不存在"));
  })

  .post(
    "/setZoneStatus",
    jsonBody(SetActivityVenueZoneStatusInput),
    async (c) => {
      const { id, status } = c.req.valid("json");

      const [row] = await db
        .update(activityVenueZone)
        .set({ status })
        .where(eq(activityVenueZone.id, id))
        .returning(activityZoneFields);

      return row ? c.json(ok(row)) : c.json(notFound("活动区域不存在"));
    },
  )

  /**
   * 一份活动场地自己的画布 + 区域，够开一次编辑器会话。
   *
   * 这是活动层**自己拥有一份可编辑几何**的那半——导入时拷贝的不只是名字，
   * 真的整份画布都是这个活动私有的，改它不影响场地库，也不影响别的活动
   * 引用同一个源场地的那一份。
   */
  .post("/getLayout", jsonBody(GetActivityVenueLayoutInput), async (c) => {
    const { activityVenueId } = c.req.valid("json");

    const [venueRow] = await db
      .select(activityVenueFields)
      .from(activityVenue)
      .where(eq(activityVenue.id, activityVenueId));
    if (!venueRow) return c.json(notFound());

    const [layoutRow, zones] = await Promise.all([
      db
        .select({
          rendererKind: activityVenueLayout.rendererKind,
          rendererVersion: activityVenueLayout.rendererVersion,
          data: activityVenueLayout.data,
        })
        .from(activityVenueLayout)
        .where(eq(activityVenueLayout.activityVenueId, activityVenueId))
        .then((rows) => rows[0] ?? null),
      db
        .select(activityZoneFields)
        .from(activityVenueZone)
        .where(eq(activityVenueZone.activityVenueId, activityVenueId))
        .orderBy(asc(activityVenueZone.ordinal), asc(activityVenueZone.id)),
    ]);

    return c.json(ok({ activityVenue: venueRow, layout: layoutRow, zones }));
  })

  /**
   * 活动空间自己的画布保存。**跟场地库的 `venue/saveLayout` 是同一个编辑器、
   * 同一套契约**，唯一的区别是这里没有座位要落库——活动层不落座位行（§3.3），
   * 编辑器投影出的座位那部分在这一层被直接丢弃，只用区域。
   *
   * 归并按 `externalId` 三路走，跟 `venue/layout.ts` 的 `planZones` 同一个算法，
   * 但这里**保留活动层独有的四列**（`purpose`/`capacity`/`status`/`note`）——
   * 编辑器的投影里根本没有这几个字段，UPDATE 时只碰 name/kind/ordinal，
   * 业务字段照旧不受几何编辑影响。
   */
  .post("/saveLayout", jsonBody(SaveActivityVenueLayoutInput), async (c) => {
    const input = c.req.valid("json");
    const userId = c.get("authedUser").id;

    const result = await db.transaction(async (tx) => {
      const [exists] = await tx
        .select({ id: activityVenue.id, activityId: activityVenue.activityId })
        .from(activityVenue)
        .where(eq(activityVenue.id, input.activityVenueId));
      if (!exists) return null;

      const counts = await applyActivityLayout(tx, exists.activityId, input);
      if (!counts) return null;

      await tx
        .insert(activityVenueLayout)
        .values({
          activityVenueId: input.activityVenueId,
          rendererKind: input.layout.rendererKind,
          rendererVersion: input.layout.rendererVersion,
          data: input.layout.data,
          updatedBy: userId,
        })
        .onConflictDoUpdate({
          target: activityVenueLayout.activityVenueId,
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

/**
 * 区域归并的写入部分。算法跟 `venue/layout.ts` 的 `planZones` 一样（按
 * externalId 三路：插入/更新/删除），区别只在这里的行**多带着活动层业务字段**，
 * 更新时必须保留它们不被几何编辑覆盖。
 *
 * ⚠️ 删除一个仍被排位方案引用的区域，会撞 `fk_seating_plan_zone` 外键——venue
 * 模块看不见 `segment_seating_plan`（§2 单向依赖），拦不住也不该在这里拦，
 * 交给数据库约束兜底、事务整体回滚。前端在删除前应该先提示确认。
 */
async function applyActivityLayout(
  tx: Tx,
  activityId: number,
  input: SaveActivityVenueLayoutPayload,
) {
  const rows = await tx
    .select(activityZoneFields)
    .from(activityVenueZone)
    .where(eq(activityVenueZone.activityVenueId, input.activityVenueId));

  const byExternalId = new Map(rows.map((row) => [row.externalId, row]));
  const seen = new Set<string>();
  const insert: ZoneDraft[] = [];
  const update: { id: number; draft: ZoneDraft }[] = [];

  for (const draft of input.zones) {
    seen.add(draft.externalId);
    const row = byExternalId.get(draft.externalId);
    if (!row) {
      insert.push(draft);
    } else if (
      row.name !== draft.name ||
      row.kind !== draft.kind ||
      row.ordinal !== draft.ordinal
    ) {
      update.push({ id: row.id, draft });
    }
  }

  const remove = rows
    .filter((row) => !seen.has(row.externalId))
    .map((row) => row.id);

  if (remove.length) {
    await tx
      .delete(activityVenueZone)
      .where(inArray(activityVenueZone.id, remove));
  }
  for (const { id, draft } of update) {
    await tx
      .update(activityVenueZone)
      .set({ name: draft.name, kind: draft.kind, ordinal: draft.ordinal })
      .where(eq(activityVenueZone.id, id));
  }
  if (insert.length) {
    // 新画的区域没有来源——它是直接在活动自己这份拷贝里画出来的，不是从场地库
    // 导入的，所以 sourceZoneId 留空，purpose 按 kind 给个默认值（跟导入时同一条
    // 规则），capacity 从 0 开始（这块区域还没有座位，§3.3 的规划数字本来就该
    // 从空开始，不是凭空给一个非零初值）。
    await tx.insert(activityVenueZone).values(
      insert.map((draft) => ({
        activityVenueId: input.activityVenueId,
        activityId,
        sourceZoneId: null,
        externalId: draft.externalId,
        name: draft.name,
        kind: draft.kind,
        ordinal: draft.ordinal,
        purpose: DEFAULT_PURPOSE_BY_KIND[draft.kind],
        capacity: 0,
      })),
    );
  }

  return {
    zones: {
      added: insert.length,
      updated: update.length,
      removed: remove.length,
    },
  };
}
