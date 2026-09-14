import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

/**
 * 只处理 PDF 转换副本。商会模板含子集字体和用下划线空格画的红线：
 * LibreOffice 会把不在子集内的新字画成空白，也不会按 Word 拉伸空格。
 * 去掉字体嵌入引用（保留字体名，让服务器完整字体/回退字体接管），
 * 将这种狭窄的纯装饰段落改为底边框；普通正文下划线与原始 DOCX 不变。
 * 前端 Canvas 预览有同类适配，但不能从后端导入浏览器实现。
 */
export function prepareDocxForPdf(bytes: Uint8Array): Uint8Array {
  const files = unzipSync(bytes);
  const fonts = files["word/fontTable.xml"];
  if (fonts) {
    files["word/fontTable.xml"] = strToU8(
      strFromU8(fonts).replace(
        /<(?:\w+:)?embed(?:Regular|Bold|Italic|BoldItalic)\b[^>]*\/>/g,
        "",
      ),
    );
  }
  for (const name of Object.keys(files)) {
    if (
      name !== "word/document.xml" &&
      !/^word\/(?:header|footer)\d*\.xml$/.test(name)
    )
      continue;
    files[name] = strToU8(
      strFromU8(files[name] as Uint8Array).replace(
        /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g,
        (paragraph) => {
          const texts = [
            ...paragraph.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g),
          ];
          const spacing = paragraph.match(/<w:spacing\b[^>]*\/>/)?.[0];
          const line = Number(spacing?.match(/w:line=["'](\d+)["']/)?.[1]);
          if (
            !texts.length ||
            /<w:(?:drawing|pict|object|tab|br|fldChar|instrText)\b/.test(
              paragraph,
            ) ||
            texts.some((text) => !/^\s*$/.test(text[1] ?? "")) ||
            !/<w:u\b[^>]*w:val=["']single["']/.test(paragraph) ||
            !/<w:color\b[^>]*w:val=["']FF0000["']/i.test(paragraph) ||
            !spacing ||
            !/w:lineRule=["']exact["']/.test(spacing) ||
            !Number.isFinite(line) ||
            line > 100 ||
            paragraph.includes("<w:pBdr")
          )
            return paragraph;
          const properties = paragraph.match(
            /<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/,
          )?.[0];
          if (!properties) return paragraph;
          const size = Math.max(
            0,
            ...[...paragraph.matchAll(/<w:sz\b[^>]*w:val=["'](\d+)["']/g)].map(
              (match) => Number(match[1]),
            ),
          );
          const border = `<w:pBdr><w:bottom w:val="single" w:sz="${size >= 40 ? Math.ceil(size / 5) : 4}" w:space="0" w:color="FF0000"/></w:pBdr>`;
          return paragraph
            .replace(
              properties,
              properties.replace("</w:pPr>", `${border}</w:pPr>`),
            )
            .replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, "");
        },
      ),
    );
  }
  return zipSync(files, { level: 1 });
}
