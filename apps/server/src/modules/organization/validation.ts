import { z } from "zod";

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

/** 团体主档字段；X1N-7 的接口直接复用，不在这里提前实现路由。 */
export const OrganizationInput = z.object({
  name: required("团体名称", 255),
  remark: optionalText("备注", 2000),
});

export const CreateOrganizationInput = OrganizationInput;
export const UpdateOrganizationInput = OrganizationInput.extend({ id });
export const OrganizationIdInput = z.object({ id });
