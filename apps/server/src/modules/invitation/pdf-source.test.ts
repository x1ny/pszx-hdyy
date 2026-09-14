import { expect, test } from "bun:test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { prepareDocxForPdf } from "./pdf-source";

test("转换副本去掉子集字体引用，但保留原字节、字体名和图片", () => {
  const files = {
    "word/document.xml": strToU8(
      "<w:document><w:p><w:r><w:t>王芳</w:t></w:r></w:p></w:document>",
    ),
    "word/fontTable.xml": strToU8(
      '<w:fonts><w:font w:name="仿宋"><w:embedRegular r:id="rId1"/></w:font></w:fonts>',
    ),
    "word/media/logo.png": new Uint8Array([1, 2, 3]),
  };
  const source = zipSync(files);
  const before = source.slice();
  const converted = unzipSync(prepareDocxForPdf(source));
  expect(source).toEqual(before);
  expect(strFromU8(converted["word/fontTable.xml"] as Uint8Array)).toContain(
    'w:name="仿宋"',
  );
  expect(
    strFromU8(converted["word/fontTable.xml"] as Uint8Array),
  ).not.toContain("embedRegular");
  expect(converted["word/media/logo.png"]).toEqual(
    files["word/media/logo.png"],
  );
  expect(converted["word/document.xml"]).toEqual(files["word/document.xml"]);
});

test("只归一化狭窄的红色下划线空格段落，正文下划线不变", () => {
  const paragraph = (text: string) =>
    `<w:p><w:pPr><w:spacing w:line="20" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:color w:val="FF0000"/><w:u w:val="single"/><w:sz w:val="80"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
  const ordinary = paragraph("带下划线的正文");
  const source = zipSync({
    "word/document.xml": strToU8(
      `<w:document>${paragraph("   ")}${ordinary}</w:document>`,
    ),
  });
  const xml = strFromU8(
    unzipSync(prepareDocxForPdf(source))["word/document.xml"] as Uint8Array,
  );
  expect(xml).toContain('<w:bottom w:val="single" w:sz="16"');
  expect(xml).toContain(ordinary);
  expect(xml).not.toContain("<w:t>   </w:t>");
});
