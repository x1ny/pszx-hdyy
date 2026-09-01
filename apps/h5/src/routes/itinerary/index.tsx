import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { EventHero } from "./-components/event-hero";
import { ScheduleTabs } from "./-components/schedule-tabs";
import { SeatMapOverlay } from "./-components/seat-map-overlay";
import { StickyShareBar } from "./-components/sticky-share-bar";
import { ToastLayer } from "./-components/toast-layer";
import { ITINERARY } from "./-data";

export const Route = createFileRoute("/itinerary/")({
  component: ItineraryPage,
});

/**
 * 嘉宾的专属行程页。
 *
 * **静态页：数据来自 `-data.ts` 里的常量，还没接后端。** 真实版本会用一次性
 * 分享链接上的 token 换数据（`?k=xxx`），身份体系定案前不动（见 AGENTS.md
 * 「认证」）。所有交互都是纯前端的：折叠、切页签、打开面板、复制、拨号、
 * 拉起地图 App、生成 .ics。
 *
 * 白色内容面从头图下缘一路白到底，卡片之间靠描边和阴影分隔——中间换灰底会
 * 在头图卡下方留一道很脏的接缝。底部预留 5rem 给固定操作条让位。
 */
function ItineraryPage() {
  const data = ITINERARY;
  // 座位图面板归页面持有：每张议程卡带着自己的分区和座位号来开它，图上标出
  // 的才是「这一场」的座位，而不是笼统的「你的分区」。
  const [seatTarget, setSeatTarget] = useState<{
    zone?: string;
    seat?: string;
  } | null>(null);

  return (
    <ToastLayer>
      <div className="mx-auto min-h-dvh w-full max-w-[480px] bg-surface pb-20">
        <EventHero
          userName={data.user.name}
          greeting={data.user.greeting}
          event={data.event}
        />

        <div className="pt-4">
          <ScheduleTabs
            agenda={data.agenda}
            transfers={data.transfers}
            onShowSeatMap={(item) =>
              setSeatTarget({ zone: item.zone, seat: item.seat })
            }
          />
        </div>

        <SeatMapOverlay
          open={seatTarget !== null}
          onOpenChange={(open) => !open && setSeatTarget(null)}
          venueMap={data.venueMap}
          seatZone={seatTarget?.zone}
          seat={seatTarget?.seat}
        />
        <StickyShareBar event={data.event} />
      </div>
    </ToastLayer>
  );
}
