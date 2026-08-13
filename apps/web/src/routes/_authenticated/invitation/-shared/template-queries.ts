import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { api, unwrap } from "#/shared/lib/api.ts";
import type { InvitationTemplateFilters } from "./types.ts";

// 模板的"浏览/查详情"能力放这里：template/（模板管理页自己的列表）和
// generate/（生成页要拉 enabled 模板下拉框）两个兄弟页面都要用。
// 新增/修改/启用停用/删除只有模板管理页自己在用，留在 template/-queries.ts。

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
    queryFn: () => unwrap(api.api.listInvitationTemplates.$post({ json: filters })),
    placeholderData: keepPreviousData,
  });

export const getInvitationTemplate = (id: number) =>
  unwrap(api.api.getInvitationTemplate.$post({ json: { id } }));
