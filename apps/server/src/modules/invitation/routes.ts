import { and, asc, count, desc, eq, exists, ilike, inArray, sql } from "drizzle-orm";
import { zipSync } from "fflate";
import { Hono } from "hono";
import { db } from "../../infra/db";
import { contentDisposition } from "../../shared/content-disposition";
import { toLimitOffset } from "../../shared/pagination";
import { err, ok } from "../../shared/result";
import { jsonBody } from "../../shared/validate";
import { type AuthedVariables, requireUser } from "../auth";
import { user } from "../auth/schema";
import { fileAsset } from "../file/schema";
import { activityMember, member } from "../member/schema";
import { activity } from "../project/schema";
import {
  invitationBatch,
  invitationDownloadLog,
  invitationRecord,
  invitationTemplate,
  type InvitationDownloadScope,
  type InvitationVariableValues,
} from "./schema";
import {
  buildInvitationFileName,
  buildRenderValues,
  buildSampleValues,
  customVariableNames,
  DocxTemplateError,
  formatIssueDate,
  inspectTemplate,
  loadTemplateFile,
  renderDocx,
} from "./service";
import {
  CreateInvitationBatchInput,
  CreateInvitationTemplateInput,
  DownloadInvitationBatchInput,
  DownloadInvitationRecordInput,
  InvitationBatchIdInput,
  InvitationTemplateIdInput,
  LastVariableValuesInput,
  ListInvitationBatchesInput,
  ListInvitationTemplatesInput,
  InspectInvitationTemplateInput,
  PreviewInvitationTemplateInput,
  SetInvitationTemplateStatusInput,
  UpdateInvitationTemplateInput,
} from "./validation";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** 批量下载的体积上限（BR-DEV-014D：200 人或 500 MB，以先到者为准）。 */
const BATCH_DOWNLOAD_MAX_BYTES = 500 * 1024 * 1024;

const templateFields = {
  id: invitationTemplate.id,
  name: invitationTemplate.name,
  applicableDesc: invitationTemplate.applicableDesc,
  status: invitationTemplate.status,
  templateFileId: invitationTemplate.templateFileId,
  variables: invitationTemplate.variables,
  createdAt: invitationTemplate.createdAt,
  updatedAt: invitationTemplate.updatedAt,
};

/**
 * 列表/详情多带一个文件原名。
 *
 * 单独一份而不是并进 templateFields：后者要用在 insert/update 的 .returning()
 * 里，而 returning 不能 join。
 */
const templateReadFields = {
  ...templateFields,
  templateFileName: fileAsset.originalName,
};

const batchFields = {
  id: invitationBatch.id,
  batchNo: invitationBatch.batchNo,
  activityId: invitationBatch.activityId,
  templateId: invitationBatch.templateId,
  templateName: invitationBatch.templateName,
  variables: invitationBatch.variables,
  issueDate: invitationBatch.issueDate,
  createdAt: invitationBatch.createdAt,
  createdByName: user.name,
  /**
   * 相关子查询，不是冗余列。
   *
   * 批次成员现在是不变的，存一个计数列也不会漂——但它也就没有任何好处了：
   * count(*) 永远等于明细表实际行数，而冗余列要靠每个写入点记得同步维护。
   */
  recordCount: sql<number>`(
    select count(*)::int from ${invitationRecord}
    where ${invitationRecord.batchId} = ${invitationBatch.id}
  )`,
};

const notFound = (message: string) =>
  err({ code: "NOT_FOUND" as const, message });
const invalid = (message: string) =>
  err({ code: "VALIDATION_ERROR" as const, message });

/** id 是自增主键，配上创建日期天然唯一，不需要重试防撞号。 */
function buildBatchNo(batchId: number, createdAt: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  const date = `${createdAt.getFullYear()}${pad(createdAt.getMonth() + 1)}${pad(createdAt.getDate())}`;
  return `YQH${date}${String(batchId).padStart(6, "0")}`;
}

