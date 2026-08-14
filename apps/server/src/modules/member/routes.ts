import { and, count, desc, eq, ilike, ne } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../../infra/db";
import { toLimitOffset } from "../../shared/pagination";
import { err, ok } from "../../shared/result";
import { jsonBody } from "../../shared/validate";
import { type AuthedVariables, requireUser } from "../auth";
import { member } from "./schema";
import {
  CreateMemberInput,
  ListMembersInput,
  MemberIdInput,
  SetMemberStatusInput,
  UpdateMemberInput,
} from "./validation";

const memberFields = {
  id: member.id,
  name: member.name,
  gender: member.gender,
  companyPosition: member.companyPosition,
  countryRegion: member.countryRegion,
  nativePlace: member.nativePlace,
  idType: member.idType,
  idNumber: member.idNumber,
  mobile: member.mobile,
  phone: member.phone,
  email: member.email,
  language: member.language,
  remark: member.remark,
  activityCount: member.activityCount,
  status: member.status,
  createdAt: member.createdAt,
  updatedAt: member.updatedAt,
};

const notFound = () =>
  err({ code: "NOT_FOUND" as const, message: "人员不存在" });

const validationError = (message: string) =>
  err({ code: "VALIDATION_ERROR" as const, message });

async function hasDuplicateIdNumber(
  idNumber: string | null | undefined,
  excludeId?: number,
) {
  if (!idNumber) return false;

  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .where(
      and(
        eq(member.idNumber, idNumber),
        excludeId === undefined ? undefined : ne(member.id, excludeId),
      ),
    )
    .limit(1);

  return Boolean(row);
}

export const memberRoutes = new Hono<{ Variables: AuthedVariables }>()
  .use(requireUser)

  .post("/list", jsonBody(ListMembersInput), async (c) => {
    const { name, companyPosition, status, page, pageSize } =
      c.req.valid("json");
    const where = and(
      name ? ilike(member.name, `%${name}%`) : undefined,
      companyPosition
        ? ilike(member.companyPosition, `%${companyPosition}%`)
        : undefined,
      status ? eq(member.status, status) : undefined,
    );
    const { limit, offset } = toLimitOffset({ page, pageSize });

    const [list, totalRows] = await Promise.all([
      db
        .select(memberFields)
        .from(member)
        .where(where)
        .orderBy(desc(member.id))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(member).where(where),
    ]);

    return c.json(ok({ list, total: totalRows[0]?.total ?? 0 }));
  })

  .post("/get", jsonBody(MemberIdInput), async (c) => {
    const [row] = await db
      .select(memberFields)
      .from(member)
      .where(eq(member.id, c.req.valid("json").id));

    return row ? c.json(ok(row)) : c.json(notFound());
  })

  .post("/create", jsonBody(CreateMemberInput), async (c) => {
    const input = c.req.valid("json");
    if (await hasDuplicateIdNumber(input.idNumber)) {
      return c.json(validationError("证件号码已存在"));
    }

    const userId = c.get("authedUser").id;
    const [row] = await db
      .insert(member)
      .values({ ...input, createdBy: userId, updatedBy: userId })
      .returning(memberFields);

    return c.json(ok(row));
  })

  .post("/update", jsonBody(UpdateMemberInput), async (c) => {
    const { id, ...input } = c.req.valid("json");
    if (await hasDuplicateIdNumber(input.idNumber, id)) {
      return c.json(validationError("证件号码已存在"));
    }

    const [row] = await db
      .update(member)
      .set({ ...input, updatedBy: c.get("authedUser").id })
      .where(eq(member.id, id))
      .returning(memberFields);

    return row ? c.json(ok(row)) : c.json(notFound());
  })

  .post("/setStatus", jsonBody(SetMemberStatusInput), async (c) => {
    const { id, status } = c.req.valid("json");
    const [row] = await db
      .update(member)
      .set({ status, updatedBy: c.get("authedUser").id })
      .where(eq(member.id, id))
      .returning(memberFields);

    return row ? c.json(ok(row)) : c.json(notFound());
  })

  .post("/delete", jsonBody(MemberIdInput), async (c) => {
    const [row] = await db
      .delete(member)
      .where(eq(member.id, c.req.valid("json").id))
      .returning({ id: member.id });

    return row ? c.json(ok(row)) : c.json(notFound());
  });
