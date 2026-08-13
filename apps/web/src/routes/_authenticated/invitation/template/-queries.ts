import { api, unwrap } from "#/shared/lib/api.ts";
import type {
  InvitationTemplateFormValues,
  InvitationTemplateStatus,
} from "../-shared/types.ts";

export type {
  InvitationTemplate,
  InvitationTemplateFilters,
  InvitationTemplateFormValues,
  InvitationTemplateStatus,
} from "../-shared/types.ts";

// "浏览/查详情"在 -shared/template-queries.ts（生成页也要用），这里只重新
// 导出、加上仅本页面用的新增/修改/启用停用/删除。
export {
  getInvitationTemplate,
  invitationTemplateKeys,
  invitationTemplateListQueryOptions,
} from "../-shared/template-queries.ts";

export const createInvitationTemplate = (values: InvitationTemplateFormValues) =>
  unwrap(api.api.createInvitationTemplate.$post({ json: values }));

export const updateInvitationTemplate = (
  values: InvitationTemplateFormValues & { id: number },
) => unwrap(api.api.updateInvitationTemplate.$post({ json: values }));

export const setInvitationTemplateStatus = (
  id: number,
  status: InvitationTemplateStatus,
) => unwrap(api.api.setInvitationTemplateStatus.$post({ json: { id, status } }));

export const deleteInvitationTemplate = (id: number) =>
  unwrap(api.api.deleteInvitationTemplate.$post({ json: { id } }));
