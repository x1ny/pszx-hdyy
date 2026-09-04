import { describe, expect, it } from "vitest";
import {
  addManualMember,
  addPickedMembers,
  bindMemberToResource,
  buildSavePayload,
  type ConfigDraft,
  createEmptyDraft,
  detachResource,
  draftFromConfig,
  emptyNewMember,
  isDirty,
  removeMember,
  setMemberRole,
  setResourceField,
  unbindMemberFromResource,
  voidResource,
} from "./-draft";
import type { SegmentConfig } from "./-queries";

/**
 * 这个文件钉的是**意图语义**：草稿翻译成入参时，必须只描述"用户动过什么"，
 * 不能描述"页面现在长什么样"。写错了不会报错，只会在新旧界面并存时静默删掉
 * 别人加的数据——正是这次改造唯一一处会丢数据的地方。
 */

const config: SegmentConfig = {
  segment: {
    id: 10,
    activityId: 1,
    agendaLineId: 5,
    name: "开幕式",
    segmentType: "keynote",
    startTime: "2026-04-17T01:00:00.000Z",
    endTime: "2026-04-17T02:00:00.000Z",
    locationText: "主会场",
    description: null,
    ownerName: "小周",
    status: "active",
    memberEnabled: true,
    seatingEnabled: true,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
  },
  members: [
    {
      id: 101,
      activityMemberId: 201,
      memberId: 301,
      name: "林建辉",
      gender: "男",
      mobile: "13805950001",
      companyPosition: "鸿星尔克集团 · 董事长",
      segmentRole: "企业家嘉宾",
      originType: "manual",
      source: "王总客人",
      groupName: "企业家代表团",
      ownerName: null,
    },
    {
      id: 102,
      activityMemberId: 202,
      memberId: 302,
      name: "蔡丽云",
      gender: "女",
      mobile: "13605950004",
      companyPosition: "泉州晚报 · 时政部主任",
      segmentRole: null,
      originType: "manual",
      source: "李局客人",
      groupName: "媒体代表团",
      ownerName: null,
    },
  ],
  demands: [
    {
      id: 401,
      activityId: 1,
      segmentId: 10,
      resourceType: "transport",
      handling: "arrange",
      description: "演讲嘉宾 3 人从机场接站",
      estimatedCount: 3,
      ownerName: null,
      resources: [
        {
          id: 501,
          activityId: 1,
          resourceType: "transport",
          transportScene: "pickup",
          name: "机场一号车",
          quantity: 1,
          startTime: null,
          endTime: null,
          location: "T2 到达口",
          vehicleInfo: "闽C·12345",
          driverName: "老陈",
          driverPhone: "13800000000",
          ownerName: null,
          remark: null,
          status: "active",
          createdAt: "2026-04-01T00:00:00.000Z",
          updatedAt: "2026-04-01T00:00:00.000Z",
          bindings: [
            {
              id: 601,
              activityMemberId: 201,
              memberId: 301,
              name: "林建辉",
              mobile: "13805950001",
              inSegment: true,
            },
            {
              id: 602,
              activityMemberId: 999,
              memberId: 399,
              name: "别的环节的人",
              mobile: null,
              inSegment: false,
            },
          ],
        },
      ],
    },
  ],
};

const load = () => draftFromConfig(config, "main");

const payload = (draft: ConfigDraft) =>
  buildSavePayload({
    draft,
    activityId: 1,
    segmentId: 10,
    mainLineId: 5,
    cascadeSeats: false,
  });

describe("draftFromConfig", () => {
  it("行存在即已开启，其余三类需求是关着的空格子", () => {
    const draft = load();
    const transport = draft.demands.find((d) => d.resourceType === "transport");
    const dining = draft.demands.find((d) => d.resourceType === "dining");

    expect(transport?.enabled).toBe(true);
    expect(transport?.estimatedCount).toBe("3");
    expect(dining?.enabled).toBe(false);
    expect(draft.demands).toHaveLength(4);
  });

  it("绑定名单包含不属于本环节的人，并标出来", () => {
    const draft = load();
    const bindings = draft.demands[0].resources[0].bindings;
    expect(bindings).toHaveLength(2);
    expect(bindings.map((b) => b.inSegment)).toEqual([true, false]);
  });
});

