import { describe, expect, test } from "bun:test";
import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { member } from "../member/schema";
import { organization } from "./schema";

describe("organization schema", () => {
  test("keeps organization names unique", () => {
    const config = getTableConfig(organization);
    const constraint = config.uniqueConstraints.find(
      (item) => item.name === "uk_organization_name",
    );

    expect(constraint?.columns.map((column) => column.name)).toEqual(["name"]);
  });

  test("stores the required audit fields", () => {
    const config = getTableConfig(organization);
    const columns = new Map(
      config.columns.map((column) => [column.name, column]),
    );

    expect(columns.get("name")?.notNull).toBe(true);
    expect(columns.get("remark")?.notNull).toBe(false);
    expect(columns.get("created_at")?.notNull).toBe(true);
    expect(columns.get("updated_at")?.notNull).toBe(true);
    expect(columns.has("created_by")).toBe(true);
    expect(columns.has("updated_by")).toBe(true);
  });
});

describe("member organization binding", () => {
  test("is nullable and points to one organization without delete propagation", () => {
    const config = getTableConfig(member);
    const column = config.columns.find(
      (item) => item.name === "organization_id",
    );
    const foreignKey = config.foreignKeys.find(
      (item) => item.reference().columns[0]?.name === "organization_id",
    );
    const reference = foreignKey?.reference();

    expect(column?.notNull).toBe(false);
    expect(reference && getTableName(reference.foreignTable)).toBe(
      "organization",
    );
    expect(reference?.foreignColumns.map((item) => item.name)).toEqual(["id"]);
    expect(foreignKey?.onDelete).toBe("no action");
  });

  test("indexes the one-column binding for member lookup and delete checks", () => {
    const config = getTableConfig(member);
    const organizationIndex = config.indexes.find(
      (item) => item.config.name === "idx_member_organization",
    );

    expect(organizationIndex?.config.columns).toHaveLength(1);
    const indexedColumn = organizationIndex?.config.columns[0];
    expect(
      indexedColumn && "name" in indexedColumn ? indexedColumn.name : undefined,
    ).toBe("organization_id");
  });
});
