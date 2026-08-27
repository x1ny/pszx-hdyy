import { describe, expect, test } from "bun:test";
import { db } from "../../infra/db";
import { organizationListFields, organizationRoutes } from "./routes";
import { organization } from "./schema";

describe("organization routes", () => {
  test("exposes the complete CRUD and options action set", () => {
    // Hono 为同一路径的 validator middleware 和 handler 各保留一条 route 记录。
    const postPaths = [
      ...new Set(
        organizationRoutes.routes
          .filter((route) => route.method === "POST")
          .map((route) => route.path),
      ),
    ];

    expect(postPaths).toEqual([
      "/list",
      "/get",
      "/options",
      "/create",
      "/update",
      "/delete",
    ]);
  });
});

describe("organization list projection", () => {
  test("counts only members currently bound to the outer organization", () => {
    const rendered = db
      .select(organizationListFields)
      .from(organization)
      .toSQL().sql;

    expect(rendered).toContain(
      `"member"."organization_id" = "organization"."id"`,
    );
  });

  test("does not expose organization audit user ids", () => {
    const rendered = db
      .select(organizationListFields)
      .from(organization)
      .toSQL().sql;

    expect(rendered).not.toContain(`"created_by"`);
    expect(rendered).not.toContain(`"updated_by"`);
    expect(rendered).toContain(`"member"."organization_id"`);
  });
});
