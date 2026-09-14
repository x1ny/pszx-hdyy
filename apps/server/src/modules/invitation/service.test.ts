import { describe, expect, test } from "bun:test";
import { buildInvitationFileName } from "./service";

describe("邀请函文件名", () => {
  test("由模板文件名主体和邀请对象姓名组成", () => {
    expect(
      buildInvitationFileName({
        templateFileName: "2026泉州时尚周（秋冬）邀请函.docx",
        recipientName: "XXX",
      }),
    ).toBe("2026泉州时尚周（秋冬）邀请函——XXX.docx");
  });

  test("去除模板扩展名并清理文件名中的非法字符", () => {
    expect(
      buildInvitationFileName({
        templateFileName: "templates\\正式邀请函.docx",
        recipientName: "张/三",
      }),
    ).toBe("正式邀请函——张_三.docx");
  });
});
