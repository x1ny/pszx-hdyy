import { z } from "zod";
import { PageInput } from "../../shared/pagination";
import { PERMISSION_KEYS } from "../../shared/permissions";
import { USER_STATUSES } from "../auth/schema";

// 带上中文 error：这些 message 会被前端直接丢进 toast，漏一个就露出 zod 的
// 英文默认文案。同 supplier/validation.ts。
const UserStatusEnum = z.enum(USER_STATUSES, { error: "状态不正确" });

/** 用户主键是 Better Auth 生成的随机字符串，不是自增数字。 */
const userId = z.string().trim().min(1, "用户 ID 不能为空");

/** 角色主键才是自增数字。 */
const roleId = z.number().int().positive();

/** 先 trim 再校验：否则「一串空格」能过 min(1)，存进去是条空记录。 */
const required = (label: string, max: number) =>
  z.string().trim().min(1, `${label}不能为空`).max(max, `${label}过长`);

/** 筛选项：前端的「不筛」可能是空串也可能是缺省，统一收敛成 undefined。 */
const filter = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined);

/** 可选文本：空串等同于没填，避免把 "" 和 null 两种"空"同时存进库里。 */
const optionalText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label}过长`)
    .optional()
    .transform((value) => value || undefined);

/**
 * 账号名规则**必须和 Better Auth `username` 插件的校验保持一致**
 * （`3–30` 位、`/^[a-zA-Z0-9_.]+$/`，见 auth.ts 里的插件配置）。
 *
 * 两边都校验不是重复劳动：这一层负责给出中文错误文案，插件那一层是最后防线。
 * 但**规则本身必须同步改**——只放宽这里，插件会在写入时抛一个英文的
 * `INVALID_USERNAME`，前端拿到的是一条看不懂的报错。
 */
export const UsernameInput = z
  .string()
  .trim()
  .min(3, "账号至少 3 位")
  .max(30, "账号最多 30 位")
  .regex(/^[a-zA-Z0-9_.]+$/, "账号只能包含字母、数字、下划线和点");

/**
 * 下限跟 Better Auth 的默认 `minPasswordLength` 对齐（8，见
 * `context/create-context.mjs:185`）。同上，只放宽这里会换来一条英文报错。
 */
export const PasswordInput = z
  .string()
  .min(8, "密码至少 8 位")
  .max(128, "密码最多 128 位");

/**
 * 邮箱是**选填**的，但库里 `email` 是 `notNull + unique`（Better Auth 的要求，
 * 且它内部多条路径假设非空）。空值在 routes.ts 里补成 `<账号>@local.invalid`，
 * 读出时剥掉——脏的地方只关在那两个函数里。详见 docs/user-management-design.md。
 */
const EmailInput = z
  .string()
  .trim()
  .max(255, "邮箱过长")
  .optional()
  .transform((value) => value || undefined)
  .pipe(z.email({ error: "邮箱格式不正确" }).optional());

/**
 * 角色**可以为空**，这一点和旧系统不同（那边是必填）。
 *
 * 理由是安全默认值：本次只预置一条"超级管理员"（见生产引导），角色设成必填等于
 * 逼着每个新账号都挂上最高权限——等下个 PR 把闸门装上，那批账号会一夜之间全是
 * 超管。**没有角色 = 将来什么都不能做**，才是新账号该有的起点。
 */
const RoleIdsInput = z
  .array(roleId)
  .default([])
  // 多选组件传重复值不该变成脏数据（`user_role` 是复合主键，重复会直接违反约束）。
  .transform((value) => [...new Set(value)]);

/** 新增和修改共用的字段集合，改一处两个接口一起变。 */
const UserProfileInput = z.object({
  name: required("姓名", 64),
  email: EmailInput,
  phone: optionalText("手机号", 32),
  roleIds: RoleIdsInput,
  status: UserStatusEnum.default("enabled"),
  remark: optionalText("备注", 1000),
});

export const CreateUserInput = UserProfileInput.extend({
  username: UsernameInput,
  password: PasswordInput,
});

/**
 * **账号名和密码都不经这个接口修改。**
 *
 * 账号名是登录标识，改了等于换一个人（旧系统的编辑弹窗里它也是禁用的）；密码走
 * `/resetPassword`（管理员重置他人）或 `/changePassword`（本人自改），混进通用
 * 的更新接口里，一次误传就会把别人的密码冲掉。
 */
export const UpdateUserInput = UserProfileInput.extend({ id: userId });

export const UserIdInput = z.object({ id: userId });

/**
 * 传目标状态而不是取反：toggle 不幂等，两个人同时点、或者一次网络重试，结果就
 * 不可预测了。同 supplier。
 */
export const SetUserStatusInput = z.object({
  id: userId,
  status: UserStatusEnum,
});

/** 管理员重置他人密码。不需要原密码——管理员本来就不知道。 */
export const ResetPasswordInput = z.object({
  id: userId,
  password: PasswordInput,
});

/** 本人改自己的密码，必须验原密码。目标用户取自 session，**不从入参取**。 */
export const ChangePasswordInput = z.object({
  currentPassword: z.string().min(1, "请输入当前密码"),
  newPassword: PasswordInput,
});

export const ListUsersInput = PageInput.extend({
  username: filter,
  name: filter,
  phone: filter,
  status: UserStatusEnum.optional(),
});

// ---------------------------------------------------------------------------
// 角色
// ---------------------------------------------------------------------------

/**
 * 权限点。**校验的是"代码里存在这个 key"**，不是"库里存在这行"——权限点是代码
 * 里的清单（`shared/permissions.ts`），运营只能从中勾选，发明不出新的。
 */
const PermissionEnum = z.enum(PERMISSION_KEYS, { error: "权限点不正确" });

export const ListRolesInput = PageInput.extend({
  name: filter,
});

export const RoleIdInput = z.object({ id: roleId });

const roleFields = {
  name: required("角色名称", 50),
  remark: optionalText("备注", 200),
  /**
   * 允许空数组：一个什么都不能进的角色是合法的（它就是"停用这个角色"的表达方式
   * ——`role` 表刻意没有 status 列，见 schema.ts）。
   */
  permissions: z.array(PermissionEnum).max(PERMISSION_KEYS.length),
};

export const CreateRoleInput = z.object(roleFields);

export const UpdateRoleInput = z.object({ id: roleId, ...roleFields });
