import { usernameClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * `usernameClient()` 必须和服务端的 `username()` 插件成对出现
 * （apps/server/src/modules/auth/auth.ts）——它给客户端加上
 * `authClient.signIn.username({ username, password })`。
 *
 * 少了它不会有类型错误提示得那么直白：`signIn.username` 干脆不存在，
 * 而 `signIn.email` 仍然在，很容易顺手改回邮箱登录。
 */
export const authClient = createAuthClient({
  plugins: [usernameClient()],
});
