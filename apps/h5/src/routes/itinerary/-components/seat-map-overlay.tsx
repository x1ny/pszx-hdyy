import { cn } from "#/shared/lib/utils";
import type { VenueMapInfo } from "../-data";
import { OverlaySheet } from "./overlay-sheet";
import { PillTag } from "./pill-tag";
import { SeatChart, zoneLetterOf } from "./seat-chart";

/**
 * 座位图面板：纯展示，没有任何可点的东西。
 *
 * 从议程卡的「座位图」进来，带着那一场的分区和座位号，所以图上标的是「这一
 * 场你坐哪」，而不是笼统的「你属于哪个区」——同一个人不同场次的座位是不一样的。
 */
export function SeatMapOverlay({
  open,
  onOpenChange,
  venueMap,
  seatZone,
  seat,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  venueMap: VenueMapInfo;
  seatZone?: string;
  seat?: string;
}) {
  return (
    <OverlaySheet open={open} onOpenChange={onOpenChange} title="座位图">
      <div className="px-4 pt-3">
        <SeatChart venueMap={venueMap} seatZone={seatZone} seat={seat} />
      </div>

      <div className="px-4 pt-2 pb-6">
        {venueMap.zones.map((z) => {
          const isTarget = z.key === zoneLetterOf(seatZone);
          return (
            <div
              key={z.key}
              className={cn(
                "relative flex min-h-13 w-full items-center gap-2.5 rounded-lg px-2.5 py-2",
                isTarget && "bg-brand-soft",
              )}
            >
              {isTarget && (
                <span className="absolute top-2 left-0 h-[calc(100%-1rem)] w-[3px] rounded-full bg-brand" />
              )}
              <PillTag
                variant={isTarget ? "solid" : "soft"}
                className={isTarget ? undefined : "bg-[#f1f2f5] text-ink-2"}
              >
                {z.key}
              </PillTag>
              <div className="min-w-0 flex-1">
                <div
                  className={cn(
                    "font-bold text-body",
                    isTarget ? "text-brand" : "text-ink-1",
                  )}
                >
                  {z.name}
                </div>
                <div className="text-caption text-ink-3">{z.desc}</div>
              </div>
              {isTarget && (
                <span className="shrink-0 font-bold text-brand text-caption">
                  我的分区
                </span>
              )}
            </div>
          );
        })}
      </div>
    </OverlaySheet>
  );
}
