import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
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
            <div className="mt-3 truncate text-title text-ink-1">
              {shown.locationText ?? shown.organizationSeat.zone}
            </div>
            {shown.locationText && (
              <div className="mt-1 text-body text-ink-2">
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
  if (!data.map || data.map.mine.length === 0) return <SeatMapFallback />;

  return (
    <SeatMapCanvas
      map={data.map}
      highlights={data.map.mine}
      highlightMode="seats"
    />
  );
}
