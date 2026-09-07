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
  INVALID_USERNAME_OR_PASSWORD: "账号或密码错误",
  // 服务端 auth.ts 的 databaseHooks.session.create.before 抛的。**必须有这一条**：
  // 没有它，被停用的人拿到的是"登录失败，请检查账号和密码"，然后会一直重试一个
  // 其实完全正确的密码。
  ACCOUNT_DISABLED: "该账号已被停用，请联系管理员",
  // 账号名不合法时 Better Auth 会直接返回这几个，而不是"账号或密码错误"——
  // 它们发生在查库之前，不构成账号是否存在的信息泄露。
  INVALID_USERNAME: "账号格式不正确",
  USERNAME_TOO_SHORT: "账号格式不正确",
  USERNAME_TOO_LONG: "账号格式不正确",
};

const getAuthErrorMessage = (authError: { code?: string }) =>
  (authError.code && AUTH_ERROR_MESSAGES[authError.code]) ??
  "登录失败，请检查账号和密码";

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
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // signIn.username 由 usernameClient() 插件提供（features/auth/auth-client.ts）。
    const { error: authError } = await authClient.signIn.username({
      username,
      password,
    });

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
            <CardDescription>使用账号和密码登录</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
              <div className="flex flex-col gap-2">
                <Label htmlFor="username">账号</Label>
                <div className="relative">
                  <UserIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="username"
                    className="pl-8"
                    // autoComplete="username" 让密码管理器认得出这是账号栏；
                    // 上一版是 type="email"，浏览器会拒绝填非邮箱格式的账号。
                    autoComplete="username"
                    placeholder="请输入账号"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
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