async function loadBatchDetail(id: number) {
  const [batch] = await db
    .select(batchFields)
    .from(invitationBatch)
    .leftJoin(user, eq(invitationBatch.createdBy, user.id))
    .where(eq(invitationBatch.id, id));

  if (!batch) return undefined;

  // 单位职务/手机号只用于列表展示，不快照——通过 memberId 现查即可，
  // 快照的意义是保住产物可重现，不是给列表做缓存。
  const records = await db
    .select({
      id: invitationRecord.id,
      memberId: invitationRecord.memberId,
      recipientName: invitationRecord.recipientName,
      companyPosition: member.companyPosition,
      mobile: member.mobile,
      createdAt: invitationRecord.createdAt,
    })
    .from(invitationRecord)
    .leftJoin(member, eq(invitationRecord.memberId, member.id))
    .where(eq(invitationRecord.batchId, id))
    .orderBy(asc(invitationRecord.id));

  return { ...batch, records };
}

type DownloadAudit = {
  activityId: number;
  scope: InvitationDownloadScope;
  batchId?: number;
  memberId?: number;
  fileCount: number;
  result: "success" | "failed";
  failReason?: string;
  downloadedBy: string;
};

/**
 * 审计落库失败绝不能把下载本身也带崩——但也不能静默。
 * 记不上日志是运维问题（磁盘、连接池），不是用户能处理的业务错误。
 */
async function logDownload(audit: DownloadAudit) {
  try {
    await db.insert(invitationDownloadLog).values({
      activityId: audit.activityId,
      scope: audit.scope,
      batchId: audit.batchId ?? null,
      memberId: audit.memberId ?? null,
      fileCount: audit.fileCount,
      result: audit.result,
      failReason: audit.failReason ?? null,
      downloadedBy: audit.downloadedBy,
    });
  } catch (error) {
    console.error("Failed to write invitation download log", error);
  }
}

const docxResponse = (bytes: Uint8Array, fileName: string, mime = DOCX_MIME) =>
  // 先切出一段独立的 ArrayBuffer 再交给 Response：Uint8Array 可能是某个更大
  // 缓冲区上的视图（byteOffset 非 0），直接把 .buffer 丢过去会把视图外的字节
  // 也发出去。
  new Response(
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
    {
      headers: {
        "Content-Type": mime,
        "Content-Disposition": contentDisposition(fileName, true),
        "Content-Length": String(bytes.byteLength),
      },
    },
  );

