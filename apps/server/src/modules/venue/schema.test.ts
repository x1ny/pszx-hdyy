import { describe, expect, test } from "bun:test";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { activityVenue } from "./schema";

const dialect = new PgDialect();

describe("activity venue source snapshot index", () => {
  const config = getTableConfig(activityVenue);
  const sourceIndex = config.indexes.find(
    (item) => item.config.name === "uk_activity_venue_source",
  );
  const where = sourceIndex?.config.where
    ? dialect.sqlToQuery(sourceIndex.config.where, "indexes").sql
    : "";

  test("only active snapshots are unique per activity and source venue", () => {
    expect(
      sourceIndex?.config.columns.map((column) =>
        "name" in column ? column.name : undefined,
      ),
    ).toEqual(["activity_id", "source_venue_id"]);
    expect(where).toContain("\"status\" = 'active'");
    expect(
      config.uniqueConstraints.some(
        (constraint) => constraint.name === "uk_activity_venue_source",
      ),
    ).toBe(false);
  });
});
