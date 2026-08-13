import { api, unwrap } from "#/shared/lib/api.ts";
import {
  getInvitationTemplate,
  invitationTemplateListQueryOptions,
} from "../-shared/template-queries.ts";
import type { CreateInvitationBatchValues } from "../-shared/types.ts";

export type { CreateInvitationBatchValues } from "../-shared/types.ts";
export { getInvitationTemplate, invitationTemplateListQueryOptions };

export const createInvitationBatch = (values: CreateInvitationBatchValues) =>
  unwrap(api.api.createInvitationBatch.$post({ json: values }));
