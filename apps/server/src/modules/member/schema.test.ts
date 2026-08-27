import { describe, expect, test } from "bun:test";
import { getTableName } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { organization } from "../organization/schema";
import { activityMember, projectMember, segmentMember } from "./schema";

const cases = [
  {
    label: "项目人员",
    table: projectMember,
    indexName: "idx_project_member_organization_project",
    indexColumns: ["organization_id", "project_id"],
  },
  {
    label: "活动人员",
    table: activityMember,
    indexName: "idx_activity_member_organization_activity",
    indexColumns: ["organization_id", "activity_id"],
  },
  {
    label: "环节人员",
    table: segmentMember,
    indexName: "idx_segment_member_organization_segment",
    indexColumns: ["organization_id", "segment_id"],
  },
] as const;

describe("三层人员关系的团体快照", () => {
  for (const item of cases) {
    test(`${item.label}使用可空的 organization NO ACTION 外键`, () => {
      const config = getTableConfig(item.table as PgTable);
      const column = config.columns.find(
        (candidate) => candidate.name === "organization_id",
      );
      const foreignKey = config.foreignKeys.find(
        (candidate) =>
          candidate.reference().columns[0]?.name === "organization_id",
      );
      const reference = foreignKey?.reference();

      // 可空且无默认值：schema push 后的旧关系自然保持 null，不从当前主档或
      // 历史 group_name 猜测团体。
      expect(column?.notNull).toBe(false);
      expect(column?.hasDefault).toBe(false);
      expect(reference && getTableName(reference.foreignTable)).toBe(
        getTableName(organization),
      );
      expect(
        reference?.foreignColumns.map((candidate) => candidate.name),
      ).toEqual(["id"]);
      expect(foreignKey?.onDelete).toBe("no action");
    });

    test(`${item.label}有范围加团体复合索引`, () => {
      const config = getTableConfig(item.table as PgTable);
      const target = config.indexes.find(
        (candidate) => candidate.config.name === item.indexName,
      );
      const names = target?.config.columns.map((column) =>
        "name" in column ? column.name : undefined,
      );

      expect(names).toEqual([...item.indexColumns]);
    });
  }

  test("organizationId 与旧 groupName 是不同列", () => {
    expect(activityMember.organizationId.name).toBe("organization_id");
    expect(activityMember.groupName.name).toBe("group_name");
    expect(segmentMember.organizationId.name).toBe("organization_id");
    expect(segmentMember.groupName.name).toBe("group_name");
  });
});
