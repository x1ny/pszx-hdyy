import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const dateTimeFormat = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * 接口给的是 ISO 字符串（timestamptz 序列化的结果），按浏览器本地时区展示。
 *
 * 放在 shared/ 是因为它**不认识任何业务**，而且消费方早就不止两个：写这行的时候
 * 仓库里已经有 5 份各自抄的实现（supplier / venue 的 `-utils.ts`，features 下的
 * invitation / member / project）。按 AGENTS.md 的判据（纯 UI 容忍到第 3 个）
 * 早该提上来，所以新代码一律用这一份，不要再往页面目录里抄第 6 份。
 *
 * 存量那 5 处的收敛是另一件事——它们的签名并不完全一致（member 的带参数，
 * project 的收 `string | Date`），不是原地替换就能完。
 */
export const formatDateTime = (iso: string | null | undefined) =>
  iso ? dateTimeFormat.format(new Date(iso)) : "-";
