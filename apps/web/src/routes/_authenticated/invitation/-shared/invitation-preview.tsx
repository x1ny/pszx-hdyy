import { ISSUER_VISUAL } from "./issuer-visual.ts";
import type { InvitationDocument } from "./document.ts";

/** 模板预览、生成预览、记录详情预览共用的邀请函版面，只吃结构化的 InvitationDocument。 */
export function InvitationPreview({ doc }: { doc: InvitationDocument }) {
  const visual = ISSUER_VISUAL[doc.issuer];
  const hasAnnex = !!doc.annexTitle?.trim() || !!doc.annexHtml?.trim();

  return (
    <div className="mx-auto max-w-2xl rounded-lg border bg-white p-10 text-neutral-900 shadow-sm">
      {visual.logo ? (
        <div className="mb-4 flex justify-center">
          {/** biome-ignore lint/performance/noImgElement: 静态资产直接展示，不走 next/image 之类的优化管线 */}
          <img src={visual.logo} alt={visual.label} className="h-14" />
        </div>
      ) : visual.headerText ? (
        <div className="mb-4 border-b-2 border-red-700 pb-2 text-center font-semibold text-lg text-red-700">
          {visual.headerText}
        </div>
      ) : null}

      <h2 className="mb-8 text-center font-semibold text-3xl tracking-[0.3em]">
        {doc.title}
      </h2>

      <div className="mb-6 font-medium text-lg">{doc.salutation}</div>

      <div
        className="prose prose-neutral prose-p:my-2 max-w-none text-justify text-base leading-8"
        // 正文来自 Tiptap 富文本，只启用了加粗/斜体/下划线/列表/引用，
        // 没有插图/脚本/超链接扩展，标签集合是受控的。
        // biome-ignore lint/security/noDangerouslySetInnerHtml: Tiptap 输出的受控 HTML，见上
        dangerouslySetInnerHTML={{ __html: doc.bodyHtml }}
      />

      <div className="mt-10 text-neutral-600 text-sm">
        <div>联系人：{doc.contactPerson || "-"}</div>
        <div>联系电话：{doc.contactPhone || "-"}</div>
      </div>

      <div className="mt-16 text-right">
        <div className="whitespace-pre-line font-medium">
          {doc.signOff || "-"}
        </div>
        <div className="mt-2 text-neutral-600">{doc.issueDateText}</div>
      </div>

      {hasAnnex ? (
        <div className="mt-10 border-t pt-6">
          {doc.annexTitle ? (
            <div className="mb-2 font-semibold">附则{doc.annexTitle ? `：${doc.annexTitle}` : ""}</div>
          ) : null}
          {doc.annexHtml ? (
            <div
              className="prose prose-neutral prose-p:my-2 max-w-none text-sm leading-7"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: 同上，受控的 Tiptap 输出
              dangerouslySetInnerHTML={{ __html: doc.annexHtml }}
            />
          ) : null}
        </div>
      ) : null}

      {visual.showWave ? (
        <div className="mt-8 flex justify-center">
          {/** biome-ignore lint/performance/noImgElement: 同上 */}
          <img
            src="/invitation/wave-deco.png"
            alt=""
            aria-hidden
            className="max-w-full"
          />
        </div>
      ) : null}
    </div>
  );
}
