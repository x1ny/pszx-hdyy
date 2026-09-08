import type { PermissionKey } from "../../shared/permissions";

/**
 * 接口前缀 → 权限点的**唯一映射表**，以及两份显式豁免清单。
 *
 * ## 为什么集中在一处，而不是各模块链头自己挂
 *
 * 全站其他守卫（`requireUser`、h5 的 `requireH5Member`）都写在模块自己的链头上，
 * 这里刻意例外。判据是**漏挂的后果不一样**：
 *
 * - `requireUser` 漏挂会立刻炸——handler 里 `c.get("authedUser")` 是空的。
 * - `requirePermission` 漏挂是**静默全开**，新模块上线后所有角色都能调，没有任何
 *   信号。角色管理这一轮修的正是这个状态（此前 137 条接口只挂了 `requireUser`）；
 *   如果机制本身不防漏，下一个模块会把它原样带回来。
 *
 * 所以归属写在一张表里，配一个遍历 `app.routes` 的测试
 * （`permission-map.test.ts`）：**任何一条注册了的路径，要么命中下面的前缀表，
 * 要么出现在两份豁免清单里，否则测试红。** 新增模块忘了登记会被拦住，而不是
 * 悄悄放行。
 *
 * ## 怎么加一个新模块
 *
 * 1. 在 `PERMISSION_BY_PREFIX` 里给新前缀写一个权限点；
 * 2. 如果它压根不该受权限点管（公众端、静态文件），加进 `UNGATED_PREFIXES` 并写
 *    明理由；
 * 3. 如果只是模块里个别接口要放行，加进 `UNGATED_PATHS` 并写明理由。
 *
 * 三者都不填，`bun run test` 会告诉你缺哪条。
 */
export const PERMISSION_BY_PREFIX: Record<string, PermissionKey> = {
  // ——— 项目管理 ———
  "/api/project": "project",
  "/api/projectMember": "project",

  // ——— 活动管理 ———
  //
  // 活动详情的十个 tab（议程 / 场地空间 / 排位 / 资源 / 活动人员 / 行程 /
  // 邀请函…）全部归这一个点。它们是**同一个人的一条工作流**，不是几个岗位的
  // 分工——筹备一场活动的人需要议程、场地、排位、人员、行程一起用。
  "/api/activity": "activity",
  "/api/activityConfig": "activity",
  "/api/agenda": "activity",
  "/api/activityMember": "activity",
  "/api/segmentMember": "activity",
  "/api/resourceDemand": "activity",
  "/api/activityResource": "activity",
  "/api/trip": "activity",
  "/api/activityVenue": "activity",
  "/api/seating": "activity",
  // invitation 一个模块横跨两个菜单项，所以按子路径拆开：模板库是全局菜单，
  // 批次生成和生成记录只存在于活动详情的「邀请函」tab 里。路径本来就分好了。
  "/api/invitation/batch": "activity",
  "/api/invitation/record": "activity",

  // ——— 邀请函模板 ———
  "/api/invitation/template": "invitationTemplate",

  // ——— 供应商管理 ———
  "/api/supplier": "supplier",
  "/api/supplierQuote": "supplier",

  // ——— 人员管理 ———
  // 团体（organization）没有独立页面，是从人员管理页里管的。
  "/api/member": "member",
  "/api/organization": "member",

  // ——— 场地管理 ———
  "/api/venue": "venue",

  // ——— 系统管理 ———
  "/api/user": "systemUser",
  "/api/role": "systemRole",
};

/**
 * 整个前缀都不受权限点管。**每条都要有理由**——这份清单是"为什么这里没有闸门"的
 * 唯一解释处，空着一条等于把一个洞伪装成一次遗漏。
 */
