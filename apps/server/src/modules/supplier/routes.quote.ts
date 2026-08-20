import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../../infra/db";
import { err, ok } from "../../shared/result";
import { jsonBody } from "../../shared/validate";
import { type AuthedVariables, requireUser } from "../auth";
import { user } from "../auth/schema";
import { fileAsset } from "../file/schema";
import { supplier, supplierQuote } from "./schema";
import {
  CreateSupplierQuoteInput,
  ListSupplierQuotesInput,
  SupplierQuoteIdInput,
} from "./validation";

/**
 * 报价信息单独一个前缀（`/api/supplierQuote`），不挤进 `/api/supplier`。
 *
 * 理由同 member 的三层关系、resource 的两层：它是 supplier 模块下的**子资源**，
 * 查询条件（按 supplierId 全量）、返回列（join 文件和上传人）、将来的权限点
 * 都跟主档不一样，糊成一个前缀就只能靠动作名里加前缀去区分。
 *
 * 文件本体不归这里管——上传走 `/api/file/upload`，预览/下载走
 * `GET /api/file/:fileId`。这条链只维护「哪个供应商挂了哪个文件」。
 */
export const supplierQuoteRoutes = new Hono<{ Variables: AuthedVariables }>()
  .use(requireUser)

  /**
   * 文件名/大小/类型全部从 `file_asset` 现 join，上传人姓名从 `user` 现 join。
   * 冗余成本地列的话，改名或者换文件之后这里就跟真实文件对不上了。
   */
  .post("/list", jsonBody(ListSupplierQuotesInput), async (c) => {
    const rows = await db
      .select({
        id: supplierQuote.id,
        supplierId: supplierQuote.supplierId,
        fileId: supplierQuote.fileId,
        fileName: fileAsset.originalName,
        sizeBytes: fileAsset.sizeBytes,
        uploadedByName: user.name,
        createdAt: supplierQuote.createdAt,
      })
      .from(supplierQuote)
      .innerJoin(fileAsset, eq(supplierQuote.fileId, fileAsset.id))
      // leftJoin：上传人可能已被删号（uploadedBy 是 set null），那条附件本身
      // 还在，不能因为查不到人就整行消失。
      .leftJoin(user, eq(supplierQuote.uploadedBy, user.id))
      .where(eq(supplierQuote.supplierId, c.req.valid("json").supplierId))
      // 最新上传的排最前——报价看的就是「最近这份多少钱」。
      .orderBy(desc(supplierQuote.id));

    return c.json(ok(rows));
  })

  .post("/create", jsonBody(CreateSupplierQuoteInput), async (c) => {
    const { supplierId, fileId } = c.req.valid("json");
    const authedUser = c.get("authedUser");

    // 两个前置检查都不是「防御性编程」，是为了把两次必然发生的外键报错
    // （500 服务器内部错误）换成用户看得懂的一句话。
    const [supplierRow] = await db
      .select({ id: supplier.id })
      .from(supplier)
      .where(eq(supplier.id, supplierId));

    if (!supplierRow) {
      return c.json(err({ code: "NOT_FOUND", message: "供应商不存在" }));
    }

    // status 必须是 ready：上传中途失败的行也在表里，挂上去点开就是 404。
    const [file] = await db
      .select({
        id: fileAsset.id,
        originalName: fileAsset.originalName,
        sizeBytes: fileAsset.sizeBytes,
        status: fileAsset.status,
      })
      .from(fileAsset)
      .where(eq(fileAsset.id, fileId));

    if (!file || file.status !== "ready") {
      return c.json(
        err({ code: "VALIDATION_ERROR", message: "文件不存在或尚未上传完成" }),
      );
    }

    const [row] = await db
      .insert(supplierQuote)
      .values({ supplierId, fileId, uploadedBy: authedUser.id })
      .returning({ id: supplierQuote.id, createdAt: supplierQuote.createdAt });

    if (!row) {
      return c.json(err({ code: "INTERNAL_ERROR", message: "保存失败" }));
    }

    // returning 不能 join，但这一行的 join 结果这里全都已经在手上了
    // （文件是刚查的，上传人就是当前登录用户），再查一次纯属多一次往返。
    return c.json(
      ok({
        id: row.id,
        supplierId,
        fileId,
        fileName: file.originalName,
        sizeBytes: file.sizeBytes,
        uploadedByName: authedUser.name,
        createdAt: row.createdAt,
      }),
    );
  })

  /**
   * 只解除关联，不删 `file_asset`、不删磁盘上的文件。
   *
   * 那份文件可能同时被别处引用（现在没有，但 file_asset 是全局池），而且
   * 「误删一份报价单」在现实里是会发生的——留着字节，将来真要做回收站或者
   * 定期清理孤儿文件，都还有得救。
   */
  .post("/delete", jsonBody(SupplierQuoteIdInput), async (c) => {
    const [row] = await db
      .delete(supplierQuote)
      .where(eq(supplierQuote.id, c.req.valid("json").id))
      .returning({ id: supplierQuote.id });

    return row
      ? c.json(ok(row))
      : c.json(err({ code: "NOT_FOUND", message: "报价附件不存在" }));
  });
