import { z } from "zod";

// Pure schema + arithmetic, no I/O — belongs in shared/, not infra/.

/**
 * 分页入参片段。各模块用 `PageInput.extend({ ...自己的筛选条件 })` 拼出
 * 完整的列表入参，而不是各写各的 page/pageSize —— 名字和上下界统一在这里。
 */
export const PageInput = z.object({
  page: z.number().int().min(1, "页码不正确").default(1),
  // 上界不是防御性编程，是防止「pageSize=100000」把一次查询变成全表扫描。
  pageSize: z
    .number()
    .int()
    .min(1, "每页条数不正确")
    .max(100, "每页最多 100 条")
    .default(10),
});

export type PageParams = z.infer<typeof PageInput>;

/** 所有分页接口的出参形状，前端的分页组件只认这一种。 */
export type Paged<T> = { list: T[]; total: number };

/**
 * 页码语义（1-based）→ SQL 语义（0-based offset）的唯一转换点。
 * 手写 `(page - 1) * pageSize` 迟早会在某个模块里少写个 -1。
 */
export const toLimitOffset = ({ page, pageSize }: PageParams) => ({
  limit: pageSize,
  offset: (page - 1) * pageSize,
});
