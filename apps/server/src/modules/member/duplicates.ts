import { and, eq, ne } from "drizzle-orm";
import type { db } from "../../infra/db";
import { member } from "./schema";

type MemberQueryExecutor = Pick<typeof db, "select">;

/** 人员主档新增/修改时的手机号重复提示。 */
export const duplicateMobileMessage = (name: string) =>
  `该手机号和“${name}”手机号重复，请重新输入`;

/** 查找已占用手机号的人员；编辑本人时通过 excludeId 排除当前行。 */
export async function findDuplicateMobile(
  executor: MemberQueryExecutor,
  mobile: string | null | undefined,
  excludeId?: number,
) {
  if (!mobile) return undefined;

  const [row] = await executor
    .select({ id: member.id, name: member.name })
    .from(member)
    .where(
      and(
        eq(member.mobile, mobile),
        excludeId === undefined ? undefined : ne(member.id, excludeId),
      ),
    )
    .limit(1);

  return row;
}
