import {
  AlignmentType,
  Document,
  ImageRun,
  type IParagraphOptions,
  Packer,
  Paragraph,
  type ParagraphChild,
  TextRun,
} from "docx";
import { ISSUER_VISUAL } from "./issuer-visual.ts";
import type { InvitationDocument } from "./document.ts";

// 正文/联系人/落款只用系统自带字体名（宋体/仿宋），不打包字体文件——
// docx 里的 font 只是告诉 Word/WPS「用这个名字的字体渲染」，不涉及分发字体
// 本身，跟旧版把方正小标宋简体/仿宋/华文行楷三款商业字体的 ttf 直接打进
// 前端包完全是两回事，没有版权问题。用户本机没装同名字体时会退回系统默认字体。
const BODY_FONT = "SimSun";
const CONTACT_FONT = "FangSong";

type RunFormat = { bold?: boolean; italics?: boolean; underline?: boolean };

/**
 * 唯一的 docx 生成入口。旧版还有一条 html2canvas 截图伪装成 .doc 的路径——
 * 本质是一张图片，不可编辑也不可搜索，且用到的三款商业字体打包分发有版权
 * 风险，这次直接去掉，只留这一条真正的可编辑 Word 导出。
 */
export async function exportInvitationDocx(
  doc: InvitationDocument,
  recipientName: string,
): Promise<void> {
  const visual = ISSUER_VISUAL[doc.issuer];
  const children: Paragraph[] = [];

  if (visual.logo) {
    const image = await loadImage(visual.logo);
    if (image) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 180 },
          children: [
            new ImageRun({ ...image, transformation: { width: 220, height: 62 } }),
          ],
        }),
      );
    }
  } else if (visual.headerText) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 160 },
        border: { bottom: { color: "C41A1A", size: 12, style: "single" } },
        children: [
          new TextRun({
            text: visual.headerText,
            font: BODY_FONT,
            bold: true,
            color: "C41A1A",
            size: 30,
          }),
        ],
      }),
    );
  }

  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 120, after: 420 },
      children: [
        new TextRun({
          text: doc.title,
          font: BODY_FONT,
          bold: true,
          size: 48,
          characterSpacing: 60,
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 220, line: 420 },
      children: [
        new TextRun({ text: doc.salutation, font: BODY_FONT, size: 32 }),
      ],
    }),
  );

  children.push(...htmlToParagraphs(doc.bodyHtml, { font: BODY_FONT, size: 30 }));

  const hasAnnex = !!doc.annexTitle?.trim() || !!doc.annexHtml?.trim();
  if (hasAnnex) {
    children.push(
      new Paragraph({
        spacing: { before: 200, after: 120 },
        children: [
          new TextRun({
            text: `附则${doc.annexTitle ? `：${doc.annexTitle}` : ""}`,
            font: BODY_FONT,
            bold: true,
            size: 28,
          }),
        ],
      }),
    );
    if (doc.annexHtml?.trim()) {
      children.push(...htmlToParagraphs(doc.annexHtml, { font: BODY_FONT, size: 26 }));
    }
  }

  children.push(
    new Paragraph({
      spacing: { before: 180, line: 420 },
      children: [
        new TextRun({
          text: `联系人：${doc.contactPerson || "-"}`,
          font: CONTACT_FONT,
          size: 28,
        }),
      ],
    }),
    new Paragraph({
      spacing: { line: 420 },
      children: [
        new TextRun({
          text: `联系电话：${doc.contactPhone || "-"}`,
          font: CONTACT_FONT,
          size: 28,
        }),
      ],
    }),
  );

  for (const line of (doc.signOff || "-").split(/\r?\n/)) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: { before: 80 },
        children: [new TextRun({ text: line, font: CONTACT_FONT, size: 28 })],
      }),
    );
  }
  children.push(
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { after: 160 },
      children: [
        new TextRun({ text: doc.issueDateText, font: CONTACT_FONT, size: 28 }),
      ],
    }),
  );

  if (visual.showWave) {
    const wave = await loadImage("/invitation/wave-deco.png");
    if (wave) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new ImageRun({ ...wave, transformation: { width: 420, height: 97 } }),
          ],
        }),
      );
    }
  }

  const docxDocument = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 794, right: 1080, bottom: 794, left: 1080 },
          },
        },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(docxDocument);
  downloadBlob(blob, `${doc.title}-${recipientName || "受邀嘉宾"}.docx`);
}

/**
 * 正文来自 Tiptap，标签集合是受控的（p/strong/em/u/ul/ol/li/blockquote/br），
 * 不需要通用 HTML→docx 转换器那种复杂度，按需处理这几种就够。
 */
function htmlToParagraphs(
  html: string,
  format: { font: string; size: number },
): Paragraph[] {
  const container = document.createElement("div");
  container.innerHTML = html;

  const collectRuns = (node: Node, active: RunFormat): ParagraphChild[] => {
    const runs: ParagraphChild[] = [];
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent ?? "";
        if (text) {
          runs.push(
            new TextRun({
              text,
              font: format.font,
              size: format.size,
              bold: active.bold,
              italics: active.italics,
              underline: active.underline ? {} : undefined,
            }),
          );
        }
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;

      const el = child as HTMLElement;
      const tag = el.tagName.toLowerCase();
      if (tag === "br") {
        runs.push(new TextRun({ text: "", break: 1 }));
        continue;
      }
      runs.push(
        ...collectRuns(el, {
          bold: active.bold || tag === "strong" || tag === "b",
          italics: active.italics || tag === "em" || tag === "i",
          underline: active.underline || tag === "u",
        }),
      );
    }
    return runs;
  };

  const paragraphs: Paragraph[] = [];
  const pushParagraph = (
    runs: ParagraphChild[],
    extra: Partial<IParagraphOptions> = {},
  ) => {
    paragraphs.push(
      new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        indent: { firstLine: 420 },
        spacing: { after: 180, line: 480 },
        children: runs.length
          ? runs
          : [new TextRun({ text: "", font: format.font, size: format.size })],
        ...extra,
      }),
    );
  };

  for (const node of Array.from(container.childNodes)) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    if (tag === "ul" || tag === "ol") {
      Array.from(el.children).forEach((item, index) => {
        const marker = tag === "ul" ? "•  " : `${index + 1}.  `;
        pushParagraph(
          [
            new TextRun({ text: marker, font: format.font, size: format.size }),
            ...collectRuns(item, {}),
          ],
          { indent: { left: 480, firstLine: 0 } },
        );
      });
      continue;
    }

    if (tag === "blockquote") {
      pushParagraph(collectRuns(el, { italics: true }), {
        indent: { left: 720, firstLine: 0 },
      });
      continue;
    }

    // p 及其它块级元素统一当普通段落处理。
    pushParagraph(collectRuns(el, {}));
  }

  return paragraphs.length
    ? paragraphs
    : [
        new Paragraph({
          children: [new TextRun({ text: "", font: format.font, size: format.size })],
        }),
      ];
}

async function loadImage(
  src: string,
): Promise<{ data: ArrayBuffer; type: "png" | "jpg" } | undefined> {
  try {
    const response = await fetch(src);
    if (!response.ok) return undefined;
    const blob = await response.blob();
    const type = blob.type.includes("jpeg") || blob.type.includes("jpg") ? "jpg" : "png";
    return { data: await blob.arrayBuffer(), type };
  } catch {
    return undefined;
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
