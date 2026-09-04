import type { InferRequestType, InferResponseType } from "hono/client";
import { type ApiData, api, unwrap } from "#/shared/lib/api";

export type MemberImportRow = InferRequestType<
  typeof api.api.member.validateImport.$post
>["json"]["rows"][number];

export type MemberImportValidation = ApiData<
  InferResponseType<typeof api.api.member.validateImport.$post>
>;

export type MemberImportPreviewRow = MemberImportValidation["rows"][number];
export type MemberImportIssue = MemberImportPreviewRow["issues"][number];

export const getMemberImportTemplate = () =>
  unwrap(api.api.member.getImportTemplate.$post());

export const previewMemberImport = (file: File) =>
  unwrap(api.api.member.previewImport.$post({ form: { file } }));

export const validateMemberImport = (rows: MemberImportRow[]) =>
  unwrap(api.api.member.validateImport.$post({ json: { rows } }));

export const commitMemberImport = (
  rows: MemberImportRow[],
  acknowledgeWarnings: boolean,
) =>
  unwrap(
    api.api.member.commitImport.$post({
      json: { rows, acknowledgeWarnings },
    }),
  );

export const editableMemberImportRows = (
  rows: MemberImportPreviewRow[],
): MemberImportRow[] => rows.map(({ issues: _issues, ...row }) => row);
