import { ISSUER_VISUAL } from "./issuer-visual.ts";
import type { InvitationIssuer } from "./types.ts";

/**
 * 邀请函的"语义组装"结果——模板预览、生成邀请函预览、生成记录详情预览/导出
 * 共用同一份数据形状，只有唯一一处组装逻辑（这个函数）。旧系统是屏幕预览、
 * 导出 HTML、html2canvas 截图、docx 四份实现各自拼一遍，附件内容漏掉一处
 * 都没人发现；这里改成"先拼成结构化数据，再喂给渲染器"，结构上不会再漏字段。
 */
export type InvitationDocument = {
  issuer: InvitationIssuer;
  title: string;
  salutation: string;
  bodyHtml: string;
  annexTitle?: string | null;
  annexHtml?: string | null;
  contactPerson: string;
  contactPhone: string;
  signOff: string;
  issueDateText: string;
};

export type InvitationLetterSource = {
  issuer: InvitationIssuer;
  bodyContent: string;
  annexTitle?: string | null;
  annexContent?: string | null;
  contactPerson: string;
  contactPhone: string;
  signOff: string;
};

export function buildInvitationDocument(
  source: InvitationLetterSource,
  options: { recipientName?: string; issueDate?: string | Date } = {},
): InvitationDocument {
  const visual = ISSUER_VISUAL[source.issuer];
  const recipientName = options.recipientName?.trim() || "XXXX";

  return {
    issuer: source.issuer,
    title: "邀请函",
    salutation: visual.salutation(recipientName),
    bodyHtml: source.bodyContent,
    annexTitle: source.annexTitle,
    annexHtml: source.annexContent,
    contactPerson: source.contactPerson,
    contactPhone: source.contactPhone,
    signOff: source.signOff,
    issueDateText: formatIssueDate(options.issueDate ?? new Date()),
  };
}

/**
 * 手动拼日期文本而不是丢给 `Date` 再格式化——`new Date("2026-08-13")` 按 UTC
 * 零点解析，`.getDate()` 读的却是本地时区，西半球时区会整体回退一天。
 * 日期字符串直接拆字符串，不走时区转换。
 */
function formatIssueDate(value: string | Date): string {
  if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (match) return `${match[1]}年${match[2]}月${match[3]}日`;
    return value;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}年${pad(value.getMonth() + 1)}月${pad(value.getDate())}日`;
}
