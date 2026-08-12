import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { InferRequestType, InferResponseType } from "hono/client";
import { type ApiData, api, unwrap } from "#/shared/lib/api";

// ---------------------------------------------------------------------------
// 领域类型全部从接口反推，不手抄。
//
// 手抄一份 `type Supplier = {...}` 的代价是它会悄悄跟服务端漂移 —— 后端加个字段、
// 改个可空性，前端的类型照样编译通过，直到运行时才炸。这里走的是既有的类型通道
// （`@repo/server/client-type` 的 hcWithType），是纯 `import type`，不会把服务端
// 代码带进浏览器包。
// ---------------------------------------------------------------------------

export type Supplier = ApiData<
  InferResponseType<typeof api.api.getSupplier.$post>
>;
export type ServiceCategory = Supplier["serviceCategories"][number];
export type SupplierStatus = Supplier["status"];

/** 列表入参 = 筛选条件 + 分页，直接取接口的请求体类型。 */
export type SupplierFilters = InferRequestType<
  typeof api.api.listSuppliers.$post
>["json"];

export type SupplierFormValues = InferRequestType<
  typeof api.api.createSupplier.$post
>["json"];

/**
 * 查询键集中在一处。散落在各处写 `["supplier", "list", x]` 的话，
 * 某天想失效整个模块（`supplierKeys.all`）就得靠 grep 找全。
 */
export const supplierKeys = {
  all: ["supplier"] as const,
  list: (filters: SupplierFilters) =>
    [...supplierKeys.all, "list", filters] as const,
  cities: () => [...supplierKeys.all, "cities"] as const,
};

export const supplierListQueryOptions = (filters: SupplierFilters) =>
  queryOptions({
    queryKey: supplierKeys.list(filters),
    queryFn: () => unwrap(api.api.listSuppliers.$post({ json: filters })),
    // 翻页/改筛选时先展示上一页数据，避免表格整体塌成骨架屏再弹回来。
    placeholderData: keepPreviousData,
  });

export const supplierStatsQueryOptions = () =>
  queryOptions({
    queryKey: [...supplierKeys.all, "stats"] as const,
    queryFn: () => unwrap(api.api.getSupplierStats.$post({ json: {} })),
  });

export const supplierCitiesQueryOptions = () =>
  queryOptions({
    queryKey: supplierKeys.cities(),
    queryFn: () => unwrap(api.api.listSupplierCities.$post({ json: {} })),
  });

// 变更操作只导出裸函数，useMutation 留在页面里写 —— 成功提示、关弹窗、
// 失效哪些查询都是页面的编排逻辑，塞进这里反而要把 queryClient 传进来。

export const createSupplier = (values: SupplierFormValues) =>
  unwrap(api.api.createSupplier.$post({ json: values }));

export const updateSupplier = (values: SupplierFormValues & { id: number }) =>
  unwrap(api.api.updateSupplier.$post({ json: values }));

export const deleteSupplier = (id: number) =>
  unwrap(api.api.deleteSupplier.$post({ json: { id } }));

export const setSupplierStatus = (id: number, status: SupplierStatus) =>
  unwrap(api.api.setSupplierStatus.$post({ json: { id, status } }));
