import { z } from "zod";
import { PageInput } from "../../shared/pagination";

const id = z.number().int().positive();

const required = (label: string, max: number) =>
  z.string().trim().min(1, `${label}不能为空`).max(max, `${label}过长`);

const optionalText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label}过长`)
    .nullable()
    .optional()
    .transform((value) => value || null);

/** 列表筛选的空串不是一个有效条件，统一收敛成未筛选。 */
const filter = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined);

/**
 * 团体编辑器提交的是成员**完整集合**。选择器可能因前端状态合并带来重复值，
 * 服务端在落库前收敛，后续的「选中/取消」差集语义才不会被重复 id 干扰。
 */
const memberIds = z.array(id).transform((value) => [...new Set(value)]);

/** 团体主档字段；X1N-7 的接口直接复用，不在这里提前实现路由。 */
export const OrganizationInput = z.object({
  name: required("团体名称", 255),
  remark: optionalText("备注", 2000),
  memberIds,
});

export const CreateOrganizationInput = OrganizationInput;
export const UpdateOrganizationInput = OrganizationInput.extend({ id });
export const OrganizationIdInput = z.object({ id });

export const ListOrganizationsInput = PageInput.extend({ name: filter });
