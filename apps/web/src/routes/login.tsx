import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  AlertCircleIcon,
  Loader2Icon,
  LockIcon,
  SparkleIcon,
  UserIcon,
} from "lucide-react";
import { useState } from "react";
import { authClient } from "#/features/auth/auth-client";
import { sessionQueryKey } from "#/features/auth/queries";
import { Alert, AlertDescription } from "#/shared/components/ui/alert.tsx";
import { Button } from "#/shared/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/shared/components/ui/card.tsx";
import { Input } from "#/shared/components/ui/input.tsx";
import { Label } from "#/shared/components/ui/label.tsx";

/**
 * Better Auth 的错误码 → 中文文案。
 *
 * **注册相关的码全部删掉了**：本系统不开放自助注册（拦截在 apps/server 的
 * index.ts），账号一律由管理员在 /system/user 创建。留着那几条只会让下一个人
 * 以为注册入口还在某处。
 */
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  // 两条路径（账号 / 邮箱）的"没匹配上"都收敛到同一句文案。**必须一致**：
  // 一边说"账号或密码错误"另一边说"邮箱或密码错误"，等于告诉试探的人他猜中的是
  // 哪一类标识。
  INVALID_USERNAME_OR_PASSWORD: "账号或密码错误",
  INVALID_EMAIL_OR_PASSWORD: "账号或密码错误",
  // 服务端 auth.ts 的 databaseHooks.session.create.before 抛的。**必须有这一条**：
  // 没有它，被停用的人拿到的是"登录失败"，然后会一直重试一个其实完全正确的密码。
  ACCOUNT_DISABLED: "该账号已被停用，请联系管理员",
  // 标识格式不合法时 Better Auth 在查库之前就返回，不构成"这个账号存不存在"的
  // 信息泄露，所以可以说得具体一点。
  INVALID_USERNAME: "账号格式不正确",
  USERNAME_TOO_SHORT: "账号格式不正确",
  USERNAME_TOO_LONG: "账号格式不正确",
  INVALID_EMAIL: "邮箱格式不正确",
};

const getAuthErrorMessage = (authError: { code?: string }) =>
  (authError.code && AUTH_ERROR_MESSAGES[authError.code]) ?? "登录失败，请重试";

/**
 * 输入的是邮箱还是账号？
 *
 * 判据是"含不含 `@`"，而这个判据是**可靠的**，不是凑合：账号名的字符集是
 * `[a-zA-Z0-9_.]`（服务端 validation.ts 和 username 插件都这么校验），`@` 不在里面
 * ——所以一个合法账号名永远不含 `@`，一个邮箱永远含 `@`，两者不可能混淆。
 */
const looksLikeEmail = (identifier: string) => identifier.includes("@");

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  component: Login,
});

function Login() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { redirect } = Route.useSearch();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // 账号和邮箱是 Better Auth 的**两个端点**（`/sign-in/username` 由 username
    // 插件提供，`/sign-in/email` 是内置的，插件只新增不替换），没有一个"通用标识"
    // 入口，所以在这里分流。
    //
    // 邮箱这条路留着是为了**关闭自助注册之前建的老账号**：它们没有 username 列，
    // 但邮箱和密码都完好，不给这条路它们就直接进不来了。
    const trimmed = identifier.trim();
    const { error: authError } = looksLikeEmail(trimmed)
      ? await authClient.signIn.email({ email: trimmed, password })
      : await authClient.signIn.username({ username: trimmed, password });

    setLoading(false);

    if (authError) {
      setError(getAuthErrorMessage(authError));
      return;
    }

    // The route guard reads the session via ensureQueryData, which returns
    // cached data even when stale. Remove the logged-out entry so the guard
    // is forced to refetch instead of seeing the old null.
    queryClient.removeQueries({ queryKey: sessionQueryKey });
    navigate({ to: redirect || "/" });
  };

  return (
    <div className="relative flex min-h-svh items-center justify-center overflow-hidden bg-background p-6">
      <div
        aria-hidden
        className="-z-10 absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,color-mix(in_oklch,var(--primary),transparent_88%),transparent_60%)]"
      />

      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <SparkleIcon className="size-5" />
          </div>
          <h1 className="font-heading text-xl font-semibold tracking-tight">
            欢迎回来
          </h1>
          <p className="text-sm text-muted-foreground">登录以继续访问工作台</p>
        </div>

        <Card>
          <CardHeader className="sr-only">
            <CardTitle>登录</CardTitle>
            <CardDescription>使用账号或邮箱登录</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
              <div className="flex flex-col gap-2">
                <Label htmlFor="identifier">账号 / 邮箱</Label>
                <div className="relative">
                  <UserIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="identifier"
                    className="pl-8"
                    // autoComplete="username" 是**账号栏**的标准值，跟邮箱无关，
                    // 密码管理器认的就是它。注意不能写 type="email"：那会让浏览器
                    // 拒绝提交非邮箱格式的账号名。
                    autoComplete="username"
                    placeholder="请输入账号或邮箱"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="password">密码</Label>
                <div className="relative">
                  <LockIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    className="pl-8"
                    type="password"
                    autoComplete="current-password"
                    placeholder="请输入密码"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertCircleIcon />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" className="mt-1 w-full" disabled={loading}>
                {loading && <Loader2Icon className="animate-spin" />}
                登录
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* 原来这里是「还没有账号？去注册」。注册入口整个删掉了——服务端
            /api/auth/sign-up/* 已经被拦死，留一个点了必然失败的按钮只会让人以为
            系统坏了。忘记密码同理：现在的流程是找管理员在用户管理里重置。 */}
        <p className="text-center text-sm text-muted-foreground">
          忘记密码或需要开通账号，请联系系统管理员。
        </p>
      </div>
    </div>
  );
}