export const UNGATED_PREFIXES: Record<string, string> = {
  "/api/example": "范式演示模块，没有业务数据",
  // 上传自己挂了 requireUser，下载刻意公开（浏览器原生预览要能直接开 URL）。
  "/api/file": "模块内部自管守卫，见 modules/file/routes.ts",
  // 下面两个是公众端，认的是手机号 cookie 而不是 Better Auth session，
  // 压根不在管理端的角色体系里（见 modules/h5/auth.ts）。
  "/api/h5": "h5 公众端，另一套身份体系",
  "/api/h5Access": "h5 公众端的手机号校验入口，必须能在未验证时调用",
  // 它回答的就是"当前用户有哪些权限点"，用权限点来挡它是循环依赖。
  "/api/permission": "查询自己的权限点，前端守卫和菜单过滤的数据来源",
  // 地图选点由议程、资源台账共同使用；模块内的 requireUser 保证只有后台登录者
  // 能取得浏览器端 AK，无法归属到其中任意一个单独的权限点。
  "/api/mapConfig": "地图选点的运行时浏览器配置，模块内部要求后台登录",
};

/**
 * 前缀受管、但**个别路径**放行到"登录即可"。
 *
 * 全是跨权限点被调用的**只读下拉 / 候选数据**：返回的是名称和 id，不是业务数据
 * 本身。不放行的话页面会直接断掉——比如只有「活动管理」权限的人打开活动人员页，
 * 选人弹窗永远是空的，因为候选人接口挂在 `/api/member` 前缀下。
 *
 * 泄漏面是"登录的同事能读到场地 / 团体 / 项目 / 角色的名称列表"。8 个人的内部
 * 后台里这不构成越权，而替代方案（给这些接口挂"多点之一"的或语义）会让同一个
 * 前缀里并存三种守卫，往那个文件加接口时得逐条推该挂哪种。
 */
export const UNGATED_PATHS: Record<string, string> = {
  "/api/member/candidates": "选人弹窗的候选人，活动人员 / 环节人员 / 项目人员都要用",
  "/api/member/organizationCandidates": "按团体选人，同上",
  "/api/organization/options": "团体下拉，人员相关的表单都要用",
  "/api/project/options": "建活动时选「所属项目」，活动列表页要用",
  "/api/venue/list": "活动场地从场地库导入时要列场地",
  "/api/role/list": "用户表单的角色下拉，用户管理页要用",
  "/api/invitation/template/list": "活动详情生成邀请函时要选模板",
  "/api/invitation/template/get": "同上，取模板详情",
  "/api/invitation/template/preview": "同上，生成前预览渲染效果",
  // 这条不是"字典型"，是自助功能：目标用户由 session 决定，handler 明确不收
  // userId（见 modules/user/routes.ts 的注释），它本来就只能改自己。
  "/api/user/changePassword": "自助改密，任何登录用户都要能改自己的密码",
};

/**
 * 一条路径归哪个权限点。返回 `null` 表示不受管（豁免）。
 *
 * 前缀按**长度降序**匹配，所以 `/api/invitation/template` 会先于
 * `/api/invitation/batch` 之外的任何短前缀命中——两个 invitation 子前缀互不干扰。
 */
export const resolvePermission = (path: string): PermissionKey | null => {
  if (path in UNGATED_PATHS) return null;

  for (const prefix of sortedPrefixes) {
    if (isUnder(path, prefix)) {
      return PERMISSION_BY_PREFIX[prefix] ?? null;
    }
  }

  return null;
};

/** 这条路径有没有被登记过（不管是受管还是显式豁免）。测试用。 */
export const isMapped = (path: string): boolean => {
  if (path in UNGATED_PATHS) return true;
  if (sortedPrefixes.some((prefix) => isUnder(path, prefix))) return true;
  return Object.keys(UNGATED_PREFIXES).some((prefix) => isUnder(path, prefix));
};

/** `/api/member` 匹配 `/api/member/list`，但不匹配 `/api/memberFoo/list`。 */
const isUnder = (path: string, prefix: string) =>
  path === prefix || path.startsWith(`${prefix}/`);

const sortedPrefixes = Object.keys(PERMISSION_BY_PREFIX).sort(
  (a, b) => b.length - a.length,
);
