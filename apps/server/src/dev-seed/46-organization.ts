import { organization } from "../modules/organization/schema";
import { DEMO, type SeedFn } from "./context";

export const seed: SeedFn = async (db, { userId }) => {
  const audit = { createdBy: userId, updatedBy: userId };

  await db.insert(organization).values([
    {
      id: DEMO.organizationIds.fashionAssociation,
      name: "杭州市时尚产业促进会",
      remark: "演示数据：成员规模较大的团体",
      ...audit,
    },
    {
      id: DEMO.organizationIds.textileChamber,
      name: "泉州市纺织服装商会",
      remark: "演示数据：成员规模居中的团体",
      ...audit,
    },
    {
      id: DEMO.organizationIds.designerAssociation,
      name: "中国服装设计师协会",
      remark: "演示数据：仅一名成员的团体",
      ...audit,
    },
  ]);
};
