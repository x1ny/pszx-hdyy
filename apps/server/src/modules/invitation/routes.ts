import { and, asc, count, desc, eq, exists, ilike, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../../infra/db";
import { toLimitOffset } from "../../shared/pagination";
import { err, ok } from "../../shared/result";
import { jsonBody } from "../../shared/validate";
import { type AuthedVariables, requireUser } from "../auth";
import { user } from "../auth/schema";
import { member } from "../member/schema";
import {
  invitationBatch,
  invitationBatchItem,
  invitationTemplate,
} from "./schema";
import {
  CreateInvitationBatchInput,
  CreateInvitationTemplateInput,
  InvitationBatchIdInput,
  InvitationTemplateIdInput,
  ListInvitationBatchesInput,
  ListInvitationTemplatesInput,
  SetInvitationTemplateStatusInput,
  UpdateInvitationTemplateInput,
} from "./validation";

const templateFields = {
  id: invitationTemplate.id,
  name: invitationTemplate.name,
  issuer: invitationTemplate.issuer,
  applicableDesc: invitationTemplate.applicableDesc,
  status: invitationTemplate.status,
  bodyContent: invitationTemplate.bodyContent,
  annexTitle: invitationTemplate.annexTitle,
  annexContent: invitationTemplate.annexContent,
  contactPerson: invitationTemplate.contactPerson,
  contactPhone: invitationTemplate.contactPhone,
  signOff: invitationTemplate.signOff,
  createdAt: invitationTemplate.createdAt,
  updatedAt: invitationTemplate.updatedAt,
};

const batchFields = {
  id: invitationBatch.id,
  batchNo: invitationBatch.batchNo,
  projectId: invitationBatch.projectId,
  activityId: invitationBatch.activityId,
  templateId: invitationBatch.templateId,
  templateName: invitationBatch.templateName,
  issuer: invitationBatch.issuer,
  bodyContent: invitationBatch.bodyContent,
  annexTitle: invitationBatch.annexTitle,
  annexContent: invitationBatch.annexContent,
  contactPerson: invitationBatch.contactPerson,
  contactPhone: invitationBatch.contactPhone,
  signOff: invitationBatch.signOff,
  issueDate: invitationBatch.issueDate,
  createdAt: invitationBatch.createdAt,
  createdByName: user.name,
  // 相关子查询代替旧版的冗余 target_count 列——数量永远和明细表实际行数
  // 一致，不会随明细表变化而漂移（虽然这一版明细创建后不可增删）。
  itemCount: sql<number>`(
    select count(*)::int from ${invitationBatchItem}
    where ${invitationBatchItem.batchId} = ${invitationBatch.id}
  )`,
};

const batchItemFields = {
  id: invitationBatchItem.id,
  batchId: invitationBatchItem.batchId,
  memberId: invitationBatchItem.memberId,
  recipientName: invitationBatchItem.recipientName,
  companyPosition: invitationBatchItem.companyPosition,
  countryRegion: invitationBatchItem.countryRegion,
  mobile: invitationBatchItem.mobile,
  responseStatus: invitationBatchItem.responseStatus,
  respondedAt: invitationBatchItem.respondedAt,
};

const templateNotFound = () =>
  err({ code: "NOT_FOUND" as const, message: "邀请函模板不存在" });
const batchNotFound = () =>
  err({ code: "NOT_FOUND" as const, message: "生成记录不存在" });
const validationError = (message: string) =>
  err({ code: "VALIDATION_ERROR" as const, message });

/** id 是自增主键，日期用创建时间——两者拼出来天然唯一，不需要重试逻辑。 */
function buildBatchNo(batchId: number, createdAt: Date) {
  const pad = (value: number, length = 2) =>
    String(value).padStart(length, "0");
  const datePart = `${createdAt.getFullYear()}${pad(createdAt.getMonth() + 1)}${pad(createdAt.getDate())}`;
  return `YQH${datePart}${String(batchId).padStart(6, "0")}`;
}

async function loadBatchDetail(id: number) {
  const [batch] = await db
    .select(batchFields)
    .from(invitationBatch)
    .leftJoin(user, eq(invitationBatch.createdBy, user.id))
    .where(eq(invitationBatch.id, id));

  if (!batch) return undefined;

  const items = await db
    .select(batchItemFields)
    .from(invitationBatchItem)
    .where(eq(invitationBatchItem.batchId, id))
    .orderBy(asc(invitationBatchItem.id));

  return { ...batch, items };
}

export const invitationRoutes = new Hono<{ Variables: AuthedVariables }>()
  .use(requireUser)

  // ---------------------------------------------------------------------
  // 模板
  // ---------------------------------------------------------------------

  .post(
    "/api/listInvitationTemplates",
    jsonBody(ListInvitationTemplatesInput),
    async (c) => {
      const { name, issuer, status, page, pageSize } = c.req.valid("json");

      const where = and(
        name ? ilike(invitationTemplate.name, `%${name}%`) : undefined,
        issuer ? eq(invitationTemplate.issuer, issuer) : undefined,
        status ? eq(invitationTemplate.status, status) : undefined,
      );

      const { limit, offset } = toLimitOffset({ page, pageSize });

      const [list, totalRows] = await Promise.all([
        db
          .select(templateFields)
          .from(invitationTemplate)
          .where(where)
          .orderBy(desc(invitationTemplate.id))
          .limit(limit)
          .offset(offset),
        db.select({ total: count() }).from(invitationTemplate).where(where),
      ]);

      return c.json(ok({ list, total: totalRows[0]?.total ?? 0 }));
    },
  )

  .post(
    "/api/getInvitationTemplate",
    jsonBody(InvitationTemplateIdInput),
    async (c) => {
      const [row] = await db
        .select(templateFields)
        .from(invitationTemplate)
        .where(eq(invitationTemplate.id, c.req.valid("json").id));

      return row ? c.json(ok(row)) : c.json(templateNotFound());
    },
  )

  .post(
    "/api/createInvitationTemplate",
    jsonBody(CreateInvitationTemplateInput),
    async (c) => {
      const input = c.req.valid("json");
      const userId = c.get("authedUser").id;

      const [row] = await db
        .insert(invitationTemplate)
        .values({ ...input, createdBy: userId, updatedBy: userId })
        .returning(templateFields);

      return c.json(ok(row));
    },
  )

  .post(
    "/api/updateInvitationTemplate",
    jsonBody(UpdateInvitationTemplateInput),
    async (c) => {
      const { id, ...input } = c.req.valid("json");

      const [row] = await db
        .update(invitationTemplate)
        .set({ ...input, updatedBy: c.get("authedUser").id })
        .where(eq(invitationTemplate.id, id))
        .returning(templateFields);

      return row ? c.json(ok(row)) : c.json(templateNotFound());
    },
  )

  .post(
    "/api/setInvitationTemplateStatus",
    jsonBody(SetInvitationTemplateStatusInput),
    async (c) => {
      const { id, status } = c.req.valid("json");

      const [row] = await db
        .update(invitationTemplate)
        .set({ status, updatedBy: c.get("authedUser").id })
        .where(eq(invitationTemplate.id, id))
        .returning(templateFields);

      return row ? c.json(ok(row)) : c.json(templateNotFound());
    },
  )

  .post(
    "/api/deleteInvitationTemplate",
    jsonBody(InvitationTemplateIdInput),
    async (c) => {
      const [row] = await db
        .delete(invitationTemplate)
        .where(eq(invitationTemplate.id, c.req.valid("json").id))
        .returning({ id: invitationTemplate.id });

      return row ? c.json(ok(row)) : c.json(templateNotFound());
    },
  )

  // ---------------------------------------------------------------------
  // 生成批次
  // ---------------------------------------------------------------------

  .post(
    "/api/createInvitationBatch",
    jsonBody(CreateInvitationBatchInput),
    async (c) => {
      const {
        projectId,
        activityId,
        templateId,
        contactPerson,
        contactPhone,
        signOff,
        issueDate,
        targets,
      } = c.req.valid("json");
      const userId = c.get("authedUser").id;

      const [template] = await db
        .select()
        .from(invitationTemplate)
        .where(eq(invitationTemplate.id, templateId));
      if (!template) return c.json(validationError("模板不存在"));
      if (template.status !== "enabled") {
        return c.json(validationError("模板已停用，不能用于生成"));
      }

      const memberRows = await db
        .select({
          id: member.id,
          name: member.name,
          companyPosition: member.companyPosition,
          countryRegion: member.countryRegion,
          mobile: member.mobile,
          status: member.status,
        })
        .from(member)
        .where(inArray(member.id, targets));
      const memberMap = new Map(memberRows.map((row) => [row.id, row]));
      const hasInvalidTarget = targets.some(
        (targetId) => memberMap.get(targetId)?.status !== "enabled",
      );
      if (hasInvalidTarget) {
        return c.json(validationError("存在不存在或已停用的邀请对象"));
      }

      const batchId = await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(invitationBatch)
          .values({
            // 占位值，插入后马上用自增 id 重新拼出真正的 batchNo。
            batchNo: crypto.randomUUID(),
            projectId,
            activityId,
            templateId,
            templateName: template.name,
            issuer: template.issuer,
            bodyContent: template.bodyContent,
            annexTitle: template.annexTitle,
            annexContent: template.annexContent,
            contactPerson: contactPerson ?? template.contactPerson,
            contactPhone: contactPhone ?? template.contactPhone,
            signOff: signOff ?? template.signOff,
            issueDate,
            createdBy: userId,
          })
          .returning({
            id: invitationBatch.id,
            createdAt: invitationBatch.createdAt,
          });

        await tx
          .update(invitationBatch)
          .set({ batchNo: buildBatchNo(inserted.id, inserted.createdAt) })
          .where(eq(invitationBatch.id, inserted.id));

        await tx.insert(invitationBatchItem).values(
          targets.map((targetId) => {
            const targetMember = memberMap.get(targetId);
            if (!targetMember) throw new Error("unreachable: validated above");
            return {
              batchId: inserted.id,
              memberId: targetId,
              recipientName: targetMember.name,
              companyPosition: targetMember.companyPosition,
              countryRegion: targetMember.countryRegion,
              mobile: targetMember.mobile,
              responseToken: crypto.randomUUID(),
            };
          }),
        );

        return inserted.id;
      });

      return c.json(ok(await loadBatchDetail(batchId)));
    },
  )

  .post(
    "/api/listInvitationBatches",
    jsonBody(ListInvitationBatchesInput),
    async (c) => {
      const {
        activityId,
        templateName,
        issuer,
        batchNo,
        recipientName,
        page,
        pageSize,
      } = c.req.valid("json");

      const where = and(
        activityId ? eq(invitationBatch.activityId, activityId) : undefined,
        templateName
          ? ilike(invitationBatch.templateName, `%${templateName}%`)
          : undefined,
        issuer ? eq(invitationBatch.issuer, issuer) : undefined,
        batchNo ? ilike(invitationBatch.batchNo, `%${batchNo}%`) : undefined,
        recipientName
          ? exists(
              db
                .select({ one: sql`1` })
                .from(invitationBatchItem)
                .where(
                  and(
                    eq(invitationBatchItem.batchId, invitationBatch.id),
                    ilike(
                      invitationBatchItem.recipientName,
                      `%${recipientName}%`,
                    ),
                  ),
                ),
            )
          : undefined,
      );

      const { limit, offset } = toLimitOffset({ page, pageSize });

      const [list, totalRows] = await Promise.all([
        db
          .select(batchFields)
          .from(invitationBatch)
          .leftJoin(user, eq(invitationBatch.createdBy, user.id))
          .where(where)
          .orderBy(desc(invitationBatch.id))
          .limit(limit)
          .offset(offset),
        db.select({ total: count() }).from(invitationBatch).where(where),
      ]);

      return c.json(ok({ list, total: totalRows[0]?.total ?? 0 }));
    },
  )

  .post(
    "/api/getInvitationBatch",
    jsonBody(InvitationBatchIdInput),
    async (c) => {
      const detail = await loadBatchDetail(c.req.valid("json").id);
      return detail ? c.json(ok(detail)) : c.json(batchNotFound());
    },
  )

  .post(
    "/api/deleteInvitationBatch",
    jsonBody(InvitationBatchIdInput),
    async (c) => {
      // items 靠 batchId 的 onDelete: cascade 自动带走，不用手动先删一遍。
      const [row] = await db
        .delete(invitationBatch)
        .where(eq(invitationBatch.id, c.req.valid("json").id))
        .returning({ id: invitationBatch.id });

      return row ? c.json(ok(row)) : c.json(batchNotFound());
    },
  );
