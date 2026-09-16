import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { AgendaItem, OrganizationSeatMap } from "../-queries";
import { organizationSeatMapQueryOptions } from "../-queries";
import { OverlaySheet } from "./overlay-sheet";
import {
  SeatMapCanvas,
  SeatMapFallback,
  SeatMapPlaceholder,
} from "./seat-map-sheet";

/**
 * 没有个人排座时的团体座位面板。
 *
 * 它刻意不是「我的座位」的改名版：红点表示团体整体占用，不暗示其中有一把椅子
 * 是当前嘉宾的固定位置。其余位置仍然没有编号或人员信息，H5 不会借团体权限泄露
 * 任何别人的排座。
 */
export function OrganizationSeatMapSheet({
  shareToken,
  item,
  onClose,
}: {
  shareToken: string;
  item: AgendaItem | null;
  onClose: () => void;
}) {
  const lastItem = useRef<AgendaItem | null>(null);
  if (item) lastItem.current = item;
  const shown = item ?? lastItem.current;
  const query = useQuery(
    organizationSeatMapQueryOptions(shareToken, shown?.id ?? null),
  );

  return (
    <OverlaySheet
      open={item !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="我的团体座位"
    >
      <div className="px-4 pt-3 pb-8">
        {shown?.organizationSeat && (
          <div className="rounded-2xl border border-brand/15 bg-brand-soft/35 p-5">
            <div className="break-words font-extrabold text-[1.75rem] leading-9 text-brand tabular-nums">
              {shown.organizationSeat.seat}
            </div>
            {shown.organizationSeat.venueName && (
              <div className="mt-3 break-words text-title text-ink-1">
                {shown.organizationSeat.venueName}
              </div>
            )}
            {shown.organizationSeat.zone && (
              <div
                className={
                  shown.organizationSeat.venueName
                    ? "mt-0.5 break-words text-body text-ink-2"
                    : "mt-3 break-words text-title text-ink-1"
                }
              >
                {shown.organizationSeat.zone}
              </div>
            )}
            <div className="mt-2 truncate text-caption text-ink-3">
              议程：{shown.name}
            </div>
          </div>
        )}

        <div className="mt-3">
          {query.isPending && <SeatMapPlaceholder />}
          {query.isError && <SeatMapFallback />}
          {query.data && <OrganizationSeatMapBody data={query.data} />}
        </div>
      </div>
    </OverlaySheet>
  );
}

function OrganizationSeatMapBody({ data }: { data: OrganizationSeatMap }) {
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  if (!data.map || data.map.mine.length === 0) return <SeatMapFallback />;

  const current =
    data.map.sections?.find(
      (section) => section.externalId === selectedSection,
    ) ??
    data.map.sections?.[0] ??
    data.map;
  return (
    <>
      {data.map.sections && (
        <div className="mb-3 flex flex-wrap gap-2">
          {data.map.sections.map((section) => (
            <button
              key={section.externalId}
              type="button"
              aria-pressed={current === section}
              className="rounded-lg bg-page px-3 py-2 text-body text-brand"
              onClick={() => setSelectedSection(section.externalId)}
            >
              {section.name}
            </button>
          ))}
        </div>
      )}
      <SeatMapCanvas
        map={current}
        highlights={current.mine}
        highlightMode="seats"
      />
    </>
  );
}
