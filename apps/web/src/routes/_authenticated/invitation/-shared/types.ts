import type { InferRequestType, InferResponseType } from "hono/client";
import { type ApiData, api } from "#/shared/lib/api.ts";

// 领域类型从接口反推，不手抄——同 supplier/-queries.ts 的做法。
// template/、generate/、batch/ 三个页面共用这份类型，放在 -shared/ 而不是
// 某一个页面的 -queries.ts 里，避免其它页面反过来 import 兄弟路由的私有目录。

export type InvitationTemplate = ApiData<
  InferResponseType<typeof api.api.invitation.template.get.$post>
>;
export type InvitationIssuer = InvitationTemplate["issuer"];
export type InvitationTemplateStatus = InvitationTemplate["status"];

export type InvitationTemplateFilters = InferRequestType<
  typeof api.api.invitation.template.list.$post
>["json"];

export type InvitationTemplateFormValues = InferRequestType<
  typeof api.api.invitation.template.create.$post
>["json"];

/** 详情：getInvitationBatch 的响应，带 items 明细。 */
export type InvitationBatch = ApiData<
  InferResponseType<typeof api.api.invitation.batch.get.$post>
>;
export type InvitationBatchItem = InvitationBatch["items"][number];

/** 列表行：listInvitationBatches 的响应，**不带 items**——两个接口投影的字段不一样，不能共用一个类型。 */
export type InvitationBatchListItem = ApiData<
  InferResponseType<typeof api.api.invitation.batch.list.$post>
>["list"][number];

export type InvitationBatchFilters = InferRequestType<
  typeof api.api.invitation.batch.list.$post
>["json"];

export type CreateInvitationBatchValues = InferRequestType<
  typeof api.api.invitation.batch.create.$post
>["json"];
