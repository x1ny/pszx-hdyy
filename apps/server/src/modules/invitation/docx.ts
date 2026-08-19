import { unzipSync, zipSync } from "fflate";

/**
 * .docx 模板的占位符解析与渲染。**纯函数，不碰数据库、不碰文件系统。**
 *
 * ── 为什么不用 docx-templates / docxtemplater ──────────────────────────────
 *
 * 两个库都能干这件事，但它们的模板指令本质是**可执行表达式**（docx-templates
 * 的 INS/EXEC 会把模板里的字符串当 JS 求值，`vm` 沙箱不是安全边界）。模板文件
 * 是用户上传的，等于开出一条「上传文件 → 服务端代码执行」的路径。
 *
 * 而按业务决策，正文写死在模板里、不做循环也不做表达式，我们需要的只有**单值
 * 字符串替换**。为这点需求引入一个会求值的模板引擎，风险和收益完全不成比例。
 * 顺带还省掉一个依赖：zip 读写用 fflate，批量下载打包本来也要用它。
 *
 * ── 真正的难点：Word 会把占位符拆散 ────────────────────────────────────────
 *
 * `{{姓名}}` 在 XML 里很可能长这样（输入法、拼写检查、rsid 都会造成这种切分）：
 *
 *   <w:r><w:t>{</w:t></w:r><w:r><w:t>{姓名}</w:t></w:r><w:r><w:t>}</w:t></w:r>
 *
 * 所以朴素的 `xml.replace("{{姓名}}", v)` 会静默失配——模板看着没问题，生成
 * 出来的文件里占位符原样躺着。下面的做法是：把同一段落内所有 <w:t> 的文本拼
 * 起来找占位符，再按原始偏移把结果分发回各个 <w:t>。
 */

const OPEN = "{{";
const CLOSE = "}}";

/** 占位符名允许除大括号外的任意字符，两端空白会被裁掉。 */
const PLACEHOLDER_RE = /\{\{([^{}]*)\}\}/g;

/**
 * `<w:t>` 的两种形态：带文本的和自闭合的。第二个捕获组对自闭合形态是
 * undefined —— 那种节点文本为空，但仍可能成为占位符的落点，不能跳过。
 */
const TEXT_NODE_RE = /<w:t(?:\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/w:t>)/g;

/**
 * 只处理正文和页眉页脚。
 *
 * 不碰 `word/comments.xml`：那三份真实模板的设计规格（「固定值 28 磅」
 * 「首行缩进 2 字符」）就写在批注里，把批注也替换掉既没意义，还会让规格说明
 * 变得看不懂。
 */
const isRenderablePart = (name: string) =>
  name === "word/document.xml" ||
  /^word\/(?:header|footer)\d*\.xml$/.test(name);

const decoder = new TextDecoder();
const encoder = new TextEncoder();

const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const unescapeXml = (value: string) =>
  value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

export class DocxTemplateError extends Error {}

type TextNode = {
  /** `<w:t` 在所属分片里的起始下标。 */
  tagStart: number;
  /** `</w:t>`（或自闭合 `/>`）结束后的下标。 */
  tagEnd: number;
  /** 节点的原始文本（仍是 XML 转义后的形态）。 */
  text: string;
};

/**
 * 按 `</w:p>` 切分。
 *
 * 用切分而不是正则匹配 `<w:p>...</w:p>`：文本框（`w:txbxContent`）里会嵌套
 * 段落，非贪婪匹配会把内外层配错对。切分的失效情形只有「占位符横跨内层段落
 * 结尾和外层段落剩余部分」，那本来就不是合法模板。
 *
 * 分段的意义是限制搜索范围：整份 XML 拉平搜索时，一个段落里漏写 `}}`
 * 会让匹配一路吃到下一个段落，产出一份看不出哪里错了的文件。
 */
const splitChunks = (xml: string) => xml.split("</w:p>");

function collectTextNodes(chunk: string): TextNode[] {
  const nodes: TextNode[] = [];
  TEXT_NODE_RE.lastIndex = 0;

  let match = TEXT_NODE_RE.exec(chunk);
  while (match) {
    nodes.push({
      tagStart: match.index,
      tagEnd: match.index + match[0].length,
      text: match[1] ?? "",
    });
    match = TEXT_NODE_RE.exec(chunk);
  }

  return nodes;
}

/** 拼接文本 + 每个节点文本在拼接串里的起始偏移。 */
function joinNodes(nodes: TextNode[]) {
  const offsets: number[] = [];
  let joined = "";

  for (const node of nodes) {
    offsets.push(joined.length);
    joined += node.text;
  }

  return { joined, offsets };
}

type Placeholder = { name: string; start: number; end: number };

function findPlaceholders(joined: string): Placeholder[] {
  const found: Placeholder[] = [];
  PLACEHOLDER_RE.lastIndex = 0;

  let match = PLACEHOLDER_RE.exec(joined);
  while (match) {
    found.push({
      name: unescapeXml(match[1] ?? "").trim(),
      start: match.index,
      end: match.index + match[0].length,
    });
    match = PLACEHOLDER_RE.exec(joined);
  }

  return found;
}

/**
 * 遍历每个 zip 部件的每个分片，把占位符交给 `onPlaceholder` 处理。
 *
 * 返回 `undefined` 表示不改写（解析场景）；返回字符串表示用它替换掉整个
 * `{{...}}`（渲染场景）。解析和渲染共用这一趟遍历，是为了保证「解析时报出
 * 哪些变量」和「渲染时认哪些变量」永远是同一套规则——两边各写一遍遍历逻辑，
 * 迟早出现模板页说有 4 个变量、生成时却报第 5 个没填。
 */
