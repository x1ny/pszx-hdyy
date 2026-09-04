import { describe, expect, test } from "bun:test";
import { XLSX_MIME_TYPE } from "./import-workbook";
import { memberImportRoutes } from "./routes.import";

describe("人员导入路由", () => {
  test("四个业务动作都注册在链上", () => {
    const paths = [
      ...new Set(
        memberImportRoutes.routes
          .filter((route) => route.method === "POST")
          .map((route) => route.path),
      ),
    ];

    expect(paths).toEqual([
      "/getImportTemplate",
      "/previewImport",
      "/validateImport",
      "/commitImport",
    ]);
  });

  test("未登录时拒绝解析文件", async () => {
    const form = new FormData();
    form.set(
      "file",
      new File(["not xlsx"], "people.xlsx", { type: XLSX_MIME_TYPE }),
    );

    const response = await memberImportRoutes.request("/previewImport", {
      method: "POST",
      body: form,
    });

    expect(await response.json()).toEqual({
      code: "UNAUTHORIZED",
      message: "未登录",
    });
  });
});
