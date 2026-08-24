import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { fileMaxSizeBytes } from "../../infra/file-config";
import { contentDisposition } from "../../shared/content-disposition";
import { err, ok } from "../../shared/result";
import { validate } from "../../shared/validate";
import { requireUser } from "../auth";
import { findFileForRead, storeUploadedFile } from "./service";
import { FileParams, FileQuery, UploadFileInput } from "./validation";

const multipartOverheadBytes = 1024 * 1024;
const maxUploadBodyBytes = fileMaxSizeBytes + multipartOverheadBytes;

const validationError = (message: string) =>
  err({ code: "VALIDATION_ERROR" as const, message });

const uploadTooLarge = () =>
  validationError(
    `文件大小不能超过 ${Math.floor(fileMaxSizeBytes / 1024 / 1024)} MB`,
  );

// Uploads require a session. File reads remain public for browser previews and
// downloads.
export const fileRoutes = new Hono().post(
    "/upload",
    requireUser,
    bodyLimit({
      maxSize: maxUploadBodyBytes,
      onError: (c) => c.json(uploadTooLarge()),
    }),
    validate("form", UploadFileInput, (result, c) => {
      if (!result.success) {
        return c.json(
          validationError(result.error.issues[0]?.message ?? "上传参数不正确"),
        );
      }
    }),
    async (c) => {
      const { file } = c.req.valid("form");

      try {
        const row = await storeUploadedFile(file);
        return c.json(ok(row));
      } catch (error) {
        console.error("Failed to store uploaded file", error);
        return c.json(
          err({ code: "INTERNAL_ERROR", message: "文件上传失败" }),
        );
      }
    },
  )
  .get(
    "/:fileId",
    validate("param", FileParams, (result, c) => {
      if (!result.success) {
        return c.json(validationError("文件 ID 格式不正确"));
      }
    }),
    validate("query", FileQuery, (result, c) => {
      if (!result.success) {
        return c.json(validationError("download 参数不正确"));
      }
    }),
    async (c) => {
      const { fileId } = c.req.valid("param");
      const { download } = c.req.valid("query");

      try {
        const result = await findFileForRead(fileId);

        if (!result) {
          return c.json(
            err({ code: "NOT_FOUND", message: "文件不存在或尚未准备完成" }),
          );
        }

        c.header("Content-Type", result.file.mimeType);
        c.header("Content-Length", String(result.content.sizeBytes));
        c.header(
          "Content-Disposition",
          contentDisposition(result.file.originalName, download === "1"),
        );
        c.header("Cache-Control", "private, no-store");
        c.header("X-Content-Type-Options", "nosniff");

        return c.body(result.content.body);
      } catch (error) {
        console.error("Failed to read stored file", error);
        return c.json(err({ code: "INTERNAL_ERROR", message: "文件读取失败" }));
      }
    },
  );
