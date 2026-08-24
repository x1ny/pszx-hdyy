import { describe, expect, test } from "bun:test";
import { fileRoutes } from "./routes";

describe("文件上传", () => {
  test("未登录时拒绝上传", async () => {
    const form = new FormData();
    form.set(
      "file",
      new File(["file contents"], "example.txt", { type: "text/plain" }),
    );

    const response = await fileRoutes.request("/upload", {
      method: "POST",
      body: form,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      code: "UNAUTHORIZED",
      message: "未登录",
    });
  });
});
