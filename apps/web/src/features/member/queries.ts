import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { InferRequestType, InferResponseType } from "hono/client";
import { type ApiData, api, unwrap } from "#/shared/lib/api";

// 人员的"浏览/搜索"能力提到 features/：邀请函模块（选邀请对象）和人员管理页面
// 两个消费方都要按姓名/职务筛人员列表——第 2 个消费方出现就该提升，不是加
// 一条 `../../` 跨路由 import 别人的 `-queries.ts`。
//
// 创建/修改/删除/状态切换这几个变更操作只有人员管理页面自己在用，留在
// routes/_authenticated/member/-queries.ts，不跟着搬。

export type Member = ApiData<
  InferResponseType<typeof api.api.member.get.$post>
>;
export type MemberStatus = Member["status"];

export type MemberFilters = InferRequestType<
  typeof api.api.member.list.$post
>["json"];

export const memberKeys = {
  all: ["member"] as const,
  list: (filters: MemberFilters) => [...memberKeys.all, "list", filters] as const,
};

export const memberListQueryOptions = (filters: MemberFilters) =>
  queryOptions({
    queryKey: memberKeys.list(filters),
    queryFn: () => unwrap(api.api.member.list.$post({ json: filters })),
    placeholderData: keepPreviousData,
  });
