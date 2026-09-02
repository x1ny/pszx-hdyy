import { describe, expect, test } from "bun:test";
import { CreateInvitationBatchInput } from "./validation";

const common = {
  activityId: 1,
  templateId: 2,
  issueDate: "2026-09-01",
};

describe("CreateInvitationBatchInput 的收件对象模式", () => {
  test("个人模式接收人员编号并去重", () => {
    const result = CreateInvitationBatchInput.safeParse({
      ...common,
      recipientType: "member",
      memberIds: [11, 11, 12],
    });

    expect(result.success).toBe(true);
    if (result.success && result.data.recipientType === "member") {
      expect(result.data.memberIds).toEqual([11, 12]);
      expect(result.data).not.toHaveProperty("organizationIds");
    }
  });

  test("团体模式接收团体编号并去重", () => {
    const result = CreateInvitationBatchInput.safeParse({
      ...common,
      recipientType: "organization",
      organizationIds: [21, 21, 22],
    });

    expect(result.success).toBe(true);
    if (result.success && result.data.recipientType === "organization") {
      expect(result.data.organizationIds).toEqual([21, 22]);
      expect(result.data).not.toHaveProperty("memberIds");
    }
  });

  test("两种模式不能混用另一种编号字段", () => {
    expect(
      CreateInvitationBatchInput.safeParse({
        ...common,
        recipientType: "organization",
        memberIds: [11],
      }).success,
    ).toBe(false);
    expect(
      CreateInvitationBatchInput.safeParse({
        ...common,
        recipientType: "member",
        organizationIds: [21],
      }).success,
    ).toBe(false);
  });
});
