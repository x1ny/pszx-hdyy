/**
 * 权限点清单。**这是权限体系里唯一的真相源，代码即清单。**
 *
 * ## 为什么权限点在代码里而不是库里
 *
 * `apps/web` 是 TanStack Router 的文件路由，页面存在与否完全由代码决定。把权限点
 * （或菜单）搬进数据库之后，运营在库里加一行指向 `/system/dept`，点进去就是 404
 * ——**菜单表的"增删改"对我们是假能力，只有"隐藏一个已存在的页面"是真的**。
 * 所以运营的自由度是"随意组合已有权限点、随意起名建角色"，发明不出新权限点。
 * 完整取舍见 docs/authorization.md。
 *
 * ## 粒度：一个菜单项 = 一个权限点，能进就能改
 *
 * 刻意**没有** `view` / `edit` / `delete` 分档。8 个人的内部后台里，真实存在的角色
 * 是"能进这个模块"和"进不去"，没有人会去配"能改供应商但不能删供应商"——分档只会
 * 让格子数翻倍，而其中一整列永远跟着另一列同勾同取消。
 *
 * 加一档是纯增量（多一个 key 字符串），减一档要清 `role.permissions` 里的历史值，
 * 所以这里先窄后宽。
 *
 * ## 这个文件不许出现任何 import
 *
 * 它同时被服务端和 `apps/web` 消费（前端 `import type { PermissionKey }` 给
 * `nav.ts` 的菜单项标注做编译期校验）。加一行 import 就会顺着依赖链把服务端的东西
 * 拽进浏览器包，而且**不会有任何报错提示你**——同 `shared/dict/` 的约束，理由一样。
 */

/**
 * 权限点与侧边栏菜单项一一对应（`apps/web/src/app/nav.ts`），
 * 顺序也照着菜单从上到下——角色管理页的复选框网格就是按菜单渲染的。
 *
 * **「工作台」刻意不在这里**：它是登录后的落地页，没有权限点的用户也得有地方可去。
 */
export const PERMISSION_KEYS = [
  "project",
  "activity",
  "supplier",
  "member",
  "venue",
  "invitationTemplate",
  "systemUser",
  "systemRole",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

/**
 * 中文名。放在服务端是因为**引导和种子要用它建内置角色的说明文字**，
 * 前端的复选框标签则直接取菜单项自己的 `title`，不从这里读——同一个字符串在两处
 * 各自维护会漂移，而菜单标题本来就是用户认得的那个词。
 */
export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  project: "项目管理",
  activity: "活动管理",
  supplier: "供应商管理",
  member: "人员管理",
  venue: "场地管理",
  invitationTemplate: "邀请函模板",
  systemUser: "用户管理",
  systemRole: "角色管理",
};

/** 入参校验和引导灌满都要用。`PERMISSION_KEYS` 是只读元组，这里放成可变数组。 */
export const ALL_PERMISSIONS: PermissionKey[] = [...PERMISSION_KEYS];

export const isPermissionKey = (value: unknown): value is PermissionKey =>
  typeof value === "string" &&
  (PERMISSION_KEYS as readonly string[]).includes(value);
