import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { api, unwrap } from "#/shared/lib/api.ts";
import type {
  InvitationBatchFilters,
} from "../-shared/types.ts";

export type {
  InvitationBatch,
  InvitationBatchFilters,
  InvitationBatchItem,
  InvitationBatchListItem,
} from "../-shared/types.ts";

export const invitationBatchKeys = {
  all: ["invitationBatch"] as const,
  list: (filters: InvitationBatchFilters) =>
    [...invitationBatchKeys.all, "list", filters] as const,
};

export const invitationBatchListQueryOptions = (filters: InvitationBatchFilters) =>
  queryOptions({
    queryKey: invitationBatchKeys.list(filters),
    queryFn: () => unwrap(api.api.invitation.batch.list.$post({ json: filters })),
    placeholderData: keepPreviousData,
  });

export const getInvitationBatch = (id: number) =>
  unwrap(api.api.invitation.batch.get.$post({ json: { id } }));

export const deleteInvitationBatch = (id: number) =>
  unwrap(api.api.invitation.batch.delete.$post({ json: { id } }));
