import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { EventHero } from "./-components/event-hero";
import { KeyGate } from "./-components/key-gate";
import { ScheduleList } from "./-components/schedule-list";
import { SeatMapOverlay } from "./-components/seat-map-overlay";
import { ToastLayer } from "./-components/toast-layer";
import { ITINERARY } from "./-data";

export const Route = createFileRoute("/itinerary/")({
  component: ItineraryPage,
});

const UNLOCK_KEY = "itinerary-unlocked";

/** 隐私模式 / 禁用存储时读写都会抛，抛了就当没解锁，门重新出现一次而已。 */
function readUnlocked(): boolean {
  try {
    return sessionStorage.getItem(UNLOCK_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * 嘉宾的专属行程页。
 *
 * **静态页：数据来自 `-data.ts` 里的常量，还没接后端。** 真实版本会用一次性
 * 分享链接上的 token 换数据（`?k=xxx`），身份体系定案前不动（见 AGENTS.md
 * 「认证」）。所有交互都是纯前端的：折叠、打开面板、复制、拨号、拉起地图 App。
 *
 * 进页面先过一道手机号校验（`KeyGate`）——链接会被转发，光有链接就能看到别人
 * 的座位和司机电话。**现在这道门只是界面，校验逻辑整个在前端**，接后端时连
 * 同下面这个 sessionStorage 标记一起换成服务端签发的凭证。
 *
 * 白色内容面从头图下缘一路白到底，卡片之间靠描边和阴影分隔——中间换灰底会
 * 在头图卡下方留一道很脏的接缝。
 */
function ItineraryPage() {
  const data = ITINERARY;
  const [unlocked, setUnlocked] = useState(readUnlocked);
  // 座位图面板归页面持有：每张议程卡带着自己的分区和座位号来开它，图上标出
  // 的才是「这一场」的座位，而不是笼统的「你的分区」。
  const [seatTarget, setSeatTarget] = useState<{
    zone?: string;
    seat?: string;
  } | null>(null);

  const unlock = () => {
    try {
      sessionStorage.setItem(UNLOCK_KEY, "1");
    } catch {
      /* 隐私模式：下次打开再验一遍，不影响这一次 */
    }
    setUnlocked(true);
  };

  if (!unlocked) return <KeyGate onUnlock={unlock} />;

  return (
    <ToastLayer>
      <div className="mx-auto min-h-dvh w-full max-w-[480px] bg-surface pb-6">
        <EventHero
          userName={data.user.name}
          greeting={data.user.greeting}
          event={data.event}
        />

        <div className="pt-4">
          <ScheduleList
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
      </div>
    </ToastLayer>
  );
}