function walk(
  docx: Uint8Array,
  onPlaceholder: (name: string) => string | undefined,
): Uint8Array {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(docx);
  } catch {
    throw new DocxTemplateError("文件不是有效的 .docx（无法解压）");
  }

  if (!files["word/document.xml"]) {
    throw new DocxTemplateError(
      "文件不是有效的 .docx（缺少 word/document.xml）。旧版 .doc 需要先用 Word 另存为 .docx",
    );
  }

  for (const [name, bytes] of Object.entries(files)) {
    if (!isRenderablePart(name)) continue;

    const chunks = splitChunks(decoder.decode(bytes));
    let dirty = false;

    for (let c = 0; c < chunks.length; c++) {
      const chunk = chunks[c] as string;
      const nodes = collectTextNodes(chunk);
      if (nodes.length === 0) continue;

      const { joined, offsets } = joinNodes(nodes);
      const placeholders = findPlaceholders(joined);
      if (placeholders.length === 0) continue;

      const texts = nodes.map((node) => node.text);
      let chunkDirty = false;

      // 先**正序**问一遍取值，再**倒序**改写。
      //
      // 两趟不能合并：改写必须倒序（见下），但 onPlaceholder 有副作用——解析
      // 场景靠调用顺序决定变量清单的顺序，跟着倒序走就会把「按文档从上到下」
      // 变成从下到上，表单字段顺序和文件里的阅读顺序对不上。
      const values = placeholders.map((placeholder) =>
        onPlaceholder(placeholder.name),
      );

      // **倒序改写。** 每个占位符的落点都用「原始拼接串」里的偏移定位，倒序
      // 保证同一节点上更靠后的改写已经完成、不会让前面的偏移失效。
      for (let p = placeholders.length - 1; p >= 0; p--) {
        const { start, end } = placeholders[p] as Placeholder;
        const value = values[p];
        if (value === undefined) continue;

        const escaped = escapeXml(value);
        let first = true;

        for (let n = 0; n < nodes.length; n++) {
          const nodeStart = offsets[n] as number;
          const nodeEnd = nodeStart + (nodes[n] as TextNode).text.length;
          if (nodeEnd <= start || nodeStart >= end) continue;

          const localStart = Math.max(start, nodeStart) - nodeStart;
          const localEnd = Math.min(end, nodeEnd) - nodeStart;
          const current = texts[n] as string;

          // 值整个落到第一个覆盖到的节点上，其余覆盖节点只删不填——这样替换
          // 后的文本继承的是占位符**开头**那个 run 的字体/字号，符合直觉。
          texts[n] =
            current.slice(0, localStart) +
            (first ? escaped : "") +
            current.slice(localEnd);
          first = false;
        }

        chunkDirty = true;
      }

      if (!chunkDirty) continue;

      // 倒序重建，同样是为了不让前面节点的 tagStart/tagEnd 失效。
      let rebuilt = chunk;
      for (let n = nodes.length - 1; n >= 0; n--) {
        const node = nodes[n] as TextNode;
        const text = texts[n] as string;
        if (text === node.text) continue;

        // 一律加 xml:space="preserve"：替换进去的值可能带首尾空格（真实模板里
        // 「联系人：X      联系电话：Y」就是靠空格排版的），不加这个属性 Word
        // 会把它们吃掉。
        rebuilt =
          rebuilt.slice(0, node.tagStart) +
          `<w:t xml:space="preserve">${text}</w:t>` +
          rebuilt.slice(node.tagEnd);
      }

      chunks[c] = rebuilt;
      dirty = true;
    }

    if (dirty) {
      files[name] = encoder.encode(chunks.join("</w:p>"));
    }
  }

  return zipSync(files, { level: 6 });
}

/**
 * 列出模板里出现的所有占位符名，去重并保持首次出现的顺序。
 *
 * 顺序有意义：模板页和生成页的输入框按它排列，和文档里从上到下的阅读顺序
 * 一致，用户不用在表单和文件之间来回对照。
 */
export function parseTemplateVariables(docx: Uint8Array): string[] {
  const seen = new Set<string>();

  walk(docx, (name) => {
    if (name) seen.add(name);
    return undefined;
  });

  return [...seen];
}

/**
 * 用取值渲染一份 docx。
 *
 * **严格模式**：模板里出现了但 `values` 里没有的占位符会直接抛错，而不是渲染
 * 成空白。这正是「变量缺失阻断本次生成」（文档 §10 异常表）要的行为——一份
 * 落款空着的公函发出去，比生成失败糟糕得多。
 */
export function renderDocx(
  docx: Uint8Array,
  values: Record<string, string>,
): Uint8Array {
  const missing = new Set<string>();

  const rendered = walk(docx, (name) => {
    if (!name) {
      missing.add("(空占位符)");
      return undefined;
    }
    const value = values[name];
    if (value === undefined) {
      missing.add(name);
      return undefined;
    }
    return value;
  });

  if (missing.size > 0) {
    throw new DocxTemplateError(
      `模板里的这些变量没有取值：${[...missing].map((name) => `{{${name}}}`).join("、")}`,
    );
  }

  return rendered;
}

export { OPEN as PLACEHOLDER_OPEN, CLOSE as PLACEHOLDER_CLOSE };
