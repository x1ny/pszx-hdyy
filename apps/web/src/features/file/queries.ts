import type { InferResponseType } from "hono/client";
import { type ApiData, api, unwrap } from "#/shared/lib/api";

export type UploadedFile = ApiData<
  InferResponseType<typeof api.api.uploadFile.$post>
>;

export const uploadFile = (file: File) =>
  unwrap(api.api.uploadFile.$post({ form: { file } }));

export const fileUrl = (fileId: string, download = false) =>
  api.api.file[":fileId"].$url({
    param: { fileId },
    query: { download: download ? "1" : "0" },
  }).toString();
