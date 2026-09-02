import { useMemo } from "react";
import type { AgendaItem, Transfer } from "../-data";
import {
  currentDayOf,
  dayLabelOf,
  transferDay,
  transferTime,
  uniqueDays,
} from "../-utils";
import { DayCard } from "./day-card";
import { type DayEntry, DayTimeline } from "./day-timeline";

/**
 * 「我的行程」——**议程和交通合成一条按天分组、按时间排序的列表**。
 *
 * 上一版是「我的议程 / 行程信息」两个页签。拆开的代价是嘉宾得自己在两个
 * 列表之间对时间，而这恰恰是这个页面唯一要回答的问题：接下来几点、去哪、
 * 怎么去。合并之后页签没有存在意义，连带那颗滑块一起去掉了。
 *
 * 分天的口径：
 * - 天数取「有议程的日子」∪「有交通的日子」——前一晚飞过来的航班因此有自己
 *   的一张日卡，而不是孤零零挂在另一个页签里。
 * - 标题见 -utils 的 `dayLabelOf`（第 N 天 / 出发日 / 返程日 / 自由活动）。
 * - 比基准日早的那几天默认折叠；只有一天时不套日卡的壳。
 */
export function ScheduleList({
  agenda,
  transfers,
  onShowSeatMap,
}: {
  agenda: AgendaItem[];
  transfers: Transfer[];
  onShowSeatMap: (item: AgendaItem) => void;
}) {
  const agendaDays = useMemo(
    () => uniqueDays(agenda.map((a) => a.date)),
    [agenda],
  );
  const days = useMemo(
    () => uniqueDays([...agendaDays, ...transfers.map(transferDay)]),
    [agendaDays, transfers],
  );
  const currentDay = useMemo(() => currentDayOf(days, agenda), [days, agenda]);

  const entriesByDay = useMemo(() => {
    const map = new Map<string, DayEntry[]>();
    const push = (day: string, entry: DayEntry) => {
      const list = map.get(day) ?? [];
      list.push(entry);
      map.set(day, list);
    };
    for (const item of agenda) {
      push(item.date, { kind: "agenda", item, time: item.start });
    }
    for (const transfer of transfers) {
      const day = transferDay(transfer);
      if (!day) continue;
      // 过期只算到「天」，和日卡上的「已结束」同一粒度——精确到分钟会让页面
      // 在活动当天不断变样，而这页的数据本来就是一次性拉下来的。
      push(day, {
        kind: "transfer",
        transfer,
        time: transferTime(transfer),
        finished: day < currentDay,
      });
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.time.localeCompare(b.time));
    }
    return map;
  }, [agenda, transfers, currentDay]);

  return (
    <section aria-label="我的行程" className="px-4">
      {/* 一行安静的小标题，把「这是什么活动」（头图）和「我要做什么」（日程）
          分开——原来是那条页签在担这个界，去掉页签后得有东西补上。 */}
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="font-bold text-caption text-ink-3 tracking-[0.14em]">
          我的行程
        </h2>
        <span className="text-caption text-ink-4">
          共{days.length}天 ·{" "}
          <span className="tabular-nums">
            {agenda.length + transfers.length}
          </span>
          项
        </span>
      </div>

      {days.length <= 1 ? (
        <DayTimeline
          entries={entriesByDay.get(days[0] ?? "") ?? []}
          onShowSeatMap={onShowSeatMap}
        />
      ) : (
        days.map((day) => {
          const entries = entriesByDay.get(day) ?? [];
          return (
            <DayCard
              key={day}
              label={dayLabelOf(day, agendaDays)}
              day={day}
              count={entries.length}
              isCurrent={day === currentDay}
              isPast={day < currentDay}
            >
              <DayTimeline entries={entries} onShowSeatMap={onShowSeatMap} />
            </DayCard>
          );
        })
      )}
    </section>
  );
}
