// 开发环境的固定账号。dev-seed/00-user.ts 用它建号，modules/auth/routes.dev.ts
// 用它签发 session —— 两边必须指向同一组值，所以放在 shared/（不认识任何业务，
// 谁都可以引用）。
//
// 这里的密码**不出现在任何面向人或 agent 的文档里**：需要登录态的调试一律走
// GET /api/dev/login，没有任何人需要手动敲它。
export const DEV_ACCOUNT = {
  email: "dev@example.com",
  // Better Auth 默认要求 8 位以上。
  password: "devdevdev",
  name: "开发账号",
} as const;
