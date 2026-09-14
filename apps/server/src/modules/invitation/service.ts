import { readFileBytes } from "../file/service";
import { DocxTemplateError, parseTemplateVariables, renderDocx } from "./docx";
import {
  INVITATION_SYSTEM_VARIABLES,
  type InvitationTemplateVariable,
  type InvitationVariableValues,
} from "./schema";

const SYSTEM_VARIABLE_SET = new Set<string>(INVITATION_SYSTEM_VARIABLES);

export const isSystemVariable = (name: string) => SYSTEM_VARIABLE_SET.has(name);

/**
 * 解析结果 → 变量契约。
 *
 * 分类规则就是「名字在不在白名单里」，没有第二套语法。写错字（`{{名字}}`）
 * 会落到 custom 一侧，在模板页上表现为「多出一个要填的变量」——用户一眼能
 * 看出自己写错了，比静默当成系统变量然后填不上值好得多。
 */
export const classifyVariables = (
  names: string[],
): InvitationTemplateVariable[] =>
  names.map((name) => ({
    name,
    kind: isSystemVariable(name) ? "system" : "custom",
  }));

export const customVariableNames = (variables: InvitationTemplateVariable[]) =>
  variables.filter((item) => item.kind === "custom").map((item) => item.name);

/**
 * 发函日期的中文写法。
 *
 * 月/日**不补零**——真实模板里写的是「2026年3月16日」，不是「2026年03月16日」。
 *
 * 手动拆字符串而不是丢给 Date：`new Date("2026-08-19")` 按 UTC 零点解析，
 * `.getDate()` 读的却是本地时区，西半球会整体回退一天。
 */
export function formatIssueDate(isoDate: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!match) return isoDate;

  return `${match[1]}年${Number(match[2])}月${Number(match[3])}日`;
}

/**
 * 预览用的假数据。
 *
 * 自定义变量填成 `【变量名】`，让用户一眼看出每个变量落在版面的哪个位置——
 * 这正是预览要回答的问题。填成空字符串的话，占位符消失了反而看不出来。
 */
export function buildSampleValues(
  variables: InvitationTemplateVariable[],
  today = new Date(),
): InvitationVariableValues {
  const pad = (n: number) => String(n).padStart(2, "0");
  const isoToday = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  const values: InvitationVariableValues = {};
  for (const { name, kind } of variables) {
    if (kind === "custom") {
      values[name] = `【${name}】`;
      continue;
    }
    values[name] = name === "发函日期" ? formatIssueDate(isoToday) : "张三";
  }

  return values;
}

/** 渲染一份邀请函时喂给模板的完整取值：批次填的自定义变量 + 收件对象系统变量。 */
export function buildRenderValues(input: {
  variables: InvitationVariableValues;
  recipientName: string;
  issueDate: string;
}): InvitationVariableValues {
  return {
    ...input.variables,
    姓名: input.recipientName,
    发函日期: formatIssueDate(input.issueDate),
  };
}

/** Windows 和 zip 都不接受这些字符；中文和空格保留。 */
const sanitizeSegment = (value: string) =>
  value
    .replace(/[\\/:*?"<>|\r\n]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim() || "未命名";

const templateFileBaseName = (fileName: string) => {
  const name = fileName.split(/[\\/]/).at(-1)?.trim() || "模板";
  const extensionIndex = name.lastIndexOf(".");
  return extensionIndex > 0 ? name.slice(0, extensionIndex) : name;
};

/**
 * 单个文件命名：模板文件名主体——收件对象姓名。
 *
 * 模板文件名本身通常带 `.docx` 扩展名，生成文件统一补回一个 `.docx`，避免出现
 * `模板.docx——张三.docx` 这样的重复扩展名。
 */
export function buildInvitationFileName(input: {
  templateFileName: string;
  recipientName: string;
}) {
  return `${sanitizeSegment(templateFileBaseName(input.templateFileName))}——${sanitizeSegment(input.recipientName)}.docx`;
}

export type TemplateFileLoad =
  | { ok: true; bytes: Uint8Array; originalName: string }
  | { ok: false; message: string };

/** 读回模板文件字节，把「文件不见了 / 还没上传完」翻译成业务错误。 */
export async function loadTemplateFile(
  fileId: string,
): Promise<TemplateFileLoad> {
  const found = await readFileBytes(fileId);
  if (!found) {
    return { ok: false, message: "模板文件不存在或尚未上传完成" };
  }

  return {
    ok: true,
    bytes: found.bytes,
    originalName: found.file.originalName,
  };
}

export type TemplateInspection =
  | { ok: true; variables: InvitationTemplateVariable[] }
  | { ok: false; message: string };

/**
 * 上传时的解析 + 试渲染校验。
 *
 * 试渲染这一步不能省：解析只证明「找得到占位符」，试渲染才证明「改写完还是
 * 一份完整的 docx」。不在这里挡住，坏模板要等到某次真的生成 82 份时才炸，
 * 而那时用户面对的是一句和上传动作毫无关联的报错。
 */
export function inspectTemplate(bytes: Uint8Array): TemplateInspection {
  try {
    const variables = classifyVariables(parseTemplateVariables(bytes));
    renderDocx(bytes, buildSampleValues(variables));
    return { ok: true, variables };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof DocxTemplateError
          ? error.message
          : "模板文件解析失败，请确认是由 Word 正常保存的 .docx",
    };
  }
}

export { DocxTemplateError, renderDocx };
