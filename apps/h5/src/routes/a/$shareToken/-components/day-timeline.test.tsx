import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgendaItem } from "../-queries";
import { type DayEntry, DayTimeline } from "./day-timeline";

const agendaEntry = (hideEndTimeInH5: boolean): DayEntry => ({
  kind: "agenda",
  key: "agenda-1-2026-09-18",
  time: "09:00",
  startTime: "09:00",
  endTime: "10:30",
  item: {
    id: 1,
    name: "闭门交流",
    hideEndTimeInH5,
    locationText: null,
    locationPoint: null,
    zone: null,
    seat: null,
    organizationSeat: null,
  } as AgendaItem,
  cars: [],
});

const renderAgenda = (hideEndTimeInH5: boolean) =>
  renderToStaticMarkup(
    <DayTimeline
      entries={[agendaEntry(hideEndTimeInH5)]}
      status={() => "upcoming"}
      onOpenSeatMap={() => {}}
      onOpenOrganizationSeatMap={() => {}}
    />,
  );

describe("H5 议程结束时间展示", () => {
  test("默认展示结束时间", () => {
    expect(renderAgenda(false)).toContain(">10:30<");
  });

  test("环节配置隐藏时不展示结束时间", () => {
    expect(renderAgenda(true)).not.toContain(">10:30<");
  });
});
