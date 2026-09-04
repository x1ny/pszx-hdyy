import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AgendaLine, Segment } from "#/features/agenda/queries";
import type { TimelineDay } from "../-utils";
import { AgendaTimeline } from "./agenda-timeline";

const mainLine: AgendaLine = {
  id: 1,
  activityId: 1,
  lineType: "main",
  name: null,
  sortOrder: 0,
};

const testSegment: Segment = {
  id: 1,
  activityId: 1,
  agendaLineId: 1,
  name: "长环节",
  segmentType: "other",
  startTime: "2026-09-10T21:00:00.000Z",
  endTime: "2026-09-11T00:00:00.000Z",
  locationText: null,
  description: null,
  ownerName: null,
  status: "active",
  memberEnabled: false,
  seatingEnabled: false,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const longDay: TimelineDay = {
  key: "2026-09-10",
  label: "09/10周四",
  ticks: [
    { label: "09:00", leftPct: 0 },
    { label: "15:00", leftPct: 40 },
    { label: "00:00", leftPct: 100 },
  ],
  lanes: [
    {
      line: mainLine,
      rows: [
        [
          {
            segment: testSegment,
            leftPct: 80,
            widthPct: 20,
            dayStartMs: new Date("2026-09-10T00:00:00.000Z").getTime(),
            continuesFromPrevDay: false,
            continuesNextDay: false,
          },
        ],
      ],
    },
  ],
  spanMinutes: 900,
  segmentCount: 1,
  carryOverCount: 0,
  bands: [],
};

describe("AgendaTimeline", () => {
  it("keeps the first and last tick labels inside the scroll viewport", () => {
    const { container } = render(
      <AgendaTimeline
        days={[longDay]}
        demandsBySegment={new Map()}
        memberCounts={new Map()}
        seatingStatusBySegment={new Map()}
        onSelect={() => undefined}
      />,
    );

    const tickTrack = container.querySelector(".relative.h-5.flex-1");
    const ticks = tickTrack?.querySelectorAll(":scope > span");

    expect(ticks).toHaveLength(3);
    expect(ticks?.[0]).toHaveClass("translate-x-0");
    expect(ticks?.[1]).toHaveClass("-translate-x-1/2");
    expect(ticks?.[2]).toHaveClass("-translate-x-full");
  });
});