export const invitationRoutes = new Hono<{ Variables: AuthedVariables }>()
  .use(requireUser)

  // ---------------------------------------------------------------------
  // 模板
  // ---------------------------------------------------------------------

  .post("/template/list", jsonBody(ListInvitationTemplatesInput), async (c) => {
    const { name, status, page, pageSize } = c.req.valid("json");

    const where = and(
      name ? ilike(invitationTemplate.name, `%${name}%`) : undefined,
      status ? eq(invitationTemplate.status, status) : undefined,
    );

    const { limit, offset } = toLimitOffset({ page, pageSize });

    const [list, totalRows] = await Promise.all([
      db
        .select(templateReadFields)
        .from(invitationTemplate)
        .innerJoin(fileAsset, eq(invitationTemplate.templateFileId, fileAsset.id))
        .where(where)
        .orderBy(desc(invitationTemplate.id))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(invitationTemplate).where(where),
    ]);

    return c.json(ok({ list, total: totalRows[0]?.total ?? 0 }));
  })

  .post("/template/get", jsonBody(InvitationTemplateIdInput), async (c) => {
    const [row] = await db
      .select(templateReadFields)
      .from(invitationTemplate)
      .innerJoin(fileAsset, eq(invitationTemplate.templateFileId, fileAsset.id))
      .where(eq(invitationTemplate.id, c.req.valid("json").id));

    return row ? c.json(ok(row)) : c.json(notFound("邀请函模板不存在"));
  })

  .post(
    "/template/create",
    jsonBody(CreateInvitationTemplateInput),
    async (c) => {
      const input = c.req.valid("json");
      const userId = c.get("authedUser").id;

      // 变量清单**由服务端解析文件得出**，客户端传什么都不作数——它是文件的
      // 派生物，让客户端传等于允许「声明的变量」和「文件里真有的变量」不一致。
      const file = await loadTemplateFile(input.templateFileId);
      if (!file.ok) return c.json(invalid(file.message));

      const inspection = inspectTemplate(file.bytes);
      if (!inspection.ok) return c.json(invalid(inspection.message));

      const [row] = await db
        .insert(invitationTemplate)
        .values({
          ...input,
          variables: inspection.variables,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning(templateFields);

      return c.json(ok(row));
    },
  )

  .post(
    "/template/update",
    jsonBody(UpdateInvitationTemplateInput),
    async (c) => {
      const { id, ...input } = c.req.valid("json");

      const file = await loadTemplateFile(input.templateFileId);
      if (!file.ok) return c.json(invalid(file.message));

      const inspection = inspectTemplate(file.bytes);
      if (!inspection.ok) return c.json(invalid(inspection.message));

      // 换文件就换 templateFileId，老的 file_asset 行留着不动——历史批次的
      // 快照还指着它。这就是「模板文件版本化」的全部实现，不需要版本号列。
      const [row] = await db
        .update(invitationTemplate)
        .set({
          ...input,
          variables: inspection.variables,
          updatedBy: c.get("authedUser").id,
        })
        .where(eq(invitationTemplate.id, id))
        .returning(templateFields);

      return row ? c.json(ok(row)) : c.json(notFound("邀请函模板不存在"));
    },
  )

  .post(
    "/template/setStatus",
    jsonBody(SetInvitationTemplateStatusInput),
    async (c) => {
      const { id, status } = c.req.valid("json");

      const [row] = await db
        .update(invitationTemplate)
        .set({ status, updatedBy: c.get("authedUser").id })
        .where(eq(invitationTemplate.id, id))
        .returning(templateFields);

      return row ? c.json(ok(row)) : c.json(notFound("邀请函模板不存在"));
    },
  )

  .post("/template/delete", jsonBody(InvitationTemplateIdInput), async (c) => {
    const { id } = c.req.valid("json");

    // BR-DEV-021：已被引用的模板不物理删除，改走禁用。
    // 数据库层的外键是最终防线（invitation_batch.template_id 没有 onDelete），
    // 这里先查一次只是为了把「外键冲突」换成一句人话。
    const [used] = await db
      .select({ total: count() })
      .from(invitationBatch)
      .where(eq(invitationBatch.templateId, id));

    if ((used?.total ?? 0) > 0) {
      return c.json(
        invalid(`该模板已被 ${used?.total} 次生成引用，不能删除，请改为禁用`),
      );
    }

    const [row] = await db
      .delete(invitationTemplate)
      .where(eq(invitationTemplate.id, id))
      .returning({ id: invitationTemplate.id });

    return row ? c.json(ok(row)) : c.json(notFound("邀请函模板不存在"));
  })

  /**
   * 只解析不渲染：上传完文件、还没保存时，模板表单要能立刻列出「这个模板有哪些
   * 变量、哪些是系统自动填的」。
   *
   * 和 create/update 走的是同一个 `inspectTemplate`，所以「表单上看到的变量」
   * 和「保存后存进库的变量」不可能不一致。
   */
  .post(
    "/template/inspect",
    jsonBody(InspectInvitationTemplateInput),
    async (c) => {
      const file = await loadTemplateFile(c.req.valid("json").templateFileId);
      if (!file.ok) return c.json(invalid(file.message));

      const inspection = inspectTemplate(file.bytes);
      if (!inspection.ok) return c.json(invalid(inspection.message));

      return c.json(
        ok({ variables: inspection.variables, originalName: file.originalName }),
      );
    },
  )

  /**
   * 保存前预览：同样吃 fileId，用户不必先保存一个自己都没看过的模板。
   * 返回的是真实渲染出来的 .docx，前端用 @silurus/ooxml 在 Canvas 里渲染。
   */
  .post(
    "/template/preview",
    jsonBody(PreviewInvitationTemplateInput),
    async (c) => {
      const { templateFileId, variables, recipientName, issueDate } =
        c.req.valid("json");

      const file = await loadTemplateFile(templateFileId);
      if (!file.ok) return c.json(invalid(file.message));

      const inspection = inspectTemplate(file.bytes);
      if (!inspection.ok) return c.json(invalid(inspection.message));

      // 样例值打底，调用方给了什么就盖掉什么。这样模板页（什么都没填）和生成页
      // （填了一半）都能预览，不会因为缺一个变量就整个渲染不出来。
      const bytes = renderDocx(file.bytes, {
        ...buildSampleValues(inspection.variables),
        ...variables,
        ...(recipientName ? { 姓名: recipientName } : {}),
        ...(issueDate ? { 发函日期: formatIssueDate(issueDate) } : {}),
      });

      return docxResponse(bytes, "邀请函预览.docx");
    },
  )

  // ---------------------------------------------------------------------
  // 生成
  // ---------------------------------------------------------------------

  /** 生成页的默认值：该模板上一次生成时填的那组自定义变量。 */
  .post("/batch/lastVariables", jsonBody(LastVariableValuesInput), async (c) => {
    const [row] = await db
      .select({ variables: invitationBatch.variables })
      .from(invitationBatch)
      .where(eq(invitationBatch.templateId, c.req.valid("json").templateId))
      .orderBy(desc(invitationBatch.createdAt))
      .limit(1);

    return c.json(ok({ variables: row?.variables ?? {} }));
  })

  .post("/batch/create", jsonBody(CreateInvitationBatchInput), async (c) => {
    const { activityId, templateId, issueDate, variables, memberIds } =
      c.req.valid("json");
    const userId = c.get("authedUser").id;

    const [template] = await db
      .select()
      .from(invitationTemplate)
      .where(eq(invitationTemplate.id, templateId));
    if (!template) return c.json(invalid("模板不存在"));
    if (template.status !== "enabled") {
      return c.json(invalid("模板已停用，不能用于生成"));
    }

    // 「变量缺失阻断本次生成」（文档 §10）。按模板的变量清单判定，而不是按
    // 客户端传了什么——清单是文件的派生物，是唯一的事实来源。
    const missing = customVariableNames(template.variables).filter(
      (name) => !variables[name]?.trim(),
    );
    if (missing.length > 0) {
      return c.json(
        invalid(`这些变量还没填：${missing.map((n) => `{{${n}}}`).join("、")}`),
      );
    }

    // 只能发给本活动的活动人员。数据库层有复合外键兜底，这里查一次是为了
    // 给出「哪几个人不在名单里」而不是一句外键冲突。
    const targets = await db
      .select({
        memberId: activityMember.memberId,
        name: member.name,
        status: member.status,
      })
      .from(activityMember)
      .innerJoin(member, eq(activityMember.memberId, member.id))
      .where(
        and(
          eq(activityMember.activityId, activityId),
          inArray(activityMember.memberId, memberIds),
        ),
      );

    if (targets.length !== memberIds.length) {
      return c.json(invalid("存在不属于本活动人员名单的邀请对象，请刷新后重试"));
    }
    if (targets.some((target) => target.status !== "enabled")) {
      return c.json(invalid("邀请对象中存在已停用的人员"));
    }

    const batchId = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(invitationBatch)
        .values({
          // 占位；拿到自增 id 后立刻回填真正的批次号。
          batchNo: crypto.randomUUID(),
          activityId,
          templateId,
          templateFileId: template.templateFileId,
          templateName: template.name,
          variables,
          issueDate,
          createdBy: userId,
        })
        .returning({
          id: invitationBatch.id,
          createdAt: invitationBatch.createdAt,
        });

      if (!inserted) throw new Error("unreachable: insert returned no row");

      await tx
        .update(invitationBatch)
        .set({ batchNo: buildBatchNo(inserted.id, inserted.createdAt) })
        .where(eq(invitationBatch.id, inserted.id));

      // 每批独立留档：直接插入，不做 upsert。同一个人可以在多个批次里各有
      // 一份，后生成的不动已有批次——那些文件可能已经发出去了，事后还要能
      // 重新下载。批次内的重复由 uk_invitation_record(batchId, memberId) 挡住，
      // 而 memberIds 在入参层已经去过重，正常路径不会撞上。
      await tx.insert(invitationRecord).values(
        targets.map((target) => ({
          activityId,
          memberId: target.memberId,
          batchId: inserted.id,
          recipientName: target.name,
        })),
      );

      return inserted.id;
    });

    return c.json(ok(await loadBatchDetail(batchId)));
  })

  .post("/batch/list", jsonBody(ListInvitationBatchesInput), async (c) => {
    const { activityId, templateName, batchNo, recipientName, page, pageSize } =
      c.req.valid("json");

    const where = and(
      eq(invitationBatch.activityId, activityId),
      templateName
        ? ilike(invitationBatch.templateName, `%${templateName}%`)
        : undefined,
      batchNo ? ilike(invitationBatch.batchNo, `%${batchNo}%`) : undefined,
      recipientName
        ? exists(
            db
              .select({ one: sql`1` })
              .from(invitationRecord)
              .where(
                and(
                  eq(invitationRecord.batchId, invitationBatch.id),
                  ilike(invitationRecord.recipientName, `%${recipientName}%`),
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
  })

  .post("/batch/get", jsonBody(InvitationBatchIdInput), async (c) => {
    const detail = await loadBatchDetail(c.req.valid("json").id);
    return detail ? c.json(ok(detail)) : c.json(notFound("生成记录不存在"));
  })

  // ---------------------------------------------------------------------
  // 下载（敏感操作，全部记审计 —— BR-DEV-014）
  // ---------------------------------------------------------------------

  .post(
    "/record/download",
    jsonBody(DownloadInvitationRecordInput),
    async (c) => {
      const { recordId } = c.req.valid("json");
      const userId = c.get("authedUser").id;

      const [row] = await db
        .select({
          memberId: invitationRecord.memberId,
          recipientName: invitationRecord.recipientName,
          batchId: invitationBatch.id,
          batchNo: invitationBatch.batchNo,
          activityId: invitationBatch.activityId,
          activityName: activity.name,
          templateFileId: invitationBatch.templateFileId,
          variables: invitationBatch.variables,
          issueDate: invitationBatch.issueDate,
          idNumber: member.idNumber,
        })
        .from(invitationRecord)
        .innerJoin(
          invitationBatch,
          eq(invitationRecord.batchId, invitationBatch.id),
        )
        .innerJoin(activity, eq(invitationBatch.activityId, activity.id))
        .leftJoin(member, eq(invitationRecord.memberId, member.id))
        .where(eq(invitationRecord.id, recordId));

      if (!row) return c.json(notFound("邀请函记录不存在"));

      const audit = {
        activityId: row.activityId,
        scope: "single" as const,
        batchId: row.batchId,
        memberId: row.memberId,
        fileCount: 1,
        downloadedBy: userId,
      };

      const file = await loadTemplateFile(row.templateFileId);
      if (!file.ok) {
        await logDownload({ ...audit, result: "failed", failReason: file.message });
        return c.json(invalid(file.message));
      }

      try {
        const bytes = renderDocx(
          file.bytes,
          buildRenderValues({
            variables: row.variables,
            recipientName: row.recipientName,
            issueDate: row.issueDate,
          }),
        );

        await logDownload({ ...audit, result: "success" });

        return docxResponse(
          bytes,
          buildInvitationFileName({
            activityName: row.activityName,
            recipientName: row.recipientName,
            idNumber: row.idNumber,
            memberId: row.memberId,
            batchNo: row.batchNo,
          }),
        );
      } catch (error) {
        const message =
          error instanceof DocxTemplateError
            ? error.message
            : "邀请函渲染失败，请检查模板文件";
        await logDownload({ ...audit, result: "failed", failReason: message });
        return c.json(invalid(message));
      }
    },
  )

  /**
   * 批量下载。
   *
   * 同步流式打包而不是建异步任务：本轮只出 Word，渲染就是 XML 字符串替换，
   * 单份几十毫秒、200 份几秒钟就完。等以后接上 PDF（要过 LibreOffice，单份
   * 一两秒）时再改成任务表 + 轮询，那时它才真的需要。
   */
  .post("/batch/download", jsonBody(DownloadInvitationBatchInput), async (c) => {
    const { batchId, memberIds } = c.req.valid("json");
    const userId = c.get("authedUser").id;

    const [batch] = await db
      .select({
        id: invitationBatch.id,
        batchNo: invitationBatch.batchNo,
        activityId: invitationBatch.activityId,
        activityName: activity.name,
        templateFileId: invitationBatch.templateFileId,
        variables: invitationBatch.variables,
        issueDate: invitationBatch.issueDate,
      })
      .from(invitationBatch)
      .innerJoin(activity, eq(invitationBatch.activityId, activity.id))
      .where(eq(invitationBatch.id, batchId));

    if (!batch) return c.json(notFound("生成记录不存在"));

    const records = await db
      .select({
        memberId: invitationRecord.memberId,
        recipientName: invitationRecord.recipientName,
        idNumber: member.idNumber,
      })
      .from(invitationRecord)
      .leftJoin(member, eq(invitationRecord.memberId, member.id))
      .where(
        and(
          eq(invitationRecord.batchId, batchId),
          memberIds ? inArray(invitationRecord.memberId, memberIds) : undefined,
        ),
      )
      .orderBy(asc(invitationRecord.id));

    const audit = {
      activityId: batch.activityId,
      scope: "batch" as const,
      batchId: batch.id,
      fileCount: records.length,
      downloadedBy: userId,
    };

    if (records.length === 0) {
      return c.json(invalid("该批次下没有可下载的邀请函"));
    }
    if (records.length > 200) {
      return c.json(invalid("单次最多下载 200 份，请分批下载"));
    }

    const file = await loadTemplateFile(batch.templateFileId);
    if (!file.ok) {
      await logDownload({ ...audit, result: "failed", failReason: file.message });
      return c.json(invalid(file.message));
    }

    try {
      const entries: Record<string, Uint8Array> = {};
      let totalBytes = 0;

      for (const record of records) {
        const bytes = renderDocx(
          file.bytes,
          buildRenderValues({
            variables: batch.variables as InvitationVariableValues,
            recipientName: record.recipientName,
            issueDate: batch.issueDate,
          }),
        );

        totalBytes += bytes.byteLength;
        if (totalBytes > BATCH_DOWNLOAD_MAX_BYTES) {
          return c.json(invalid("本次下载超过 500 MB，请缩小人员范围分批下载"));
        }

        // 文件名规则已经保证唯一（证件后四位，缺失时退回人员 ID），不会互相覆盖。
        entries[
          buildInvitationFileName({
            activityName: batch.activityName,
            recipientName: record.recipientName,
            idNumber: record.idNumber,
            memberId: record.memberId,
            batchNo: batch.batchNo,
          })
        ] = bytes;
      }

      // level 0（仅打包不压缩）：docx 本身就是 zip，里面的内容已经压过一遍，
      // 再压一次几乎不减体积，白烧一遍 CPU。
      const zip = zipSync(entries, { level: 0 });

      await logDownload({ ...audit, result: "success" });

      return docxResponse(
        zip,
        `${batch.activityName}_邀请函_批量下载_${batch.batchNo}.zip`,
        "application/zip",
      );
    } catch (error) {
      const message =
        error instanceof DocxTemplateError
          ? error.message
          : "邀请函渲染失败，请检查模板文件";
      await logDownload({ ...audit, result: "failed", failReason: message });
      return c.json(invalid(message));
    }
  });
