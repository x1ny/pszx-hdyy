import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertCircleIcon, Loader2Icon, LockIcon, MailIcon, SparkleIcon, UserIcon } from "lucide-react";
import { useState } from "react";
import { authClient } from "#/features/auth/auth-client";
import { sessionQueryKey } from "#/features/auth/queries";
import { Alert, AlertDescription } from "#/shared/components/ui/alert.tsx";
import { Button } from "#/shared/components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/shared/components/ui/card.tsx";
import { Input } from "#/shared/components/ui/input.tsx";
import { Label } from "#/shared/components/ui/label.tsx";

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
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error: authError } =
      mode === "signIn"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ name, email, password });

    setLoading(false);

    if (authError) {
      setError(authError.message ?? "出错了,请重试");
      return;
    }

    // The route guard reads the session via ensureQueryData, which returns
    // cached data even when stale. Remove the logged-out entry so the guard
    // is forced to refetch instead of seeing the old null.
    queryClient.removeQueries({ queryKey: sessionQueryKey });
    navigate({ to: redirect || "/" });
  };

  const isSignUp = mode === "signUp";

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
            {isSignUp ? "创建账号" : "欢迎回来"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isSignUp ? "填写信息以创建一个新账号" : "登录以继续访问工作台"}
          </p>
        </div>

        <Card>
          <CardHeader className="sr-only">
            <CardTitle>{isSignUp ? "注册" : "登录"}</CardTitle>
            <CardDescription>
              {isSignUp ? "创建一个新账号" : "使用邮箱和密码登录"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
              {isSignUp && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="name">昵称</Label>
                  <div className="relative">
                    <UserIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="name"
                      className="pl-8"
                      placeholder="你的昵称"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                    />
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-2">
                <Label htmlFor="email">邮箱</Label>
                <div className="relative">
                  <MailIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="email"
                    className="pl-8"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
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
                    placeholder="至少 8 位"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={8}
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
                {isSignUp ? "创建账号" : "登录"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          {isSignUp ? "已有账号？" : "还没有账号？"}
          <button
            type="button"
            className="ml-1 font-medium text-foreground underline underline-offset-4 hover:text-primary"
            onClick={() => {
              setError(null);
              setMode(isSignUp ? "signIn" : "signUp");
            }}
          >
            {isSignUp ? "去登录" : "去注册"}
          </button>
        </p>
      </div>
    </div>
  );
}
