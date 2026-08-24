import { supplier } from "../modules/supplier/schema";
import type { SeedFn } from "./context";

// 不灌 supplier_quote：报价附件必须指向真实存在的 file_asset，而 file_asset
// 又要求磁盘上有对应的字节。造一份假文件只会让「附件点开是坏的」变成常态，
// 需要调报价附件时在页面上传一个真实文件即可。
export const seed: SeedFn = async (db, { userId }) => {
  await db.insert(supplier).values([
    {
      name: "杭州筑光舞美工程有限公司",
      serviceCategories: ["staging", "lighting"],
      city: "杭州",
      contactPerson: "周敏",
      contactPhone: "13805710001",
      status: "enabled",
      createdBy: userId,
      updatedBy: userId,
    },
    {
      name: "上海宴礼餐饮服务有限公司",
      serviceCategories: ["catering"],
      city: "上海",
      contactPerson: "陈立",
      contactPhone: "13901230002",
      status: "enabled",
      remark: "两次活动合作记录良好。",
      createdBy: userId,
      updatedBy: userId,
    },
    {
      name: "宁波顺达会务用车服务部",
      serviceCategories: ["transport", "accommodation"],
      city: "宁波",
      contactPerson: "孙涛",
      contactPhone: "13600570003",
      status: "disabled",
      remark: "已停用，用来验证状态筛选。",
      createdBy: userId,
      updatedBy: userId,
    },
  ]);
};
