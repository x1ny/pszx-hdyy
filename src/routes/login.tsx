import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "#/lib/auth-client";

export const Route = createFileRoute("/login")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { redirect?: string } => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  component: Login,
});

function Login() {
  const navigate = useNavigate();
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

    navigate({ to: redirect || "/" });
  };

  return (
    <div className="mx-auto max-w-sm p-8">
      <h1 className="text-2xl font-bold">
        {mode === "signIn" ? "登录" : "注册"}
      </h1>

      <form className="mt-4 flex flex-col gap-3" onSubmit={handleSubmit}>
        {mode === "signUp" && (
          <input
            className="rounded border px-3 py-2"
            placeholder="昵称"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        )}
        <input
          className="rounded border px-3 py-2"
          type="email"
          placeholder="邮箱"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="rounded border px-3 py-2"
          type="password"
          placeholder="密码(至少 8 位)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />

        {error && <p className="text-sm text-red-500">{error}</p>}

        <button
          type="submit"
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
          disabled={loading}
        >
          {mode === "signIn" ? "登录" : "注册"}
        </button>
      </form>

      <button
        type="button"
        className="mt-4 text-sm text-gray-500 underline"
        onClick={() => {
          setError(null);
          setMode(mode === "signIn" ? "signUp" : "signIn");
        }}
      >
        {mode === "signIn" ? "还没有账号？去注册" : "已有账号？去登录"}
      </button>
    </div>
  );
}
