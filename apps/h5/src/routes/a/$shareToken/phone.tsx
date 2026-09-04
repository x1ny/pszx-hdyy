import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ApiError } from "#/shared/lib/api";
import { cn } from "#/shared/lib/utils";
import { Icon } from "./-components/icon";
import { itineraryKeys, submitPhone } from "./-queries";

export const Route = createFileRoute("/a/$shareToken/phone")({
  component: PhonePage,
});

/**
 * 进活动页前的手机号校验。
 *
 * **这不是一道很硬的门，也没打算装成很硬。** 凭证就是手机号本身：知道号码的人
 * 就能看到这个人的行程和司机电话。它挡住的是"光有转发来的链接、不知道任何号码"
 * 的人 —— 分享链接本来就会在群里转。真正挡住枚举要靠短信验证码，那是下一步，
 * 加的时候只需要在这一页和 `/api/h5Access/submitPhone` 之间插一步，行程页和
 * 所有业务接口都不用动。
 *
 * 校验通过后服务端下发一个 7 天的 HttpOnly cookie，前端不碰它 —— 所以这一页
 * **没法预填上次输的号码**（读不到）。7 天内不会再看到这一页，真看到了说明
 * cookie 已经没了，那时也预填不出来，代价基本是零。
 */
function PhonePage() {
  const { shareToken } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [mobile, setMobile] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState("");
  // 抖动动画单独一个 state：CSS 动画只在 class 被加上的那一刻播一次，连续输错
  // 同一个号码时 failure 一直有值、class 没变化，第二次就不会再抖。
  const [shaking, setShaking] = useState(false);

  /**
   * 是被守卫弹回来的、而且当时那个 cookie 里的号不在本活动名单里。
   *
   * 从 react-query 的缓存里读上一次失败 —— 守卫刚刚发过那个请求，错误就在缓存
   * 里，不用再打一次接口。**也刻意不走 URL 参数**：脱敏号码仍然是部分可识别的
   * 个人信息，不该出现在会被转发、被浏览器历史记录下来的地址里。
   */
  const lastError = queryClient.getQueryState(
    itineraryKeys.detail(shareToken),
  )?.error;
  const staleMobile =
    lastError instanceof ApiError ? lastError.maskedMobile : undefined;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!mobile.trim() || submitting) return;

    setSubmitting(true);
    setFailure("");
    try {
      await submitPhone(shareToken, mobile);
      // 缓存里存着守卫那次失败。必须**删掉**而不是 invalidate —— 留着的话
      // 行程页的 loader 会先撞见这条失败记录。
      queryClient.removeQueries({
        queryKey: itineraryKeys.detail(shareToken),
      });
      await navigate({ to: "/a/$shareToken", params: { shareToken } });
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : "网络异常，请重试";
      setFailure(message);
      setShaking(true);
    } finally {
      setSubmitting(false);
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

        {/* 换号提示。同一个号码在活动 A 有效、在活动 B 没有，是很常见的情形
            （比如家里两个人两个号，B 邀的是另一位），所以这里不能只报错，
            要让人看出来"系统现在用的是哪个号"。 */}
        {/* 一旦这次提交自己有了结果，就把它撤掉 —— 否则「当前号码…不在本活动
            名单」会和新报的「活动不存在或已结束」并排挂着，两句话指向不同的
            原因，用户不知道该信哪一句。 */}
        {staleMobile && !failure && (
          <p className="mt-3 rounded-lg bg-page px-3 py-2 text-caption text-ink-2">
            当前号码{" "}
            <span className="font-bold tabular-nums">{staleMobile}</span>{" "}
            不在本活动名单中，请换一个号码
          </p>
        )}

        <form onSubmit={submit} className="mt-6 w-full">
          <div
            className={cn(shaking && "animate-shake")}
            onAnimationEnd={() => setShaking(false)}
          >
            <input
              type="tel"
              inputMode="numeric"
              maxLength={11}
              value={mobile}
              onChange={(event) => {
                setMobile(event.target.value.replace(/\D/g, ""));
                setFailure("");
              }}
              placeholder="请输入手机号码"
              aria-label="手机号码"
              aria-invalid={Boolean(failure)}
              autoComplete="off"
              className={cn(
                "h-12 w-full rounded-xl border bg-surface px-4 text-center font-bold text-[0.9375rem] text-ink-1 tabular-nums outline-none transition-colors placeholder:font-normal placeholder:text-ink-4",
                failure ? "border-brand" : "border-line focus:border-brand",
              )}
            />
          </div>
          <div className="mt-1.5 min-h-4 text-brand text-caption">
            {failure}
          </div>
          <button
            type="submit"
            disabled={!mobile.trim() || submitting}
            className="mt-1 h-11 w-full rounded-xl bg-brand-gradient font-bold text-body text-white shadow-brand transition-transform active:scale-[0.97] disabled:opacity-40"
          >
            {submitting ? "验证中…" : "查看我的行程"}
          </button>
        </form>
      </div>
    </div>
  );
}
