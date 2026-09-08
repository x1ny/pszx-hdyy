import { and, asc, eq, exists, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../../infra/db";
import { err, ok } from "../../shared/result";
import {
  parseSeatPoints,
  SEAT_CANVAS_RENDERER_KIND,
  seatFieldPitch,
} from "../../shared/seat-canvas";
import { jsonBody } from "../../shared/validate";
import { activitySegment } from "../agenda/schema";
import { activityMember, segmentMember } from "../member/schema";
import { activity, activityMedia } from "../project/schema";
import { activityResource, resourceMemberBinding } from "../resource/schema";
import {
  seatAssignment,
  segmentSeat,
  segmentSeatingLayout,
  segmentSeatingPlan,
} from "../seating/schema";
import { memberTrip } from "../trip/schema";
import { activityVenueZone } from "../venue/schema";
import { type H5Variables, requireH5Member } from "./auth";
import { GetItineraryInput, GetSeatMapInput } from "./validation";

/**
 * 活动简介按换行拆段。`activity.description` 是纯文本（刻意不接富文本，理由见
 * project/schema.ts 那一列的注释），所以这里只做最朴素的拆分，不解析任何标记。
 */
const toParagraphs = (text: string | null) =>
  (text ?? "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

/**
 * 这个人的议程 —— 口径由 `activity_segment.member_enabled` 本身决定：
 *
 *   member_enabled = false → 这个环节不做人员管理 = **全员参加**，一律显示
 *   member_enabled = true  → 名单说了算，只在他被拉进去时显示
 *
 * 两边都不这么分就都会错：只认 segment_member，运营没给开幕式开人员管理，嘉宾
 * 的行程里就没有开幕式；全量显示，他又会看到自己不参加的平行分论坛。
 */
export const itinerarySegmentsQuery = (activityId: number, memberId: number) =>
  db
    .select({
      id: activitySegment.id,
      name: activitySegment.name,
      segmentType: activitySegment.segmentType,
      startTime: activitySegment.startTime,
      endTime: activitySegment.endTime,
      locationText: activitySegment.locationText,
      description: activitySegment.description,
    })
    .from(activitySegment)
    .where(
      and(
        eq(activitySegment.activityId, activityId),
        eq(activitySegment.status, "active"),
        or(
          eq(activitySegment.memberEnabled, false),
          exists(
            db
              .select({ one: sql`1` })
              .from(segmentMember)
              .where(
                and(
                  eq(segmentMember.segmentId, activitySegment.id),
                  eq(segmentMember.memberId, memberId),
                ),
              ),
          ),
        ),
      ),
    )
    .orderBy(asc(activitySegment.startTime), asc(activitySegment.id));

/**
 * 座位。**只认已确认的方案。**
 *
 * pending 的方案运营还在拖座位，给出去的号随时会变，而嘉宾拿到座位号就是照着
 * 坐 —— 给一个还会变的比不给更糟：不给他知道自己缺信息、会去问；给错了他到场
 * 坐下才被请走。代价是运营忘了点确认时这一栏空着，那属于「缺信息且本人知道
 * 缺」，可恢复。
 */
export const itinerarySeatsQuery = (activityId: number, memberId: number) =>
  db
    .select({
      segmentId: segmentMember.segmentId,
      seat: segmentSeat.label,
      zone: activityVenueZone.name,
      /**
       * 座位图入口的显隐判据。**只取 `renderer_kind`，绝不取 `data`**——行程页
       * 一次返回整页，一位嘉宾可能有三五个带排位的环节，为了三颗按钮把几百 KB
       * 的画布 jsonb 全拉出来解析一遍，首屏就废了。真正的解析推迟到点开那一刻
       * （`/getSeatMap`）。
       *
       * left join：方案存在但还没画过图时这行是空的，那时按钮不该出现。
       */
      rendererKind: segmentSeatingLayout.rendererKind,
    })
    .from(segmentMember)
    .innerJoin(
      seatAssignment,
      and(
        eq(seatAssignment.segmentMemberId, segmentMember.id),
        isNull(seatAssignment.revokedAt),
      ),
    )
    .innerJoin(
      segmentSeatingPlan,
      and(
        eq(segmentSeatingPlan.id, seatAssignment.planId),
        eq(segmentSeatingPlan.status, "confirmed"),
      ),
    )
    .innerJoin(segmentSeat, eq(segmentSeat.id, seatAssignment.segmentSeatId))
    .innerJoin(
      activityVenueZone,
      eq(activityVenueZone.id, segmentSeatingPlan.activityVenueZoneId),
    )
    .leftJoin(
      segmentSeatingLayout,
      eq(segmentSeatingLayout.planId, segmentSeatingPlan.id),
    )
    .where(
      and(
        eq(segmentMember.activityId, activityId),
        eq(segmentMember.memberId, memberId),
      ),
    );

/**
 * 座位图：我在这个环节的位置，外加这份方案的画布 blob。
 *
 * **越权就挡在这条查询的形状上**，不在 handler 的 if 里：入口是 `segment_member`
 * 且锚死 `memberId`，所以传进来的 `segmentId` 无论是什么，查出来的都只可能是
 * 「这个人自己有座位的那个环节」。探测别人的环节返回的是零行，和环节不存在
 * 完全一样——不区分这两者是有意的，区分了就等于把环节的存在性告诉了调用方。
 *
 * join 链和 `itinerarySeatsQuery` 几乎一样，**只有 confirmed 那一条必须保持同步**：
 * 那边判定按钮显不显示，这边决定点开有没有图。一边放宽另一边没跟上，表现就是
 * 按钮出现了、点开是「暂不可用」。
 */
export const seatMapQuery = (
  activityId: number,
  memberId: number,
  segmentId: number,
) =>
  db
    .select({
      planId: segmentSeatingPlan.id,
      zoneName: activityVenueZone.name,
      mySeatLabel: segmentSeat.label,
      myExternalId: segmentSeat.externalId,
      rendererKind: segmentSeatingLayout.rendererKind,
      data: segmentSeatingLayout.data,
    })
    .from(segmentMember)
    .innerJoin(
      seatAssignment,
      and(
        eq(seatAssignment.segmentMemberId, segmentMember.id),
        isNull(seatAssignment.revokedAt),
      ),
    )
    .innerJoin(
      segmentSeatingPlan,
      and(
        eq(segmentSeatingPlan.id, seatAssignment.planId),
        eq(segmentSeatingPlan.status, "confirmed"),
      ),
    )
    .innerJoin(segmentSeat, eq(segmentSeat.id, seatAssignment.segmentSeatId))
    .innerJoin(
      activityVenueZone,
      eq(activityVenueZone.id, segmentSeatingPlan.activityVenueZoneId),
    )
    .innerJoin(
      segmentSeatingLayout,
      eq(segmentSeatingLayout.planId, segmentSeatingPlan.id),
    )
    .where(
      and(
        eq(segmentMember.activityId, activityId),
        eq(segmentMember.memberId, memberId),
        eq(segmentMember.segmentId, segmentId),
      ),
    )
    .limit(1);

/**
 * 这份方案里**这次真实存在**的位置标识。
 *
 * 存在的意义是给 blob 当过滤器：软删的座位行还在（被分配行引用，删不掉），
 * 画布里理论上也已经没有它了——但"理论上"不是保证。以座位行为准做一次交集，
 * 图上的点数才等于现场真实的位置数。
 *
 * **停用（`enabled = false`）的位置照样返回**：那是"这次不安排人坐"，椅子还在，
 * 后台画布上也是画出来的。图上一律画成同一颗灰点，不做视觉区分（h5 只有一种
 * 强调色，多一档灰就需要图例，而定位图上没有地方放图例）。
 */
export const planLiveSeatIdsQuery = (planId: number) =>
  db
    .select({ externalId: segmentSeat.externalId })
    .from(segmentSeat)
    .where(and(eq(segmentSeat.planId, planId), isNull(segmentSeat.removedAt)));

/** 嘉宾自己的到离行程（火车 / 飞机 / 驾车 / 其他）。 */
export const itineraryTripsQuery = (activityMemberId: number) =>
  db
    .select({
      id: memberTrip.id,
      transportMode: memberTrip.transportMode,
      serviceNumber: memberTrip.serviceNumber,
      departureTime: memberTrip.departureTime,
      arrivalTime: memberTrip.arrivalTime,
      departureLocation: memberTrip.departureLocation,
      destination: memberTrip.destination,
    })
    .from(memberTrip)
    .where(eq(memberTrip.activityMemberId, activityMemberId))
    .orderBy(asc(memberTrip.departureTime), asc(memberTrip.id));

/**
 * 主办方给这个人安排的用车。和到离行程是两个来源，前端混排在同一条时间轴上；
 * `start_time` 可空，没有时间的归入同一行程列表的「待定安排」。
 */
export const itineraryCarsQuery = (activityMemberId: number) =>
  db
    .select({
      id: activityResource.id,
      name: activityResource.name,
      transportScene: activityResource.transportScene,
      startTime: activityResource.startTime,
      endTime: activityResource.endTime,
      location: activityResource.location,
      locationPoint: activityResource.locationPoint,
      vehicleInfo: activityResource.vehicleInfo,
      driverName: activityResource.driverName,
      driverPhone: activityResource.driverPhone,
      remark: activityResource.remark,
    })
    .from(activityResource)
    .innerJoin(
      resourceMemberBinding,
      eq(resourceMemberBinding.resourceId, activityResource.id),
    )
    .where(
      and(
        eq(resourceMemberBinding.activityMemberId, activityMemberId),
        eq(activityResource.resourceType, "transport"),
        eq(activityResource.status, "active"),
      ),
    )
    .orderBy(asc(activityResource.startTime), asc(activityResource.id));

/**
 * 现场联系人：这个嘉宾在**这场活动**里的对接人，从 `activity_member.owner_name`
 * / `owner_phone` 直接取。
 *
 * 按 `activityMemberId` 查，不是按 `memberId`——同一个人在别的活动里可能挂着
 * 不同的对接人，按 memberId 查会把那场活动的联系人串进这场活动的页面（同
 * itineraryTripsQuery / itineraryCarsQuery 的道理，见各自注释）。
 *
 * 只取活动层：环节层没有这一列（schema.ts 里 activityMember.ownerPhone 的
 * 注释），行程页也不区分环节，一个人在一场活动里只看到一个联系人。
 */
export const itineraryContactQuery = (activityMemberId: number) =>
  db
    .select({
      ownerName: activityMember.ownerName,
      ownerPhone: activityMember.ownerPhone,
    })
    .from(activityMember)
    .where(eq(activityMember.id, activityMemberId))
    .limit(1);

/**
 * 头图取画廊第一张图，走 /api/file/:fileId —— 那条路刻意没挂 requireUser，
 * 免登录取得到（见 index.ts 里 file 模块那段注释）。没有媒体就不渲染头图。
 */
export const itineraryHeroQuery = (activityId: number) =>
  db
    .select({ fileId: activityMedia.fileId })
    .from(activityMedia)
    .where(
      and(
        eq(activityMedia.activityId, activityId),
        eq(activityMedia.mediaType, "image"),
      ),
    )
    .orderBy(asc(activityMedia.sortOrder), asc(activityMedia.id))
    .limit(1);

export const h5Routes = new Hono<{ Variables: H5Variables }>()
  // 整条链都要求已通过手机号校验，且必须是**这个活动**的人。前缀即作用域，
  // 新加的接口自动落在守卫后面。
  .use(requireH5Member)

  /**
   * 嘉宾专属行程页所需的**全部**数据，一次返回。
   *
   * 页面是一张合一长页（活动信息 + 个人议程 + 交通），拆成多个接口只会让前端
   * 多写几个 loading 态，拿不到任何好处。
   */
  .post("/getItinerary", jsonBody(GetItineraryInput), async (c) => {
    const activityId = c.get("h5Activity").id;
    const me = c.get("h5Member");

    const [activityRow] = await db
      .select({
        name: activity.name,
        location: activity.location,
        startTime: activity.startTime,
        endTime: activity.endTime,
        description: activity.description,
        hostOrg: activity.hostOrg,
        organizerOrg: activity.organizerOrg,
        supportOrg: activity.supportOrg,
        guidingOrg: activity.guidingOrg,
      })
      .from(activity)
      .where(eq(activity.id, activityId))
      .limit(1);

    // 中间件已经在这个活动里解析出了人员关系，所以活动必然存在；留这个分支只是
    // 为了收窄类型，不是真的预期会走到。
    if (!activityRow) {
      return c.json(err({ code: "NOT_FOUND", message: "活动不存在" }));
    }

    // 六个查询互不依赖，并发发出去省掉五个往返。
    const [segments, seatRows, trips, cars, heroRows, contactRows] =
      await Promise.all([
        itinerarySegmentsQuery(activityId, me.memberId),
        itinerarySeatsQuery(activityId, me.memberId),
        itineraryTripsQuery(me.activityMemberId),
        itineraryCarsQuery(me.activityMemberId),
        itineraryHeroQuery(activityId),
        itineraryContactQuery(me.activityMemberId),
      ]);
    const hero = heroRows[0];
    const seatBySegment = new Map(seatRows.map((row) => [row.segmentId, row]));

    // ownerPhone 为空/空白时整块不给：前端拿到 null 就不渲染联系人卡，而不是
    // 渲染一张没有电话可拨的卡片。
    const contactPhone = contactRows[0]?.ownerPhone?.trim();
    const contact = contactPhone
      ? { name: contactRows[0]?.ownerName ?? null, phone: contactPhone }
      : null;

    const organizers = [
      { role: "主办单位", name: activityRow.hostOrg },
      { role: "承办单位", name: activityRow.organizerOrg },
      { role: "支持单位", name: activityRow.supportOrg },
      { role: "指导单位", name: activityRow.guidingOrg },
    ].flatMap(({ role, name }) => (name ? [{ role, name }] : []));

    return c.json(
      ok({
        member: { name: me.name },
        activity: {
          name: activityRow.name,
          location: activityRow.location,
          startTime: activityRow.startTime,
          endTime: activityRow.endTime,
          paragraphs: toParagraphs(activityRow.description),
          organizers,
          heroFileId: hero?.fileId ?? null,
          contact,
        },
        agenda: segments.map((segment) => {
          const assigned = seatBySegment.get(segment.id);
          return {
            ...segment,
            zone: assigned?.zone ?? null,
            seat: assigned?.seat ?? null,
            /**
             * 座位图入口显不显示。这里是**便宜判定**：画布行存在、渲染器认识，
             * 没有解析 blob。真正的解析在 `/getSeatMap`，那条路径上还会再确认
             * 一次"我的座位在画布里有坐标"——判定为 true 却拿不到图是个几乎不
             * 可能发生的残余分支（画布和座位行是同一次 saveLayout 从同一份 doc
             * 写下去的），但它仍然有降级文案，不会给出一个空面板。
             */
            hasSeatMap: assigned?.rendererKind === SEAT_CANVAS_RENDERER_KIND,
          };
        }),
        trips,
        cars,
      }),
    );
  })

  /**
   * 单个环节的座位图。**按需请求**，只有嘉宾真的点开"座位图"时才付出解析代价——
   * 一万座那种极端方案不会拖累任何没点开的人。
   *
   * 出参里 `zoneName` / `seatLabel` **恒定有值**，`map` 才可能为 null。这样降级
   * 分支不需要第二种响应形状：图画不出来时前端照样有话说（"座位图暂不可用，
   * 您的座位是 A区 3排08座"），而不是一个空白面板。
   *
   * 载荷里**没有一个字段属于别人**：只有坐标，没有编号、没有种类等级、没有人名。
   * 隐私不是靠前端"拿到了但不渲染"来保证的，是靠服务端根本不发——这个页面的
   * 凭证只是一个手机号（auth.ts 顶部写着它挡不住知道号码的人），把整片区的与会者
   * 名单铺进响应体，等于任何拿到转发链接的人都能把它拖出来。
   */
  .post("/getSeatMap", jsonBody(GetSeatMapInput), async (c) => {
    const activityId = c.get("h5Activity").id;
    const me = c.get("h5Member");
    const { segmentId } = c.req.valid("json");

    const [row] = await seatMapQuery(activityId, me.memberId, segmentId);
    if (!row) {
      return c.json(
        err({ code: "NOT_FOUND", message: "没有找到您在这个环节的座位" }),
      );
    }

    return c.json(
      ok({
        zoneName: row.zoneName,
        seatLabel: row.mySeatLabel,
        map: await buildSeatMap(row),
      }),
    );
  });

/**
 * 画布 blob + 座位行 → 一份能直接画的点集。画不出来返回 null。
 *
 * 三道关，任何一道不过就降级：渲染器不认识、blob 解析失败、**我的座位在画布里
 * 没有坐标**。最后一道最容易被忽略却最要紧——一张画出了整片区、偏偏没有"你在
 * 这里"的图，比不给图更糟：它看起来是正常的，嘉宾会对着它找一个不存在的红点。
 */
async function buildSeatMap(row: {
  planId: number;
  myExternalId: string;
  rendererKind: string;
  data: unknown;
}) {
  if (row.rendererKind !== SEAT_CANVAS_RENDERER_KIND) return null;

  const points = parseSeatPoints(row.data);
  if (!points) return null;

  const mine = points.find((point) => point.externalId === row.myExternalId);
  if (!mine) return null;

  const live = new Set(
    (await planLiveSeatIdsQuery(row.planId)).map((seat) => seat.externalId),
  );

  // 我自己那颗也留在这个列表里：定位钉画在最上层盖住它，点数因此等于现场
  // 真实的位置数——少一个的话"数一数第几个"就对不上了。
  const seats = points
    .filter((point) => live.has(point.externalId))
    .map((point) => ({ x: point.x, y: point.y }));

  return {
    seats,
    mine: { x: mine.x, y: mine.y },
    /**
     * 典型座距，前端据此决定圆点画多大、放大到什么程度就该停。**在这里算而不是
     * 让 h5 重算**：算法要和管理端画布严格一致（同一片座位在两端必须得出同一个
     * 密度判断），而这里已经有点集、也已经有测试装置。
     */
    pitch: seatFieldPitch(seats),
  };
}
