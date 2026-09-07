// 开发环境的固定账号。dev-seed/00-user.ts 用它建号，modules/auth/routes.dev.ts
// 用它签发 session —— 两边必须指向同一组值，所以放在 shared/（不认识任何业务，
// 谁都可以引用）。
//
// 这里的密码**不出现在任何面向人或 agent 的文档里**：需要登录态的调试一律走
// GET /api/dev/login，没有任何人需要手动敲它。
export const DEV_ACCOUNT = {
  // 登录标识是**账号**不是邮箱（username 插件），但 `routes.dev.ts` 的免密入口
  // 仍然走 signInEmail —— 邮箱在库里照样唯一且非空，用哪一个签 session 都行，
  // 保持原样能少改一处。
  username: "dev",
  email: "dev@example.com",
  // Better Auth 默认要求 8 位以上。
  password: "devdevdev",
  name: "开发账号",
} as const;
