/**
 * 邮箱在界面上是**选填**的，但库里 `user.email` 是 `notNull + unique`——那是
 * Better Auth 的要求，且它内部多条路径都假设这一列非空。
 *
 * 折中办法：没填邮箱时写一个占位值，读出来的时候再剥掉。**脏的地方只关在这两个
 * 函数里**，别处一律把 `toDisplayEmail()` 的结果当"用户填的邮箱"用。
 *
 * 不把列改成 nullable 的理由：那是偏离框架预期的改动，不会立刻报错，而会在某次
 * Better Auth 升级之后以"某条登录路径突然 500"的形式炸出来——和
 * `dev-seed/00-user.ts` 里那条"手写密码哈希会悄悄失配"是同一类问题。
 *
 * 域名用 `.invalid`：它是 RFC 2606 保留的顶级域，**保证永远不可能是真实可投递
 * 地址**，所以不存在"占位邮箱哪天撞上某个真人邮箱"导致唯一约束误伤的情况。
 */
const PLACEHOLDER_DOMAIN = "@local.invalid";

/**
 * 写库用：没填邮箱就按账号生成占位值。
 *
 * 账号本身唯一（`user.username` 有唯一约束），所以派生出来的占位邮箱也唯一——
 * 不需要额外加随机后缀。
 */
export const toStoredEmail = (email: string | undefined, username: string) =>
  email ?? `${username.toLowerCase()}${PLACEHOLDER_DOMAIN}`;

/** 读库用：占位值对外一律呈现为"没填"。 */
export const toDisplayEmail = (email: string | null) =>
  email && !email.endsWith(PLACEHOLDER_DOMAIN) ? email : null;
