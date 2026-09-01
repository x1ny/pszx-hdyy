import type { EventInfo } from "../-data";
import { OverlaySheet } from "./overlay-sheet";

/**
 * 活动详情面板——头图那段简介点「查看详情」推上来的全文。
 *
 * 顶部先复述一遍活动身份（标题 / 时间 / 地点），因为面板盖住了头图，
 * 用户滚了两屏之后打开它，需要知道自己在看哪一场。
 */
export function EventDetailOverlay({
  open,
  onOpenChange,
  event,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: EventInfo;
}) {
  return (
    <OverlaySheet open={open} onOpenChange={onOpenChange} title="活动详情">
      <div className="px-4 pt-3 pb-8">
        <div className="rounded-xl border border-line bg-surface p-3">
          <h2 className="text-title leading-snug">{event.title}</h2>
          <div className="mt-1.5 flex items-center gap-1.5 text-caption text-ink-3">
            <span>{event.dateText}</span>
            <span className="font-bold text-ink-2 tabular-nums">
              {event.timeRange}
            </span>
          </div>
          <div className="mt-0.5 text-caption text-ink-3">
            {event.city} · {event.venue}
          </div>
        </div>

        <h3 className="mt-4 text-eyebrow text-ink-3">活动介绍</h3>
        <div className="mt-1.5 space-y-2">
          {event.details.paragraphs.map((p) => (
            <p
              key={p.slice(0, 12)}
              className="select-text text-body text-ink-2 leading-relaxed"
            >
              {p}
            </p>
          ))}
        </div>

        <h3 className="mt-4 text-eyebrow text-ink-3">组织单位</h3>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          {event.details.organizers.map((o) => (
            <div
              key={o.name}
              className="rounded-xl border border-line bg-surface px-3 py-2.5"
            >
              <div className="text-caption text-ink-3">{o.role}</div>
              <div className="mt-0.5 font-bold text-body text-ink-1 leading-snug">
                {o.name}
              </div>
            </div>
          ))}
        </div>
      </div>
    </OverlaySheet>
  );
}
