import {
  activityMember,
  member,
  projectMember,
  type SegmentMemberRole,
  segmentMember,
} from "../modules/member/schema";
import { DEMO, type SeedFn } from "./context";

// 人员是唯一刻意灌到「超过一页」的表：列表默认 pageSize=10（shared/pagination.ts），
// 只灌两三行的话分页、翻页、筛选后重置页码这些回归一条都测不出来，而这个仓库
// 的表格筛选恰好是 bug 高发区（见 AGENTS.md「表格筛选」一节）。
const NAMES = [
  "王芳",
  "李强",
  "张伟",
  "刘洋",
  "陈静",
  "杨帆",
  "赵磊",
  "黄丽",
  "周敏",
  "吴鹏",
  "徐婷",
  "孙涛",
  "马超",
  "朱琳",
  "胡军",
  "郭雪",
  "何伟",
  "高原",
  "林曼",
  "罗宾",
  "郑好",
  "梁爽",
  "谢婉",
  "唐宁",
  "宋佳",
  "潘婷",
  "许晨",
  "沈悦",
  "韩松",
  "董洁",
  "蒋楠",
  "邱明",
  "袁媛",
  "傅杰",
  "叶青",
  "卢俊",
  "方圆",
  "杜娟",
  "魏东",
  "沈琳",
  "彭飞",
  "曹颖",
  "秦川",
  "罗欣",
  "顾成",
  "程璐",
  "冯凯",
  "邵宁",
  "曾诚",
  "陆瑶",
  "贺敏",
];

const COMPANY_POSITIONS = [
  "杭州市时尚产业促进会 · 秘书长",
  "萧山区商务局 · 科长",
  "某服装集团 · 供应链总监",
  "某面料公司 · 市场经理",
  "独立设计师",
  "某电商平台 · 品类负责人",
];

// 活动人员的来源。取值刻意不止一种：活动人员列表的来源筛选项是从真实记录里
// 反推出来的（见 modules/member 的来源筛选），只有一种来源等于没测。
const SOURCES = ["手工添加", "项目指派", "报名", "环节引用"];

// 籍贯的四种形态，刻意各不相同：普通省市、直辖市（字典里没有市级，市留空）、
// 只选省不选市（合法，见 modules/member/validation.ts 的 validateRegion）。少一种
// 形态，展示层"省 + 市"的拼接就有一条分支没被看过。
const NATIVE_PLACES = [
  {
    nativeProvinceCode: "330000",
    nativeProvince: "浙江省",
    nativeCityCode: "330100",
    nativeCity: "杭州市",
  },
  {
    nativeProvinceCode: "350000",
    nativeProvince: "福建省",
    nativeCityCode: "350500",
    nativeCity: "泉州市",
  },
  {
    nativeProvinceCode: "110000",
    nativeProvince: "北京市",
    nativeCityCode: null,
    nativeCity: null,
  },
  {
    nativeProvinceCode: "440000",
    nativeProvince: "广东省",
    nativeCityCode: null,
    nativeCity: null,
  },
];

// 外籍那一位。籍贯必须为空——服务端会拒绝"非中国籍 + 有籍贯"的组合，
// 种子里放一条正好让这条联动规则在开发环境里一直有个活样本。
const FOREIGN_INDEX = 19;
const CROSS_SEGMENT_MEMBER_INDEX = 2;

const organizationIdAt = (index: number): number | null =>
  index < 7
    ? DEMO.organizationIds.fashionAssociation
    : index < 11
      ? DEMO.organizationIds.textileChamber
      : index === 11
        ? DEMO.organizationIds.designerAssociation
        : null;

// 主论坛固定放 50 人供排座；刻意排除张伟（index 2），他只参加与主论坛重叠的
// 分论坛。这样既能压测 50 人候选列表，也保留跨环节人员范围和唯一冲突样本。
const FORUM_MEMBER_INDEXES = NAMES.map((_, index) => index).filter(
  (index) => index !== CROSS_SEGMENT_MEMBER_INDEX,
);

