import { useState } from "react";
import { cn } from "#/shared/lib/utils";
import { DEMO_ACCESS_KEY, verifyAccessKey } from "../-data";
import { Icon } from "./icon";

/**
 * 进入行程前的手机号校验。
 *
 * **这不是安全边界，现在也不可能是。** 分享链接会被转发，光有链接就能看到
 * 别人的座位和司机电话，所以产品加了这道口子：只有主办方登记过的手机号才
 * 放行。但校验逻辑现在整个在前端（比一个常量），任何人打开 devtools 就能
 * 绕过——它现在只是这张界面的壳。
 *
 * 接后端时这里要变成「手机号 + 链接 token 一起发给 `/api/h5`，换回一个只
 * 能看这一份行程的凭证」，判断和数据都留在服务端；`sessionStorage` 那个标记
 * 也要换成那个凭证。身份体系还没定案，见 AGENTS.md「认证」。
 */
export function KeyGate({ onUnlock }: { onUnlock: () => void }) {
  const [key, setKey] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [failed, setFailed] = useState(false);
  // 抖动动画单独一个 state：CSS 动画只在 class 被加上的那一刻播一次，连续输错
  // 同一个号码时 failed 一直是 true、class 没变化，第二次就不会再抖。
  const [shaking, setShaking] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim() || verifying) return;
    setVerifying(true);
    setFailed(false);
    const ok = await verifyAccessKey(key);
    setVerifying(false);
    if (ok) {
      onUnlock();
    } else {
      setFailed(true);
      setShaking(true);
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col items-center justify-center bg-surface px-8">
      <div className="flex w-full animate-rise flex-col items-center text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-soft text-brand">
          <Icon name="lock-keyhole" size={24} />
        </span>
        <h1 className="mt-4 font-bold text-[1.0625rem] text-ink-1 leading-6">
          请输入手机号码
        </h1>
        <p className="mt-1.5 text-body text-ink-3">
          输入主办方登记的手机号码
          <br />
          即可查看你的专属行程
        </p>

        <form onSubmit={submit} className="mt-6 w-full">
          <div
            className={cn(shaking && "animate-shake")}
            onAnimationEnd={() => setShaking(false)}
          >
            <input
              type="tel"
              inputMode="numeric"
              maxLength={11}
              value={key}
              onChange={(e) => {
                setKey(e.target.value.replace(/\D/g, ""));
                setFailed(false);
              }}
              placeholder="请输入手机号码"
              aria-label="手机号码"
              aria-invalid={failed}
              autoComplete="off"
              className={cn(
                "h-12 w-full rounded-xl border bg-surface px-4 text-center font-bold text-[0.9375rem] text-ink-1 tabular-nums outline-none transition-colors placeholder:font-normal placeholder:text-ink-4",
                failed ? "border-brand" : "border-line focus:border-brand",
              )}
            />
          </div>
          <div className="mt-1.5 h-4 text-brand text-caption">
            {failed && "手机号不正确，请核对后重试"}
          </div>
          <button
            type="submit"
            disabled={!key.trim() || verifying}
            className="mt-1 h-11 w-full rounded-xl bg-brand-gradient font-bold text-body text-white shadow-brand transition-transform active:scale-[0.97] disabled:opacity-40"
          >
            {verifying ? "验证中…" : "查看我的行程"}
          </button>
        </form>

        {/* 演示用，接后端时连同 DEMO_ACCESS_KEY 一起删掉 */}
        <p className="mt-5 text-caption text-ink-4">
          演示手机号：
          <span className="font-bold tabular-nums">{DEMO_ACCESS_KEY}</span>
        </p>
      </div>
    </div>
  );
}
