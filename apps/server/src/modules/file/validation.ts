import { z } from "zod";
import { fileMaxSizeBytes } from "../../infra/file-config";

export const UploadFileInput = z.object({
  file: z
    .file({ error: "请选择要上传的文件" })
    .min(1, { error: "不能上传空文件" })
    .max(fileMaxSizeBytes, {
      error: `文件大小不能超过 ${Math.floor(fileMaxSizeBytes / 1024 / 1024)} MB`,
    }),
});

export const FileParams = z.object({
  fileId: z.uuid({ error: "文件 ID 格式不正确" }),
});

export const FileQuery = z.object({
  download: z.enum(["0", "1"], { error: "download 参数不正确" }).optional(),
});
