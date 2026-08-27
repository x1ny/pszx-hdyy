import { describe, expect, test } from "bun:test";
import { getTableName } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { organization } from "../organization/schema";
import { seatAssignment } from "./schema";

const dialect = new PgDialect();

describe("seat assignment occupant schema", () => {
  const config = getTableConfig(seatAssignment);

  test("个人与团体目标由数据库 CHECK 严格二选一", () => {
    const targetCheck = config.checks.find(
      (item) => item.name === "chk_seat_assignment_occupant",
    );
    const rendered = targetCheck
      ? dialect.sqlToQuery(targetCheck.value).sql
      : "";

    expect(rendered).toContain(
      '"seat_assignment"."occupant_type" = \'person\'',
    );
    expect(rendered).toContain(
      '"seat_assignment"."segment_member_id" is not null',
    );
    expect(rendered).toContain('"seat_assignment"."organization_id" is null');
    expect(rendered).toContain(
      '"seat_assignment"."occupant_type" = \'organization\'',
    );
    expect(rendered).toContain('"seat_assignment"."segment_member_id" is null');
    expect(rendered).toContain(
      '"seat_assignment"."organization_id" is not null',
    );
  });

  test("个人目标改为可空，团体目标指向 organization 且禁止删除传播", () => {
    const segmentMemberId = config.columns.find(
      (column) => column.name === "segment_member_id",
    );
    const organizationId = config.columns.find(
      (column) => column.name === "organization_id",
    );
    const organizationFk = config.foreignKeys.find(
      (item) => item.reference().columns[0]?.name === "organization_id",
    );
    const reference = organizationFk?.reference();

    expect(segmentMemberId?.notNull).toBe(false);
    expect(organizationId?.notNull).toBe(false);
    expect(reference && getTableName(reference.foreignTable)).toBe(
      getTableName(organization),
    );
    expect(organizationFk?.onDelete).toBe("no action");
  });

  test("个人分配保留同环节外键，移除成员必须先由 cascade 出口清理", () => {
    const personFk = config.foreignKeys.find(
      (item) => item.getName() === "fk_seat_assignment_member",
    );
    const reference = personFk?.reference();

    expect(reference?.columns.map((column) => column.name)).toEqual([
      "segment_member_id",
      "segment_id",
    ]);
    expect(reference?.foreignColumns.map((column) => column.name)).toEqual([
      "id",
      "segment_id",
    ]);
    expect(personFk?.onDelete).toBe("no action");
  });

  test("有效状态仍是一座唯一，且仅个人受同方案一人一座约束", () => {
    const seatIndex = config.indexes.find(
      (item) => item.config.name === "uk_seat_assignment_seat",
    );
    const personIndex = config.indexes.find(
      (item) => item.config.name === "uk_seat_assignment_member",
    );
    const seatWhere = seatIndex?.config.where
      ? dialect.sqlToQuery(seatIndex.config.where, "indexes").sql
      : "";
    const personWhere = personIndex?.config.where
      ? dialect.sqlToQuery(personIndex.config.where, "indexes").sql
      : "";

    const columns = (index: typeof seatIndex) =>
      index?.config.columns.map((column) =>
        "name" in column ? column.name : undefined,
      );

    expect(columns(seatIndex)).toEqual(["segment_seat_id"]);
    expect(columns(personIndex)).toEqual(["plan_id", "segment_member_id"]);
    expect(seatWhere).toContain('"revoked_at" is null');
    expect(personWhere).toContain('"revoked_at" is null');
    expect(personWhere).toContain('"segment_member_id" is not null');
  });
});