describe("人员意图", () => {
  it("没动过任何人时，三个意图数组都是空的", () => {
    const result = payload(load());
    expect(result.members).toMatchObject({
      add: [],
      addNew: [],
      remove: [],
      updateRoles: [],
    });
  });

  /**
   * 最关键的一条：页面上原本就有的两个人**不会**出现在入参里。如果它们出现了，
   * 就说明发的是目标状态而不是意图，并存期就会覆盖别人的改动。
   */
  it("只发改过身份的那一行，没动过的行不出现", () => {
    const draft = setMemberRole(load(), "s102", "主流媒体代表");
    const result = payload(draft);

    expect(result.members?.updateRoles).toEqual([
      { relationId: 102, segmentRole: "主流媒体代表" },
    ]);
  });

  it("身份改回原值等于没改", () => {
    const draft = setMemberRole(
      setMemberRole(load(), "s101", "社会人士"),
      "s101",
      "企业家嘉宾",
    );
    expect(payload(draft).members?.updateRoles).toEqual([]);
  });

  it("移除已保存的人发 relationId，移除草稿里的人不发", () => {
    const picked = addPickedMembers(load(), [
      {
        id: 303,
        name: "陈小敏",
        companyPosition: null,
        mobile: null,
        organizationId: null,
      },
    ]);
    const removedDraft = removeMember(picked, "n1");
    expect(payload(removedDraft).members?.remove).toEqual([]);
    expect(payload(removedDraft).members?.add).toEqual([]);

    const removedSaved = removeMember(load(), "s101");
    expect(payload(removedSaved).members?.remove).toEqual([101]);
  });

  it("已在名单里的人不会被重复添加", () => {
    const draft = addPickedMembers(load(), [
      {
        id: 301,
        name: "林建辉",
        companyPosition: null,
        mobile: null,
        organizationId: null,
      },
    ]);
    expect(draft.members).toHaveLength(2);
  });

  it("手动录入的人走 addNew，带主档字段和同一个 tempKey", () => {
    const draft = addManualMember(load(), {
      ...emptyNewMember(),
      name: "新来的",
      mobile: "13900000000",
    });
    const result = payload(draft);

    expect(result.members?.add).toEqual([]);
    expect(result.members?.addNew).toHaveLength(1);
    expect(result.members?.addNew?.[0]).toMatchObject({
      tempKey: "n1",
      member: { name: "新来的", mobile: "13900000000" },
    });
  });
});

describe("资源安排意图", () => {
  it("没改过的已有资源不发字段，只保持关联", () => {
    const result = payload(load());
    const resource = result.demands?.[0].resources?.[0];
    expect(resource).toMatchObject({ kind: "existing", resourceId: 501 });
    expect(resource && "fields" in resource ? resource.fields : "missing").toBe(
      null,
    );
  });

  it("改过字段的已有资源才发字段", () => {
    const draft = setResourceField(
      load(),
      "transport",
      "r501",
      "name",
      "机场二号车",
    );
    const resource = payload(draft).demands?.[0].resources?.[0];
    expect(
      resource && "fields" in resource ? resource.fields?.name : undefined,
    ).toBe("机场二号车");
  });

  /**
   * 移除一条资源安排默认是**解除关联**，不是作废——那辆车还在活动台账里，
   * 只是不再服务这条需求。作废是另一个动作，走 voidResourceIds。
   */
  it("移除是解除关联，作废是另一个动作", () => {
    const detached = payload(detachResource(load(), "transport", "r501"));
    expect(detached.demands?.[0].unlinkResourceIds).toEqual([501]);
    expect(detached.demands?.[0].voidResourceIds).toEqual([]);
    expect(detached.demands?.[0].resources).toEqual([]);

    const voided = payload(voidResource(load(), "transport", "r501"));
    expect(voided.demands?.[0].voidResourceIds).toEqual([501]);
    expect(voided.demands?.[0].unlinkResourceIds).toEqual([]);
  });

  it("关掉一类需求就是不发它——矩阵下不出现即删除", () => {
    const draft = load();
    const off: ConfigDraft = {
      ...draft,
      demands: draft.demands.map((demand) =>
        demand.resourceType === "transport"
          ? { ...demand, enabled: false }
          : demand,
      ),
    };
    expect(payload(off).demands).toEqual([]);
  });
});

