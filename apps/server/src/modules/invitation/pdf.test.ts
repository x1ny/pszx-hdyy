import { afterEach, describe, expect, test } from "bun:test";
import { strToU8, unzipSync, zipSync } from "fflate";
import {
  addInvitationDownloadEntry,
  prepareInvitationDownload,
} from "./download";
import { convertInvitationPdfs, INVITATION_DOWNLOAD_MAX_BYTES } from "./pdf";

let server: ReturnType<typeof Bun.serve> | undefined;
afterEach(() => {
  server?.stop(true);
  server = undefined;
});
const serve = (handler: (request: Request) => Response | Promise<Response>) => {
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler });
  return server.url.toString();
};
const doc = strToU8("test docx payload");
const pdf = strToU8("%PDF-1.7\ntest payload");

test("同名收件人不会覆盖 ZIP 中的其他邀请函", async () => {
  const entries: Record<string, Uint8Array> = {};
  addInvitationDownloadEntry(entries, "模板——张三.docx", doc);
  addInvitationDownloadEntry(entries, "模板——张三.docx", pdf);
  addInvitationDownloadEntry(entries, "模板——张三（2）.docx", doc);
  const result = await prepareInvitationDownload(entries, "docx", "batch.zip");
  const files = unzipSync(result.bytes);
  expect(Object.keys(files)).toEqual([
    "模板——张三.docx",
    "模板——张三（2）.docx",
    "模板——张三（2）（2）.docx",
  ]);
  expect(files["模板——张三（2）.docx"]).toEqual(pdf);
});

describe("邀请函 PDF 转换边界", () => {
  test("单份上传 DOCX 字节并返回 PDF，临时名称不包含收件人", async () => {
    const url = serve(async (request) => {
      expect(new URL(request.url).pathname).toBe("/forms/libreoffice/convert");
      const form = await request.formData();
      const file = form.get("files") as File;
      expect(file.name).toBe("invitation-0.docx");
      expect(new Uint8Array(await file.arrayBuffer())).toEqual(doc);
      expect(form.get("exportNotes")).toBe("false");
      return new Response(pdf, {
        headers: { "Content-Type": "application/pdf" },
      });
    });
    expect(await convertInvitationPdfs([doc], { url })).toEqual([pdf]);
  });

  test("批量按编号恢复收件人顺序，不依赖 ZIP 内部顺序", async () => {
    const second = strToU8("%PDF-1.7\nsecond recipient");
    const url = serve(
      () =>
        new Response(
          zipSync({
            "invitation-1.docx.pdf": second,
            "invitation-0.docx.pdf": pdf,
          }),
          { headers: { "Content-Type": "application/zip" } },
        ),
    );
    expect(await convertInvitationPdfs([doc, doc], { url })).toEqual([
      pdf,
      second,
    ]);
  });

  test.each<Record<string, Uint8Array>>([
    { "invitation-0.docx.pdf": pdf },
    { "invitation-0.docx.pdf": pdf, "wrong.pdf": pdf },
    { "invitation-0.docx.pdf": pdf, "invitation-1.docx.pdf": doc },
  ])("批量缺失、错名、伪 PDF 均拒绝交付", async (files) => {
    const url = serve(
      () =>
        new Response(zipSync(files), {
          headers: { "Content-Type": "application/zip" },
        }),
    );
    await expect(convertInvitationPdfs([doc, doc], { url })).rejects.toThrow(
      "结果不完整",
    );
  });

  test("错误页面不能当成 PDF", async () => {
    const url = serve(
      () =>
        new Response("<html>Bad gateway</html>", {
          headers: { "Content-Type": "text/html" },
        }),
    );
    await expect(convertInvitationPdfs([doc], { url })).rejects.toThrow(
      "结果不完整",
    );
  });

  test("ZIP 声明的解压体积超过上限时拒绝分配", async () => {
    const archive = zipSync({
      "invitation-0.docx.pdf": pdf,
      "invitation-1.docx.pdf": pdf,
    });
    const view = new DataView(archive.buffer);
    for (let i = 0; i < archive.length - 28; i++) {
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 24, INVITATION_DOWNLOAD_MAX_BYTES + 1, true);
        break;
      }
    }
    const url = serve(
      () =>
        new Response(archive, {
          headers: {
            "Content-Type": "application/zip",
          },
        }),
    );
    await expect(convertInvitationPdfs([doc, doc], { url })).rejects.toThrow(
      "500 MB",
    );
  });

  test("服务错误不泄露上游正文", async () => {
    const url = serve(
      () => new Response("internal configuration secret", { status: 500 }),
    );
    await expect(convertInvitationPdfs([doc], { url })).rejects.toThrow(
      "PDF 转换失败",
    );
  });

  test("转换有界超时", async () => {
    const url = serve(async () => {
      await Bun.sleep(100);
      return new Response(pdf);
    });
    await expect(
      convertInvitationPdfs([doc], { url, timeoutMs: 10 }),
    ).rejects.toThrow("转换超时");
  });

  test("取消下载停止等待", async () => {
    const url = serve(() => new Response(pdf));
    await expect(
      convertInvitationPdfs([doc], { url, signal: AbortSignal.abort() }),
    ).rejects.toThrow("已取消");
  });

  test("未配置 PDF 不影响 Word 原字节下载", async () => {
    await expect(convertInvitationPdfs([doc], { url: "" })).rejects.toThrow(
      "尚未配置",
    );
    const result = await prepareInvitationDownload(
      { "活动_张三.docx": doc },
      "docx",
    );
    expect(result.fileName).toBe("活动_张三.docx");
    expect(result.bytes).toBe(doc);
  });
});
