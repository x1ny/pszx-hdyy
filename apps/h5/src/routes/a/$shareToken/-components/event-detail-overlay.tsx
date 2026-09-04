import type { ActivityInfo } from "../-queries";
import { OverlaySheet } from "./overlay-sheet";

/**
 * 活动详情面板 —— 头图那段简介点「查看详情」推上来的全文。
 *
 * 顶部先复述一遍活动身份（标题 / 时间 / 地点），因为面板盖住了头图：用户滚了
 * 两屏之后打开它，需要知道自己在看哪一场。
 *
 * 日期两行由调用方算好传进来，不在这里重算 —— 头图上显示的就是同一份，两处
 * 各算一次迟早会因为其中一处改了格式而对不上。
 */
export function EventDetailOverlay({
  open,
  onOpenChange,
  activity,
  dateText,
  timeRange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activity: ActivityInfo;
  dateText: string;
  timeRange: string;
}) {
  return (
    <OverlaySheet open={open} onOpenChange={onOpenChange} title="活动详情">
      <div className="px-4 pt-3 pb-8">
        <div className="rounded-xl border border-line bg-surface p-3">
          <h2 className="text-title leading-snug">{activity.name}</h2>
          <div className="mt-1.5 flex items-center gap-1.5 text-caption text-ink-3">
            <span>{dateText}</span>
            <span className="font-bold text-ink-2 tabular-nums">
              {timeRange}
            </span>
          </div>
          {activity.location && (
            <div className="mt-0.5 text-caption text-ink-3">
              {activity.location}
            </div>
          )}
        </div>

        {activity.paragraphs.length > 0 && (
          <>
            <h3 className="mt-4 text-eyebrow text-ink-3">活动介绍</h3>
            <div className="mt-1.5 space-y-2">
              {activity.paragraphs.map((paragraph) => (
                <p
                  key={paragraph.slice(0, 12)}
                  className="select-text text-body text-ink-2 leading-relaxed"
                >
                  {paragraph}
                </p>
              ))}
            </div>
          </>
        )}

        {activity.organizers.length > 0 && (
          <>
            <h3 className="mt-4 text-eyebrow text-ink-3">组织单位</h3>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {activity.organizers.map((organizer) => (
                <div
                  key={organizer.role}
                  className="rounded-xl border border-line bg-surface px-3 py-2.5"
                >
                  <div className="text-caption text-ink-3">
                    {organizer.role}
                  </div>
                  <div className="mt-0.5 font-bold text-body text-ink-1 leading-snug">
                    {organizer.name}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </OverlaySheet>
  );
}
