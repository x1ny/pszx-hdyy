import { z } from "zod";
import { PageInput } from "../../shared/pagination";
import { SERVICE_CATEGORIES, SUPPLIER_STATUSES } from "./schema";

// 带上中文 error：这些 message 会被前端直接丢进 toast，漏一个就露出
// zod 的英文默认文案（"Invalid option: expected one of ..."）。
const ServiceCategoryEnum = z.enum(SERVICE_CATEGORIES, {
  error: "服务类目不正确",
});
const SupplierStatusEnum = z.enum(SUPPLIER_STATUSES, { error: "状态不正确" });
const id = z.number().int().positive();

/** 先 trim 再校验：否则「一串空格」能过 min(1)，存进去是条空记录。 */
const required = (label: string, max: number) =>
  z.string().trim().min(1, `${label}不能为空`).max(max, `${label}过长`);

/** 筛选项：前端的「不筛」可能是空串也可能是缺省，统一收敛成 undefined。 */
const filter = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined);

/** 新增和修改共用的字段集合，改一处两个接口一起变。 */
export const SupplierInput = z.object({
  name: required("供应商名称", 255),
  serviceCategories: z
    .array(ServiceCategoryEnum)
    .min(1, "服务类目不能为空")
    // 多选组件传重复值不该变成脏数据，服务端兜底去重。
    .transform((value) => [...new Set(value)]),
  city: required("所在城市", 64),
  contactPerson: required("联系人", 64),
  contactPhone: z
    .string()
    .trim()
    .regex(/^[\d\-+()（）\s]{5,20}$/, "请输入正确的联系电话"),
  status: SupplierStatusEnum.default("enabled"),
  remark: z.string().trim().max(1000, "备注过长").optional(),
});

export const CreateSupplierInput = SupplierInput;

export const UpdateSupplierInput = SupplierInput.extend({ id });

export const SupplierIdInput = z.object({ id });

/**
 * 旧接口是 toggleStatus（服务端读当前值取反）。改成显式传目标状态：
 * toggle 不幂等，两个人同时点、或者请求重试一次，结果就不可预测了。
 */
export const SetSupplierStatusInput = z.object({
  id,
  status: SupplierStatusEnum,
});

export const ListSuppliersInput = PageInput.extend({
  name: filter,
  serviceCategory: ServiceCategoryEnum.optional(),
  city: filter,
  status: SupplierStatusEnum.optional(),
});

// ---------------------------------------------------------------------------
// 报价信息（子资源，接口挂在 /api/supplierQuote/*）
// ---------------------------------------------------------------------------

const fileId = z.uuid({ error: "文件 ID 格式不正确" });

/**
 * 不分页。一个供应商的报价附件是个位数到几十份，`{list,total}` 那套在这里
 * 只是多一个前端要维护的分页状态；真出现上百份再改成 PageInput.extend。
 */
export const ListSupplierQuotesInput = z.object({ supplierId: id });

/** 文件先经 `/api/file/upload` 落地，这里只把它挂到供应商名下。 */
export const CreateSupplierQuoteInput = z.object({
  supplierId: id,
  fileId,
});

export const SupplierQuoteIdInput = z.object({ id });
