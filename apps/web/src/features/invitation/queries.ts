import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { InferRequestType, InferResponseType } from "hono/client";
import { type ApiData, ApiError, api, unwrap } from "#/shared/lib/api";

// 邀请函域的查询/变更放 features/ 而不是某个路由的 -queries.ts：模板管理页住在
// /invitation/template，生成页和生成记录页住在活动详情下的 /project/.../invitations，
// 两边隔着整棵路由树，谁 import 谁都是跨路由深路径。同 features/resource。

// ---------------------------------------------------------------------------
// 类型（一律从接口反推，不手抄）
// ---------------------------------------------------------------------------

export type InvitationTemplate = ApiData<
  InferResponseType<typeof api.api.invitation.template.get.$post>
>;
export type InvitationTemplateStatus = InvitationTemplate["status"];

/** 上传 docx 时由服务端解析出来的变量契约。`kind` 决定它显不显示输入框。 */
export type InvitationTemplateVariable =
  InvitationTemplate["variables"][number];

export type InvitationTemplateFilters = InferRequestType<
  typeof api.api.invitation.template.list.$post
>["json"];

export type InvitationTemplateFormValues = InferRequestType<
  typeof api.api.invitation.template.create.$post
>["json"];

/** 详情：带 records 明细。 */
export type InvitationBatch = ApiData<
  InferResponseType<typeof api.api.invitation.batch.get.$post>
>;
export type InvitationBatchRecord =
  NonNullable<InvitationBatch>["records"][number];

/** 列表行：**不带 records**，两个接口的字段投影不一样，不能共用一个类型。 */
export type InvitationBatchListItem = ApiData<
  InferResponseType<typeof api.api.invitation.batch.list.$post>
>["list"][number];

export type InvitationBatchFilters = InferRequestType<
  typeof api.api.invitation.batch.list.$post
>["json"];

export type CreateInvitationBatchValues = InferRequestType<
  typeof api.api.invitation.batch.create.$post
>["json"];
export type InvitationRecipientType =
  CreateInvitationBatchValues["recipientType"];

// ---------------------------------------------------------------------------
// 二进制响应
// ---------------------------------------------------------------------------

/**
 * 下载/预览接口返回的是文件本身，不是 `{code,data}` 信封——但**失败时仍然是
 * 信封**（渲染失败、模板文件不见了都是业务结果）。所以先看 content-type 再决定
 * 怎么拆，不能无脑 `.blob()`：那样错误会变成一个 200 字节的、内容是 JSON 的
 * "文件"被浏览器下载下来。
 */
async function unwrapFile(request: Promise<Response>) {
  const response = await request;

  if (
    (response.headers.get("content-type") ?? "").includes("application/json")
  ) {
    const result = (await response.json()) as {
      code: string;
      message?: string;
    };
    throw new ApiError(result.code, result.message ?? "下载失败");
  }

  return { blob: await response.blob(), fileName: fileNameOf(response) };
}

/**
 * 从 Content-Disposition 取文件名，优先 RFC 5987 那段——中文文件名只在
 * `filename*=UTF-8''` 里是完整的，`filename=` 那段已经被服务端降级成下划线了。
 */
function fileNameOf(response: Response) {
  const header = response.headers.get("content-disposition") ?? "";

  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      // 服务端编码坏了也不该让下载整个失败，退回下面的兜底。
    }
  }

  return /filename="([^"]+)"/i.exec(header)?.[1] ?? "邀请函.docx";
}

/** 把 blob 交给浏览器下载。链接是临时的，用完必须 revoke，否则整页存活期间都占着内存。 */
export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// 模板
// ---------------------------------------------------------------------------

export const invitationTemplateKeys = {
  all: ["invitationTemplate"] as const,
  list: (filters: InvitationTemplateFilters) =>
    [...invitationTemplateKeys.all, "list", filters] as const,
};

export const invitationTemplateListQueryOptions = (
  filters: InvitationTemplateFilters,
) =>
  queryOptions({
    queryKey: invitationTemplateKeys.list(filters),
    queryFn: () =>
      unwrap(api.api.invitation.template.list.$post({ json: filters })),
    placeholderData: keepPreviousData,
  });

export const getInvitationTemplate = (id: number) =>
  unwrap(api.api.invitation.template.get.$post({ json: { id } }));

export const createInvitationTemplate = (
  values: InvitationTemplateFormValues,
) => unwrap(api.api.invitation.template.create.$post({ json: values }));

export const updateInvitationTemplate = (
  values: InvitationTemplateFormValues & { id: number },
) => unwrap(api.api.invitation.template.update.$post({ json: values }));

export const setInvitationTemplateStatus = (
  id: number,
  status: InvitationTemplateStatus,
) =>
  unwrap(api.api.invitation.template.setStatus.$post({ json: { id, status } }));

export const deleteInvitationTemplate = (id: number) =>
  unwrap(api.api.invitation.template.delete.$post({ json: { id } }));

/** 只解析不渲染：上传完立刻列出变量清单，不必先保存。 */
export const inspectInvitationTemplate = (templateFileId: string) =>
  unwrap(
    api.api.invitation.template.inspect.$post({ json: { templateFileId } }),
  );

/**
 * 预览同样吃 fileId 而不是 templateId：用户刚传完文件、还没保存时就要能看，
 * 不然就得先保存一个自己都没看过的模板。
 */
export const previewInvitationTemplate = (json: {
  templateFileId: string;
  /** 不传就用样例值（模板页）；传了就是即将生成出来的真实样子（生成页）。 */
  variables?: Record<string, string>;
  recipientName?: string;
  issueDate?: string;
}) =>
  unwrapFile(
    api.api.invitation.template.preview.$post({
      json,
    }) as unknown as Promise<Response>,
  );

// ---------------------------------------------------------------------------
// 生成 / 记录
// ---------------------------------------------------------------------------

export const invitationBatchKeys = {
  all: ["invitationBatch"] as const,
  list: (filters: InvitationBatchFilters) =>
    [...invitationBatchKeys.all, "list", filters] as const,
  detail: (id: number) => [...invitationBatchKeys.all, "detail", id] as const,
};

export const invitationBatchListQueryOptions = (
  filters: InvitationBatchFilters,
) =>
  queryOptions({
    queryKey: invitationBatchKeys.list(filters),
    queryFn: () =>
      unwrap(api.api.invitation.batch.list.$post({ json: filters })),
    placeholderData: keepPreviousData,
  });

export const getInvitationBatch = (id: number) =>
  unwrap(api.api.invitation.batch.get.$post({ json: { id } }));

export const createInvitationBatch = (values: CreateInvitationBatchValues) =>
  unwrap(api.api.invitation.batch.create.$post({ json: values }));

/** 生成页的默认值：该模板上一次生成时填的那组自定义变量。 */
export const getLastVariableValues = (templateId: number) =>
  unwrap(
    api.api.invitation.batch.lastVariables.$post({ json: { templateId } }),
  );

export const downloadInvitationRecord = (recordId: number) =>
  unwrapFile(
    api.api.invitation.record.download.$post({
      json: { recordId },
    }) as unknown as Promise<Response>,
  );

export const downloadInvitationBatch = (
  batchId: number,
  recipientIds?: number[],
  recipientType: InvitationRecipientType = "member",
) =>
  unwrapFile(
    api.api.invitation.batch.download.$post({
      json:
        recipientType === "organization"
          ? { batchId, organizationIds: recipientIds }
          : { batchId, memberIds: recipientIds },
    }) as unknown as Promise<Response>,
  );
