import { useState } from "react";
import type { EventInfo } from "../-data";
import { EventDetailOverlay } from "./event-detail-overlay";
import { Icon } from "./icon";
import { PhoneChip } from "./phone-chip";

/**
 * 活动概况：200px 头图 + 一张切进图里的白卡（上圆角 24px）。
 *
 * 白卡从这里一路白到页面底部，中间不再换底色——上一版在头图下面接了灰底，
 * 卡片和页面之间那道白→灰的接缝在真机上很脏。卡片之间靠描边和阴影分隔。
 *
 * 头图只回答「是什么活动、什么时候」。城市和场馆挪进了「活动详情」面板：
 * 下面每一场议程都自带更精确的地点和导航，这里再放一个总的场馆导航属于
 * 重复，还把首屏最值钱的位置占掉了。
 *
 * 现场联系人放在首屏、不用滚：嘉宾在门口找不到人时第一反应是找电话。
 */
export function EventHero({
  userName,
  greeting,
  event,
}: {
  userName: string;
  greeting: string;
  event: EventInfo;
}) {
  const [detailOpen, setDetailOpen] = useState(false);

  return (
    <section className="relative">
      <div className="relative h-[12.5rem] overflow-hidden bg-brand-gradient">
        <img
          src={event.heroImage}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
        />
        {/* 白卡切进来的那条边压一层暗角，否则图底部亮的时候接缝很硬 */}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/15 to-transparent"
        />
        {/* 头图顶部是浅色的，所以身份条用磨砂浅底 + 深字，不用深底白字 */}
        <div className="absolute top-3 right-4 flex items-center gap-1.5 rounded-full border border-white/60 bg-white/55 py-1 pr-3 pl-2.5 backdrop-blur-md">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand" />
          <span className="text-caption font-bold text-ink-2">
            {userName} 的{greeting}
          </span>
        </div>
      </div>

      <div className="relative -mt-6 rounded-t-[1.5rem] bg-surface px-4 pt-4 pb-4">
        <h1 className="line-clamp-2 select-text text-display">{event.title}</h1>

        <div className="mt-2 flex items-center gap-1.5">
          <Icon name="clock" size={14} className="shrink-0 text-ink-3" />
          <span className="text-body text-ink-2">{event.dateText}</span>
          <span className="font-extrabold text-body text-ink-1 tabular-nums">
            {event.timeRange}
          </span>
        </div>

        <div className="mt-1.5">
          <p className="line-clamp-2 select-text text-body text-ink-3">
            {event.intro}
          </p>
          <button
            type="button"
            onClick={() => setDetailOpen(true)}
            className="relative mt-0.5 flex items-center gap-0.5 py-1 font-bold text-body text-brand before:absolute before:-inset-x-1 before:-inset-y-2 before:content-['']"
          >
            查看详情
            <Icon name="chevron-down" size={12} className="-rotate-90" />
          </button>
        </div>

        <div className="mt-2.5 flex items-center gap-2.5 rounded-xl border border-line bg-sunken px-2.5 py-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
            <Icon name="user-round" size={15} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-caption text-ink-3">现场联系人</span>
            <span className="block truncate font-bold text-body text-ink-1">
              {event.contact.name}
            </span>
          </span>
          <PhoneChip
            phone={event.contact.phone}
            ariaLabel={`拨打工作人员 ${event.contact.name} 的电话`}
          />
        </div>
      </div>

      <EventDetailOverlay
        open={detailOpen}
        onOpenChange={setDetailOpen}
        event={event}
      />
    </section>
  );
}
