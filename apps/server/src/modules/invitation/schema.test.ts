import { describe, expect, test } from "bun:test";
import { getTableName } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { organization } from "../organization/schema";
import { invitationBatch, invitationRecord } from "./schema";

const dialect = new PgDialect();

describe("invitation recipient schema", () => {
  test("batch and record store the recipient type", () => {
    const batchConfig = getTableConfig(invitationBatch);
    const batchColumns = new Map(
      batchConfig.columns.map((column) => [column.name, column]),
    );
    const recordColumns = new Map(
      getTableConfig(invitationRecord).columns.map((column) => [
        column.name,
        column,
      ]),
    );

    expect(batchColumns.get("recipient_type")?.notNull).toBe(true);
    expect(recordColumns.get("recipient_type")?.notNull).toBe(true);
    expect(recordColumns.get("member_id")?.notNull).toBe(false);
    expect(recordColumns.get("organization_id")?.notNull).toBe(false);
    expect(
      batchConfig.checks.some(
        (item) => item.name === "ck_invitation_batch_recipient_type",
      ),
    ).toBe(true);
  });

  test("record target is a strict member-or-organization choice", () => {
    const config = getTableConfig(invitationRecord);
    const targetCheck = config.checks.find(
      (item) => item.name === "ck_invitation_record_recipient_target",
    );
    const rendered = targetCheck
      ? dialect.sqlToQuery(targetCheck.value).sql
      : "";

    expect(rendered).toContain(
      '"invitation_record"."recipient_type" = \'member\'',
    );
    expect(rendered).toContain(
      '"invitation_record"."recipient_type" = \'organization\'',
    );
    expect(rendered).toContain('"invitation_record"."member_id" is not null');
    expect(rendered).toContain(
      '"invitation_record"."organization_id" is not null',
    );
  });

  test("team records point to organization without delete propagation", () => {
    const config = getTableConfig(invitationRecord);
    const organizationColumn = config.columns.find(
      (column) => column.name === "organization_id",
    );
    const organizationFk = config.foreignKeys.find(
      (item) => item.reference().columns[0]?.name === "organization_id",
    );

    expect(organizationColumn?.notNull).toBe(false);
    expect(
      organizationFk && getTableName(organizationFk.reference().foreignTable),
    ).toBe(getTableName(organization));
    expect(organizationFk?.onDelete).toBe("no action");
  });
});