const forumRoleAt = (index: number): SegmentMemberRole =>
  index === 0
    ? "领导嘉宾"
    : index === 1
      ? "企业家嘉宾"
      : index === 3
        ? "主流媒体代表"
        : index === 4
          ? "网络达人代表"
          : "社会人士";

export const seed: SeedFn = async (db, { userId }) => {
  const audit = { createdBy: userId, updatedBy: userId };

  await db.insert(member).values(
    NAMES.map((name, index) => ({
      id: index + 1,
      name,
      gender: index % 3 === 0 ? ("女" as const) : ("男" as const),
      companyPosition: COMPANY_POSITIONS[index % COMPANY_POSITIONS.length],
      // 7 / 4 / 1 人三个规模，剩余人员不绑定团体，覆盖可空关系的四种展示状态。
      organizationId: organizationIdAt(index),
      ...(index === FOREIGN_INDEX
        ? {
            countryRegionCode: "US",
            countryRegion: "美国",
            nativeProvinceCode: null,
            nativeProvince: null,
            nativeCityCode: null,
            nativeCity: null,
          }
        : {
            countryRegionCode: "CN",
            countryRegion: "中国",
            ...NATIVE_PLACES[index % NATIVE_PLACES.length],
          }),
      idType: "身份证" as const,
      idNumber: `3301${String(19850101 + index).padStart(8, "0")}${String(index + 1).padStart(4, "0")}`,
      mobile: `138${String(10000000 + index).padStart(8, "0")}`,
      email: `member${index + 1}@example.com`,
      language: "中文",
      status:
        index === CROSS_SEGMENT_MEMBER_INDEX
          ? ("disabled" as const)
          : ("enabled" as const),
      ...audit,
    })),
  );

  // 全部 51 人进项目和活动；主论坛进 50 人，张伟只参加分论坛。这样排座候选
  // 刚好 50 人，同时保留「跨环节人员不出现在当前排座列表」的调试样本。
  await db.insert(projectMember).values(
    NAMES.map((_, index) => ({
      id: index + 1,
      projectId: DEMO.projectId,
      memberId: index + 1,
      organizationId: organizationIdAt(index),
      sourceType: index < 12 ? ("manual" as const) : ("import" as const),
      ...audit,
    })),
  );

  await db.insert(activityMember).values(
    Array.from({ length: NAMES.length }, (_, index) => ({
      id: index + 1,
      activityId: DEMO.activityId,
      projectId: DEMO.projectId,
      projectMemberId: index + 1,
      memberId: index + 1,
      organizationId: organizationIdAt(index),
      source: SOURCES[index % SOURCES.length],
      groupName: index < 4 ? "嘉宾组" : "工作组",
      ownerName: index < 4 ? "王芳" : "李强",
      originType: "manual" as const,
      ...audit,
    })),
  );

  await db.insert(segmentMember).values([
    {
      segmentId: DEMO.segmentIds.opening,
      activityId: DEMO.activityId,
      activityMemberId: 1,
      memberId: 1,
      organizationId: organizationIdAt(0),
      segmentRole: "领导嘉宾",
      ...audit,
    },
    ...FORUM_MEMBER_INDEXES.map((index) => ({
      segmentId: DEMO.segmentIds.forum,
      activityId: DEMO.activityId,
      activityMemberId: index + 1,
      memberId: index + 1,
      organizationId: organizationIdAt(index),
      segmentRole: forumRoleAt(index),
      ...audit,
    })),
    {
      // 和主论坛那条属于时间重叠的两个环节（见 30-agenda.ts）：这是议程页
      // 「同一人员环节时间冲突」提示的唯一触发数据，删掉它那个功能就没法调了。
      segmentId: DEMO.segmentIds.negotiation,
      activityId: DEMO.activityId,
      activityMemberId: 1,
      memberId: 1,
      organizationId: organizationIdAt(0),
      segmentRole: "企业家嘉宾",
      ...audit,
    },
    {
      segmentId: DEMO.segmentIds.negotiation,
      activityId: DEMO.activityId,
      activityMemberId: 3,
      memberId: 3,
      organizationId: organizationIdAt(2),
      segmentRole: "社会人士",
      ...audit,
    },
  ]);
};
