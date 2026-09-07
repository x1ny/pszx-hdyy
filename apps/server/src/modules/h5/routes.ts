import { and, asc, eq, exists, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../../infra/db";
import { err, ok } from "../../shared/result";
import { jsonBody } from "../../shared/validate";
import { activitySegment } from "../agenda/schema";
import { activityMember, segmentMember } from "../member/schema";
import { activity, activityMedia } from "../project/schema";
import { activityResource, resourceMemberBinding } from "../resource/schema";
import {
  seatAssignment,
  segmentSeat,
  segmentSeatingPlan,
} from "../seating/schema";
import { memberTrip } from "../trip/schema";
import { activityVenueZone } from "../venue/schema";
import { type H5Variables, requireH5Member } from "./auth";
import { GetItineraryInput } from "./validation";

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
    .where(
      and(
        eq(segmentMember.activityId, activityId),
        eq(segmentMember.memberId, memberId),
      ),
    );

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
          };
        }),
        trips,
        cars,
      }),
    );
  });
