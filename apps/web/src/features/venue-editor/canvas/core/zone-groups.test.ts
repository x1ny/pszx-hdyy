import { describe, expect, test } from "vitest";
import { buildPlanDoc } from "../../plan-doc";
import { groupZones, removeZones } from "./commands";
import { type CanvasDoc, parseCanvasDoc, projectCanvas } from "./document";
import { execute, initialState, undo } from "./history";
import { hitZone } from "./interaction";

const fixture = (): CanvasDoc => ({
  schemaVersion: 1,
  world: { width: 1000, height: 800 },
  zones: ["A1", "A2"].map((name, ordinal) => ({
    externalId: name,
    name,
    kind: "seating",
    ordinal,
    fill: "#ffffff",
    stroke: "#000000",
    shape: {
      type: "rect",
      x: 100 + ordinal * 200,
      y: 100,
      width: 100,
      height: 100,
    },
  })),
  seats: ["A1", "A2"].map((zoneExternalId, ordinal) => ({
    externalId: `s${ordinal}`,
    zoneExternalId,
    label: "1排1号",
    kind: "seat",
    rank: "normal",
    ordinal: 0,
    x: -30,
    y: 20,
  })),
  rows: [],
});

describe("业务区域和独立分区", () => {
  test("成组只改变归属；座位、坐标和 ID 保持，支持撤销和读取", () => {
    const before = fixture();
    const state = execute(
      initialState(before),
      groupZones(["A1", "A2"], "观众区"),
    );
    expect(state.doc.seats).toEqual(before.seats);
    expect(state.doc.zones.slice(0, 2).map((zone) => zone.shape)).toEqual(
      before.zones.map((zone) => zone.shape),
    );
    expect(parseCanvasDoc(state.doc)).toEqual(state.doc);
    expect(
      projectCanvas(state.doc).zones.filter((zone) => zone.parentExternalId),
    ).toHaveLength(2);
    expect(undo(state).doc).toEqual(before);
    expect(hitZone(state.doc, { x: 10, y: 10 })).toBeNull();
  });
  test("整组建方案保留独立坐标、重复本地编号及分布，排除停用分区", () => {
    const state = execute(
      initialState(fixture()),
      groupZones(["A1", "A2"], "观众区"),
    );
    const group = state.doc.zones.find((zone) => zone.isGroup);
    if (!group) throw new Error("Missing group");
    const plan = buildPlanDoc({
      layoutData: state.doc,
      zoneExternalId: group.externalId,
      zoneName: group.name,
      zoneKind: "seating",
    });
    expect(plan.doc.zones).toHaveLength(2);
    expect(plan.doc.seats).toEqual(state.doc.seats);
    expect(plan.seats.map((seat) => seat.label)).toEqual([
      "A1 · 1排1号",
      "A2 · 1排1号",
    ]);
    expect(plan.seats.map((seat) => seat.zoneExternalId)).toEqual(["A1", "A2"]);
    expect(plan.sections).toHaveLength(2);
    const partial = buildPlanDoc({
      layoutData: state.doc,
      zoneExternalId: group.externalId,
      zoneName: group.name,
      zoneKind: "seating",
      sectionExternalIds: ["A1"],
    });
    expect(partial.doc.zones).toHaveLength(1);
    expect(partial.seats[0].label).toBe("A1 · 1排1号");
  });
  test("解散组保留分区座位，删除分区不删除兄弟", () => {
    const state = execute(
      initialState(fixture()),
      groupZones(["A1", "A2"], "观众区"),
    );
    const group = state.doc.zones.find((zone) => zone.isGroup);
    if (!group) throw new Error("Missing group");
    const ungrouped = execute(state, removeZones([group.externalId]));
    expect(ungrouped.doc.seats).toEqual(state.doc.seats);
    expect(ungrouped.doc.zones.every((zone) => !zone.parentExternalId)).toBe(
      true,
    );
    const removed = execute(state, removeZones(["A1"]));
    expect(removed.doc.seats.map((seat) => seat.zoneExternalId)).toEqual([
      "A2",
    ]);
  });
  test("拒绝悬空归属及嵌套分组，旧画布仍能读", () => {
    expect(parseCanvasDoc(fixture())).not.toBeNull();
    const broken = fixture();
    broken.zones[0].parentExternalId = "missing";
    expect(parseCanvasDoc(broken)).toBeNull();
    broken.zones[1].isGroup = true;
    broken.zones[1].parentExternalId = "A1";
    expect(parseCanvasDoc(broken)).toBeNull();
  });
});
