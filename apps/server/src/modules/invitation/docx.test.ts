import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { unzipSync, zipSync } from "fflate";
import {
  DocxTemplateError,
  parseTemplateVariables,
  renderDocx,
} from "./docx";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** 最小可用的 docx：walk() 只要求 word/document.xml 存在。 */
const fakeDocx = (bodyXml: string) =>
  zipSync({
    "word/document.xml": encoder.encode(
      `<?xml version="1.0"?><w:document><w:body>${bodyXml}</w:body></w:document>`,
    ),
  });

const documentText = (docx: Uint8Array) => {
  const xml = decoder.decode(unzipSync(docx)["word/document.xml"] as Uint8Array);
  return [...xml.matchAll(/<w:t(?:\s[^>]*?)?>([\s\S]*?)<\/w:t>/g)]
    .map((match) => match[1])
    .join("");
};

const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`;

describe("占位符解析", () => {
  test("按文档从上到下的顺序返回，且去重", () => {
    const docx = fakeDocx(
      `<w:p>${run("{{姓名}}：")}</w:p>` +
        `<w:p>${run("联系人：{{联系人}}   联系电话：{{联系电话}}")}</w:p>` +
        `<w:p>${run("再次邀请 {{姓名}} 出席")}</w:p>`,
    );

    // 顺序必须是阅读顺序：表单字段按它排列，用户要能和文件对照着看。
    expect(parseTemplateVariables(docx)).toEqual([
      "姓名",
      "联系人",
      "联系电话",
    ]);
  });

  test("没有占位符时返回空数组", () => {
    expect(parseTemplateVariables(fakeDocx(`<w:p>${run("纯文本")}</w:p>`))).toEqual(
      [],
    );
  });

  test("名字两端的空白被裁掉", () => {
    expect(
      parseTemplateVariables(fakeDocx(`<w:p>${run("{{ 姓名 }}")}</w:p>`)),
    ).toEqual(["姓名"]);
  });
});

describe("跨 run 拆分的占位符", () => {
  // 这是整个模块存在的理由：Word 会把 {{姓名}} 切成多个 <w:t>（输入法、拼写
  // 检查、rsid 都会造成），朴素的字符串替换在真实文件上会静默失配。
  const split = fakeDocx(
    `<w:p>${run("{")}${run("{姓")}${run("名}")}${run("}：您好")}</w:p>`,
  );

  test("能被识别", () => {
    expect(parseTemplateVariables(split)).toEqual(["姓名"]);
  });

  test("能被正确替换，且不留下碎片", () => {
    const text = documentText(renderDocx(split, { 姓名: "陈明远" }));
    expect(text).toBe("陈明远：您好");
  });

  test("同一段落里多个拆分占位符互不干扰", () => {
    const docx = fakeDocx(
      `<w:p>${run("联系人：{")}${run("{联系人}}")}${run("  电话：{{联")}${run("系电话}}")}</w:p>`,
    );
    const text = documentText(
      renderDocx(docx, { 联系人: "萧美琪", 联系电话: "13067176616" }),
    );
    expect(text).toBe("联系人：萧美琪  电话：13067176616");
  });
});

describe("格式保留", () => {
  // 替换只改写 <w:t> 的内容，绝不碰 <w:rPr>。这条一旦破了，替换进去的人名会
  // 掉回默认字体——在一份「仿宋三号、固定 28 磅」的公函里非常刺眼，而且只有
  // 打开生成结果才看得见。
  const rPr =
    '<w:rPr><w:rFonts w:ascii="仿宋" w:eastAsia="仿宋"/><w:sz w:val="32"/></w:rPr>';

  test("被替换的 run 保留原有 rPr", () => {
    const docx = fakeDocx(`<w:p><w:r>${rPr}<w:t>{{姓名}}：</w:t></w:r></w:p>`);
    const xml = decoder.decode(
      unzipSync(renderDocx(docx, { 姓名: "陈明远" }))[
        "word/document.xml"
      ] as Uint8Array,
    );

    expect(xml).toContain(rPr);
    expect(xml).toContain("陈明远：");
  });

  test("跨 run 拆分时，值落在第一个 run 上，继承它的格式", () => {
    // Word 真实拆分 run 时会把 rPr 复制进每一个新 run，所以这里三个 run 同格式。
    const docx = fakeDocx(
      `<w:p>` +
        `<w:r>${rPr}<w:t>{</w:t></w:r>` +
        `<w:r>${rPr}<w:t>{姓名}</w:t></w:r>` +
        `<w:r>${rPr}<w:t>}：您好</w:t></w:r>` +
        `</w:p>`,
    );
    const xml = decoder.decode(
      unzipSync(renderDocx(docx, { 姓名: "陈明远" }))[
        "word/document.xml"
      ] as Uint8Array,
    );

    // 三个 run 的 rPr 都还在，且值整个落进了第一个。
    expect(xml.split(rPr).length - 1).toBe(3);
    expect(/<w:r>.*?陈明远.*?<\/w:r>/s.exec(xml)?.[0]).toContain(rPr);
    expect(documentText(renderDocx(docx, { 姓名: "陈明远" }))).toBe("陈明远：您好");
  });
});

describe("渲染", () => {
  test("值里的 XML 特殊字符被转义，不会破坏文档", () => {
    const docx = fakeDocx(`<w:p>${run("{{落款}}")}</w:p>`);
    const rendered = renderDocx(docx, { 落款: "A & B <公司>" });

    const xml = decoder.decode(
      unzipSync(rendered)["word/document.xml"] as Uint8Array,
    );
    expect(xml).toContain("A &amp; B &lt;公司&gt;");
    // 转义后仍是一份能解压、能再解析的 docx。
    expect(parseTemplateVariables(rendered)).toEqual([]);
  });

  test("首尾空格被保留（真实模板靠空格排版）", () => {
    const docx = fakeDocx(`<w:p>${run("{{联系人}}")}</w:p>`);
    const xml = decoder.decode(
      unzipSync(renderDocx(docx, { 联系人: "  萧美琪  " }))[
        "word/document.xml"
      ] as Uint8Array,
    );
    expect(xml).toContain('xml:space="preserve"');
    expect(documentText(renderDocx(docx, { 联系人: "  萧美琪  " }))).toBe(
      "  萧美琪  ",
    );
  });

  test("同名占位符出现多次时全部替换", () => {
    const docx = fakeDocx(
      `<w:p>${run("{{姓名}}：")}</w:p><w:p>${run("邀请{{姓名}}出席")}</w:p>`,
    );
    expect(documentText(renderDocx(docx, { 姓名: "陈明远" }))).toBe(
      "陈明远：邀请陈明远出席",
    );
  });

  test("缺变量时抛错而不是渲染成空白", () => {
    // 「变量缺失阻断本次生成」——一份落款空着的公函发出去，比生成失败糟糕得多。
    const docx = fakeDocx(`<w:p>${run("{{姓名}}{{落款}}")}</w:p>`);

    expect(() => renderDocx(docx, { 姓名: "陈明远" })).toThrow(
      DocxTemplateError,
    );
    expect(() => renderDocx(docx, { 姓名: "陈明远" })).toThrow(/\{\{落款\}\}/);
  });

  test("多余的取值不影响渲染", () => {
    const docx = fakeDocx(`<w:p>${run("{{姓名}}")}</w:p>`);
    expect(
      documentText(renderDocx(docx, { 姓名: "陈明远", 无关变量: "x" })),
    ).toBe("陈明远");
  });
});

describe("非法输入", () => {
  test("不是 zip 时报错", () => {
    expect(() => parseTemplateVariables(encoder.encode("not a zip"))).toThrow(
      DocxTemplateError,
    );
  });

  test("是 zip 但没有 document.xml 时提示可能是旧版 .doc", () => {
    const notDocx = zipSync({ "hello.txt": encoder.encode("hi") });
    expect(() => parseTemplateVariables(notDocx)).toThrow(/\.doc/);
  });
});

// ---------------------------------------------------------------------------
// 真实模板
//
// docs/模板/ 下是业务方给的三份真实文件。拿它们跑是有意义的：合成的 XML 永远
// 长成我们预期的样子，真实文件不会——落款「泉州市纺织服装商会 」在里面就是
// 被切成两个 run 的（尾部空格单独一个），朴素替换在这份文件上会直接失配。
// ---------------------------------------------------------------------------

const templatesDir = join(import.meta.dir, "../../../../../docs/模板");
const chamberPath = join(templatesDir, "泉州市纺织服装商会模板.docx");

describe.if(existsSync(chamberPath))("真实模板（商会）", () => {
  const load = async () =>
    new Uint8Array(await Bun.file(chamberPath).arrayBuffer());

  test("未标注占位符时解析出 0 个变量", async () => {
    expect(parseTemplateVariables(await load())).toEqual([]);
  });

  test("标注后能解析并渲染，不留残留", async () => {
    const files = unzipSync(await load());
    const xml = decoder
      .decode(files["word/document.xml"] as Uint8Array)
      .replaceAll("XXXX", "{{姓名}}");
    files["word/document.xml"] = encoder.encode(xml);
    const template = zipSync(files);

    expect(parseTemplateVariables(template)).toEqual(["姓名"]);

    const rendered = renderDocx(template, { 姓名: "陈明远先生" });
    const text = documentText(rendered);
    expect(text).toContain("陈明远先生");
    expect(text).not.toContain("XXXX");
    expect(parseTemplateVariables(rendered)).toEqual([]);
  });

  test("渲染后其它部件原样保留（嵌入字体、图片、批注）", async () => {
    const original = unzipSync(await load());
    const files = unzipSync(await load());
    files["word/document.xml"] = encoder.encode(
      decoder
        .decode(files["word/document.xml"] as Uint8Array)
        .replaceAll("XXXX", "{{姓名}}"),
    );
    const rendered = unzipSync(renderDocx(zipSync(files), { 姓名: "陈明远" }));

    // 模板里嵌了 4 个 odttf 字体和 1 张图，丢任何一个版式都会垮。
    for (const name of Object.keys(original)) {
      expect(Object.hasOwn(rendered, name)).toBe(true);
    }
    expect(
      Buffer.from(rendered["word/media/image1.png"] as Uint8Array).equals(
        Buffer.from(original["word/media/image1.png"] as Uint8Array),
      ),
    ).toBe(true);
  });
});
