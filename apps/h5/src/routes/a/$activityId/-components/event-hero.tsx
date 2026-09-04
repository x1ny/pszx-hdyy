import { useState } from "react";
import { PLACEHOLDER_CONTACT } from "../-placeholders";
import type { ActivityInfo } from "../-queries";
import { formatActivityDate } from "../-utils";
import { EventDetailOverlay } from "./event-detail-overlay";
import { Icon } from "./icon";
import { PhoneChip } from "./phone-chip";

/**
 * 活动概况：200px 头图 + 一张切进图里的白卡（上圆角 24px）。
 *
 * 白卡从这里一路白到页面底部，中间不再换底色 —— 头图下面接灰底的话，卡片和
 * 页面之间那道白→灰的接缝在真机上很脏。卡片之间靠描边和阴影分隔。
 *
 * 头图只回答「是什么活动、什么时候」。地点挪进了「活动详情」面板：下面每一场
 * 议程都自带更精确的地点，这里再放一个总的属于重复，还占掉首屏最值钱的位置。
 *
 * 现场联系人放在首屏、不用滚：嘉宾在门口找不到人时第一反应是找电话。**但它
 * 现在是占位** —— 库里没有联系人电话列，所以号码是脱敏形态且不可拨，见
 * `-placeholders.ts` 顶部那条规则。
 */
export function EventHero({
  userName,
  activity,
}: {
  userName: string;
  activity: ActivityInfo;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const { dateText, timeRange } = formatActivityDate(
    activity.startTime,
    activity.endTime,
  );

  return (
    <section className="relative">
      <div className="relative h-[12.5rem] overflow-hidden bg-brand-gradient">
        {/* 没有画廊图片时就留渐变底 —— 塞一张占位图会让整页看起来像是加载失败。
            /api/file/:fileId 刻意没挂登录守卫，免登录取得到。 */}
        {activity.heroFileId && (
          <img
            src={`/api/file/${activity.heroFileId}`}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            draggable={false}
          />
        )}
        {/* 白卡切进来的那条边压一层暗角，否则图底部亮的时候接缝很硬 */}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/15 to-transparent"
        />
        {/* 头图顶部是浅色的，所以身份条用磨砂浅底 + 深字，不用深底白字。
            这里显示的姓名同时是重号时的唯一补救：共用一个手机号的两个人里
            只有第一位能看到自己的行程，另一位至少能一眼看出名字不是自己。 */}
        <div className="absolute top-3 right-4 flex items-center gap-1.5 rounded-full border border-white/60 bg-white/55 py-1 pr-3 pl-2.5 backdrop-blur-md">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand" />
          <span className="font-bold text-caption text-ink-2">
            {userName} 的专属行程
          </span>
        </div>
      </div>

      <div className="relative -mt-6 rounded-t-[1.5rem] bg-surface px-4 pt-4 pb-4">
        <h1 className="line-clamp-2 select-text text-display">
          {activity.name}
        </h1>

        <div className="mt-2 flex items-center gap-1.5">
          <Icon name="clock" size={14} className="shrink-0 text-ink-3" />
          <span className="text-body text-ink-2">{dateText}</span>
          <span className="font-extrabold text-body text-ink-1 tabular-nums">
            {timeRange}
          </span>
        </div>

        {activity.paragraphs.length > 0 && (
          <div className="mt-1.5">
            <p className="line-clamp-2 select-text text-body text-ink-3">
              {activity.paragraphs[0]}
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
        )}

        <div className="mt-2.5 flex items-center gap-2.5 rounded-xl border border-line bg-sunken px-2.5 py-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
            <Icon name="user-round" size={15} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-caption text-ink-3">现场联系人</span>
            <span className="block truncate font-bold text-body text-ink-1">
              {PLACEHOLDER_CONTACT.name}
            </span>
          </span>
          <PhoneChip phone={PLACEHOLDER_CONTACT.phone} placeholder />
        </div>
      </div>

      <EventDetailOverlay
        open={detailOpen}
        onOpenChange={setDetailOpen}
        activity={activity}
        dateText={dateText}
        timeRange={timeRange}
      />
    </section>
  );
}
