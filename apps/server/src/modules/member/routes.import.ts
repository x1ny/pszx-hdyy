import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { err, ok } from "../../shared/result";
import { jsonBody, validate } from "../../shared/validate";
import { type AuthedVariables, requireUser } from "../auth";
import {
  commitMemberImport,
  hasMemberImportDatabaseCode,
  MemberImportCommitError,
  validateMemberImportRows,
} from "./import-service";
import {
  CommitMemberImportInput,
  MEMBER_IMPORT_MAX_FILE_BYTES,
  PreviewMemberImportInput,
  ValidateMemberImportInput,
} from "./import-validation";
import {
  createMemberImportTemplate,
  MEMBER_IMPORT_TEMPLATE_FILE_NAME,
  MemberImportWorkbookError,
  parseMemberImportWorkbook,
  XLSX_MIME_TYPE,
} from "./import-workbook";

const multipartBodyLimit = MEMBER_IMPORT_MAX_FILE_BYTES + 1024 * 1024;
const jsonBodyLimit = 12 * 1024 * 1024;

const validationError = (message: string) =>
  err({ code: "VALIDATION_ERROR" as const, message });

const bodyTooLarge = () => validationError("导入数据过大，请拆分文件后重试");

export const memberImportRoutes = new Hono<{ Variables: AuthedVariables }>()
  .use(requireUser)

  /** 下载全量人员导入使用的固定 XLSX 模板。 */
  .post("/getImportTemplate", async (c) => {
    const content = await createMemberImportTemplate();
    return c.json(
      ok({
        fileName: MEMBER_IMPORT_TEMPLATE_FILE_NAME,
        mimeType: XLSX_MIME_TYPE,
        contentBase64: Buffer.from(content).toString("base64"),
      }),
    );
  })

  /** 瞬时解析 XLSX 并返回可编辑的逐行校验结果；原文件不会落盘。 */
  .post(
    "/previewImport",
    bodyLimit({
      maxSize: multipartBodyLimit,
      onError: (c) => c.json(bodyTooLarge()),
    }),
    validate("form", PreviewMemberImportInput, (result, c) => {
      if (!result.success) {
        return c.json(
          validationError(result.error.issues[0]?.message ?? "导入文件不正确"),
        );
      }
    }),
    async (c) => {
      try {
        const rows = await parseMemberImportWorkbook(c.req.valid("form").file);
        return c.json(ok(await validateMemberImportRows(rows)));
      } catch (error) {
        if (error instanceof MemberImportWorkbookError) {
          return c.json(validationError(error.message));
        }
        throw error;
      }
    },
  )

  /** 预览表格编辑后重新执行字段、字典、团体和重复数据校验。 */
  .post(
    "/validateImport",
    bodyLimit({
      maxSize: jsonBodyLimit,
      onError: (c) => c.json(bodyTooLarge()),
    }),
    jsonBody(ValidateMemberImportInput),
    async (c) =>
      c.json(ok(await validateMemberImportRows(c.req.valid("json").rows))),
  )

  /** 再次权威校验后，原子写入全部人员及需要自动创建的团体。 */
  .post(
    "/commitImport",
    bodyLimit({
      maxSize: jsonBodyLimit,
      onError: (c) => c.json(bodyTooLarge()),
    }),
    jsonBody(CommitMemberImportInput),
    async (c) => {
      const { rows, acknowledgeWarnings } = c.req.valid("json");
      try {
        const result = await commitMemberImport(
          rows,
          c.get("authedUser").id,
          acknowledgeWarnings,
        );
        return c.json(ok(result));
      } catch (error) {
        if (error instanceof MemberImportCommitError) {
          return c.json(validationError(error.message));
        }
        if (hasMemberImportDatabaseCode(error, "23505")) {
          return c.json(
            validationError(
              "提交时发现证件信息已被其他操作占用，请重新校验后再导入",
            ),
          );
        }
        throw error;
      }
    },
  );