describe("人员绑定意图", () => {
  it("已保存的绑定不重发", () => {
    const result = payload(load());
    const resource = result.demands?.[0].resources?.[0];
    expect(
      resource && "bindTargets" in resource ? resource.bindTargets : undefined,
    ).toEqual([]);
  });

  it("绑本环节已有的人发 activityMemberId", () => {
    const draft = load();
    const target = draft.members.find((row) => row.key === "s102");
    if (!target) throw new Error("找不到人");
    const bound = bindMemberToResource(draft, "transport", "r501", target);

    const resource = payload(bound).demands?.[0].resources?.[0];
    expect(
      resource && "bindTargets" in resource ? resource.bindTargets : undefined,
    ).toEqual([{ activityMemberId: 202 }]);
  });

  /**
   * 绑一个草稿里刚加、还没有活动关系 id 的人：只能用 tempKey，由服务端在
   * 同一个事务里建完人之后回填。这条链断了的症状是"保存成功但车上没人"。
   */
  it("绑草稿里刚加的人发 memberTempKey，且和 addNew 的 tempKey 对得上", () => {
    const draft = addManualMember(load(), {
      ...emptyNewMember(),
      name: "新来的",
    });
    const target = draft.members.find((row) => row.newMember !== null);
    if (!target) throw new Error("找不到人");
    const bound = bindMemberToResource(draft, "transport", "r501", target);
    const result = payload(bound);

    const resource = result.demands?.[0].resources?.[0];
    const targets =
      resource && "bindTargets" in resource ? resource.bindTargets : [];
    expect(targets).toEqual([{ memberTempKey: target.key }]);
    expect(result.members?.addNew?.[0]?.tempKey).toBe(target.key);
  });

  it("解绑本环节的人发绑定记录 id", () => {
    const draft = unbindMemberFromResource(load(), "transport", "r501", "b601");
    const resource = payload(draft).demands?.[0].resources?.[0];
    expect(
      resource && "unbindIds" in resource ? resource.unbindIds : undefined,
    ).toEqual([601]);
  });

  /** 不属于本环节的绑定在这里是只读的——动它就是越界改别的环节的数据。 */
  it("不能解绑来自其他环节的人", () => {
    const draft = unbindMemberFromResource(load(), "transport", "r501", "b602");
    const resource = payload(draft).demands?.[0].resources?.[0];
    expect(
      resource && "unbindIds" in resource ? resource.unbindIds : undefined,
    ).toEqual([]);
    expect(draft.demands[0].resources[0].bindings).toHaveLength(2);
  });

  it("移除一个人会撤掉他在本页的草稿绑定，但不动已保存的绑定", () => {
    const draft = load();
    const target = draft.members.find((row) => row.key === "s102");
    if (!target) throw new Error("找不到人");

    const bound = bindMemberToResource(draft, "transport", "r501", target);
    expect(bound.demands[0].resources[0].bindings).toHaveLength(3);

    const removed = removeMember(bound, "s102");
    const bindings = removed.demands[0].resources[0].bindings;
    expect(bindings).toHaveLength(2);
    expect(bindings.every((binding) => binding.bindingId !== null)).toBe(true);
  });
});

describe("isDirty", () => {
  it("载入后未改动不算脏", () => {
    expect(isDirty(load(), load())).toBe(false);
  });

  it("改任何一块都算脏", () => {
    const original = load();
    expect(isDirty(setMemberRole(original, "s101", "社会人士"), original)).toBe(
      true,
    );
    expect(
      isDirty(
        setResourceField(original, "transport", "r501", "name", "改了"),
        original,
      ),
    ).toBe(true);
  });
});

describe("新建环节", () => {
  it("空草稿有四个关着的需求格子，且不发任何人员意图", () => {
    const draft = createEmptyDraft();
    const result = buildSavePayload({
      draft: {
        ...draft,
        base: {
          ...draft.base,
          name: "新环节",
          startTime: "2026-04-17T09:00",
          endTime: "2026-04-17T10:00",
        },
      },
      activityId: 1,
      segmentId: null,
      mainLineId: null,
      cascadeSeats: false,
    });

    expect(result.segmentId).toBe(null);
    // 主线还不存在时传 null，服务端懒创建。
    expect(result.base.agendaLineId).toBe(null);
    expect(result.demands).toEqual([]);
    expect(result.members?.add).toEqual([]);
  });

  it("选了新建并行线时带上线路名、agendaLineId 传 null", () => {
    const draft = createEmptyDraft();
    const result = buildSavePayload({
      draft: {
        ...draft,
        base: {
          ...draft.base,
          name: "分论坛",
          lineKey: "new",
          newLineName: "分论坛 A",
          startTime: "2026-04-17T09:00",
          endTime: "2026-04-17T10:00",
        },
      },
      activityId: 1,
      segmentId: null,
      mainLineId: 5,
      cascadeSeats: false,
    });

    expect(result.newLineName).toBe("分论坛 A");
    expect(result.base.agendaLineId).toBe(null);
  });
});
