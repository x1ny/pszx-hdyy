import { expect, test } from "bun:test";
import { and, eq, inArray, sql } from "drizzle-orm";
import { hcWithType } from "../../client-type";
import { db } from "../../infra/db";
import { segmentMember } from "../member/schema";
import {
  seatAssignment,
  segmentSeat,
  segmentSeatingLog,
  segmentSeatingPlan,
} from "./schema";

type JsonBody<R> = R extends { json(): Promise<infer T> } ? T : never;
type Data<T> = Extract<T, { code: "OK" }> extends { data: infer D } ? D : never;

async function ok<R extends { json(): Promise<unknown> }>(request: Promise<R>) {
  const result = (await (await request).json()) as {
    code: string;
    data: unknown;
    message?: string;
  };
  expect(result.code, result.message).toBe("OK");
  return result.data as Data<JsonBody<R>>;
}

/** 显式运行，连接 bun run dev 的临时库；finally 恢复测试前的数据。见 docs/seating-assignment.md。 */
const origin = process.env.SEATING_INTEGRATION_URL;
test.skipIf(!origin)(
  "真实事务：一人多座、人数去重、H5、换位、解绑和移除人员",
  async () => {
    if (!origin) throw new Error("缺少 SEATING_INTEGRATION_URL");
    expect(["localhost", "127.0.0.1"]).toContain(new URL(origin).hostname);
    const devEnv = await Bun.file(
      new URL("../../../.dev-db.env", import.meta.url),
    ).text();
    // 只允许当前 worktree 由开发脚本生成的连接，不能对持久库运行本验收。
    const localUrl = devEnv
      .match(/^DATABASE_URL=(.+)$/m)?.[1]
      ?.trim()
      .replace(/^['"]|['"]$/g, "");
    expect(process.env.DATABASE_URL).toBe(localUrl);
    expect(new URL(localUrl ?? "").pathname).toBe("/app_dev");

    const login = await fetch(`${origin}/api/dev/login`, {
      redirect: "manual",
    });
    const cookie = login.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    expect(cookie.length).toBeGreaterThan(0);
    const api = hcWithType(origin, { headers: { Cookie: cookie } }).api;
    const getPlan = () =>
      ok(api.seating.getPlan.$post({ json: { planId: 1 } }));
    const initial = await getPlan();
    expect(initial.seats[0]?.externalId).toStartWith("demo-forum-seat-");
    const person = (
      await ok(api.seating.listCandidates.$post({ json: { planId: 1 } }))
    ).list.find((row) => row.name === "王芳");
    if (!person) throw new Error("需要未修改的开发种子：王芳");
    const memberId = person.segmentMemberId;
    const scope = eq(seatAssignment.planId, 1);
    const [savedAssignments, savedPlans, savedLogs, savedMembers, savedSeats] =
      await Promise.all([
        db.select().from(seatAssignment).where(scope),
        db
          .select()
          .from(segmentSeatingPlan)
          .where(eq(segmentSeatingPlan.id, 1)),
        db
          .select()
          .from(segmentSeatingLog)
          .where(eq(segmentSeatingLog.planId, 1)),
        db.select().from(segmentMember).where(eq(segmentMember.id, memberId)),
        db.select().from(segmentSeat).where(eq(segmentSeat.planId, 1)),
      ]);
    const owned = async () =>
      (await getPlan()).assignments
        .filter((row) => row.segmentMemberId === memberId)
        .map((row) => row.segmentSeatId)
        .sort((a, b) => a - b);
    const assign = (seatId: number) =>
      ok(
        api.seating.assign.$post({
          json: { planId: 1, segmentSeatId: seatId, segmentMemberId: memberId },
        }),
      );
    const swap = (a: number, b: number) =>
      ok(
        api.seating.swap.$post({ json: { planId: 1, seatAId: a, seatBId: b } }),
      );
    const shareToken = "demo-itinerary";
    const h5Login = await api.h5Access.submitPhone.$post({
      json: { shareToken, mobile: "13810000000" },
    });
    const h5Cookie = h5Login.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    expect(h5Cookie.length).toBeGreaterThan(0);
    const guest = hcWithType(origin, { headers: { Cookie: h5Cookie } }).api.h5;
    const itinerary = () =>
      ok(guest.getItinerary.$post({ json: { shareToken } }));
    const seatMap = () =>
      ok(guest.getSeatMap.$post({ json: { shareToken, segmentId: 2 } }));

    try {
      expect(await owned()).toEqual([1, 3]);
      expect(
        (await itinerary()).agenda.filter((row) => row.id === 2),
      ).toHaveLength(1);
      expect((await seatMap()).map?.mine.map((row) => row.label)).toEqual([
        "A1",
        "A3",
      ]);

      await assign(4);
      await ok(
        api.seating.assignActivityMember.$post({
          json: {
            planId: 1,
            segmentSeatId: 5,
            activityMemberId: person.activityMemberId,
          },
        }),
      );
      await Promise.all([assign(6), assign(7)]);
      await assign(4); // 重复请求同一座位不制造两个有效占用。
      expect(await owned()).toEqual([1, 3, 4, 5, 6, 7]);
      expect(
        (await itinerary()).agenda.find((row) => row.id === 2)?.seat,
      ).toBeNull();
      expect((await getPlan()).plan.status).toBe("pending");

      const candidates = (
        await ok(api.seating.listCandidates.$post({ json: { planId: 1 } }))
      ).list;
      expect(candidates).toHaveLength(50);
      expect(
        candidates.find((row) => row.segmentMemberId === memberId)
          ?.takenSeatLabel,
      ).toBe("A1、A3、A4、A5、A6、A7");
      const stat = (
        await ok(
          api.seating.listOrganizationStats.$post({ json: { planId: 1 } }),
        )
      ).list.find((row) => row.organizationId === person.organizationId);
      expect(stat?.assignedPersonCount).toBe(1);
      expect(stat?.remainingMemberCount).toBe(
        (stat?.totalMembers ?? 0) - 1 - (stat?.organizationSeatCount ?? 0),
      );
      const detail = await ok(
        api.activityMember.get.$post({ json: { id: person.activityMemberId } }),
      );
      expect(detail.segments.filter((row) => row.segmentId === 2)).toHaveLength(
        1,
      );
      expect(
        detail.segments.find((row) => row.segmentId === 2)?.seatLabel,
      ).toBe("A1、A3、A4、A5、A6、A7");

      const disabled = await ok(
        api.seating.setSeatEnabled.$post({
          json: { planId: 1, segmentSeatId: 4, enabled: false },
        }),
      );
      expect(disabled.applied).toBe(false);
      await ok(
        api.seating.setSeatEnabled.$post({
          json: { planId: 1, segmentSeatId: 8, enabled: false },
        }),
      );
      const denied = await (
        await api.seating.assign.$post({
          json: { planId: 1, segmentSeatId: 8, segmentMemberId: memberId },
        })
      ).json();
      expect(denied.code).toBe("VALIDATION_ERROR");
      const forged = await (
        await api.seating.assign.$post({
          json: { planId: 1, segmentSeatId: 4, segmentMemberId: 999999 },
        })
      ).json();
      expect(forged.code).toBe("VALIDATION_ERROR");
      expect(await owned()).toEqual([1, 3, 4, 5, 6, 7]);

      await ok(
        api.seating.unassign.$post({ json: { planId: 1, segmentSeatId: 4 } }),
      );
      expect(await owned()).toEqual([1, 3, 5, 6, 7]);
      await swap(3, 4); // 移至空位。
      expect(await owned()).toEqual([1, 4, 5, 6, 7]);
      await swap(1, 4); // 同一个人的两座对调。
      expect(await owned()).toEqual([1, 4, 5, 6, 7]);
      await swap(4, 2); // 与团体交换，不把团体快照写入个人目标列。
      expect(await owned()).toEqual([1, 2, 5, 6, 7]);
      expect(
        (await getPlan()).assignments.find((row) => row.segmentSeatId === 4)
          ?.occupantType,
      ).toBe("organization");

      await ok(api.seating.confirm.$post({ json: { planId: 1 } }));
      expect((await itinerary()).agenda.find((row) => row.id === 2)?.seat).toBe(
        "A1、A2、A5、A6、A7",
      );
      const map = await seatMap();
      expect(map.map?.mine.map((row) => row.label)).toEqual([
        "A1",
        "A2",
        "A5",
        "A6",
        "A7",
      ]);
      expect(map.map?.seats).toHaveLength(50); // 停用的椅子仍在图上。
      expect(
        map.map?.seats.every(
          (point) => Object.keys(point).sort().join() === "x,y",
        ),
      ).toBe(true);
      const invisible = await (
        await guest.getSeatMap.$post({ json: { shareToken, segmentId: 99999 } })
      ).json();
      expect(invisible.code).toBe("NOT_FOUND");
      const logs = await db
        .select()
        .from(segmentSeatingLog)
        .where(
          and(
            eq(segmentSeatingLog.planId, 1),
            eq(segmentSeatingLog.action, "confirm"),
          ),
        );
      expect(logs.length).toBeGreaterThan(0);
      expect(logs.at(-1)?.payload).toMatchObject({
        assignments: expect.arrayContaining(
          [1, 2, 5, 6, 7].map((seatId) => ({
            seatId,
            seatLabel: `A${seatId}`,
            occupantType: "person",
            segmentMemberId: memberId,
            organizationId: person.organizationId,
            organizationName: expect.any(String),
            memberId: person.memberId,
            memberName: person.name,
            mobile: person.mobile,
          })),
        ),
      });
      let duplicateError: unknown;
      try {
        await db
          .insert(seatAssignment)
          .values({
            planId: 1,
            segmentId: 2,
            segmentSeatId: 1,
            occupantType: "person",
            segmentMemberId: memberId,
          })
          .execute();
      } catch (error) {
        duplicateError = error;
      }
      expect(
        (duplicateError as { cause?: { code?: string } } | undefined)?.cause
          ?.code,
      ).toBe("23505");
      const duplicateSeats = await db.execute(
        sql`select segment_seat_id from seat_assignment where plan_id = 1 and revoked_at is null group by segment_seat_id having count(*) > 1`,
      );
      expect(duplicateSeats.rows).toHaveLength(0);

      const blocked = await (
        await api.segmentMember.remove.$post({
          json: { id: memberId, cascade: false },
        })
      ).json();
      expect(blocked.code).toBe("VALIDATION_ERROR");
      expect(await owned()).toHaveLength(5);
      await ok(
        api.segmentMember.remove.$post({
          json: { id: memberId, cascade: true },
        }),
      );
      expect(await owned()).toHaveLength(0);
      expect(
        (await getPlan()).assignments.filter(
          (row) => row.occupantType === "organization",
        ),
      ).toHaveLength(1);
      expect(
        await db
          .select()
          .from(seatAssignment)
          .where(eq(seatAssignment.segmentMemberId, memberId)),
      ).toHaveLength(0);
    } finally {
      // 连级联删除过的成员和软撤销历史一起恢复，验收可反复执行。
      await db.transaction(async (tx) => {
        await tx.delete(seatAssignment).where(scope);
        await tx
          .delete(segmentSeatingLog)
          .where(eq(segmentSeatingLog.planId, 1));
        if (savedMembers.length)
          await tx
            .insert(segmentMember)
            .values(savedMembers)
            .onConflictDoNothing();
        if (savedAssignments.length)
          await tx.insert(seatAssignment).values(savedAssignments);
        if (savedLogs.length)
          await tx.insert(segmentSeatingLog).values(savedLogs);
        if (savedPlans[0])
          await tx
            .update(segmentSeatingPlan)
            .set(savedPlans[0])
            .where(eq(segmentSeatingPlan.id, 1));
        for (const enabled of [false, true]) {
          const ids = savedSeats
            .filter((row) => row.enabled === enabled)
            .map((row) => row.id);
          if (ids.length)
            await tx
              .update(segmentSeat)
              .set({ enabled })
              .where(inArray(segmentSeat.id, ids));
        }
      });
    }
  },
  30_000,
);
