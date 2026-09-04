import { useMemo } from "react";
import type { AgendaItem, Car, Trip } from "../-queries";
import {
  type AgendaStatus,
  currentDayOf,
  dayKeyOf,
  dayLabelOf,
  isScheduled,
  statusOf,
  timeOf,
  uniqueDays,
} from "../-utils";
import { DayCard } from "./day-card";
import { CarBody, type DayEntry, DayTimeline } from "./day-timeline";
import { Icon } from "./icon";

/**
 * 「我的行程」—— **议程和交通合成一条按天分组、按时间排序的列表**。
 *
 * 上一版是「我的议程 / 行程信息」两个页签。拆开的代价是嘉宾得自己在两个列表之间
 * 对时间，而这恰恰是这个页面唯一要回答的问题：接下来几点、去哪、怎么去。合并
 * 之后页签没有存在意义，连带那颗滑块一起去掉了。
 *
 * 分天的口径（一律按 Asia/Shanghai，见 -utils）：
 * - 天数取「有议程的日子」∪「有交通的日子」—— 前一晚飞过来的航班因此有自己的
 *   一张日卡，而不是孤零零挂在另一个页签里。
 * - 标题见 `dayLabelOf`（第 N 天 / 出发日 / 返程日 / 自由活动）。
 * - 比基准日早的那几天默认折叠；只有一天时不套日卡的壳。
 */
export function ScheduleList({
  agenda,
  trips,
  cars,
}: {
  agenda: AgendaItem[];
  trips: Trip[];
  cars: Car[];
}) {
  // `activity_resource.start_time` 可空。没有时间的用车塞进任何一天都是猜，
  // 单列在页尾那一块，不进时间轴。
  const scheduledCars = useMemo(() => cars.filter(isScheduled), [cars]);
  const undatedCars = useMemo(
    () => cars.filter((car) => !isScheduled(car)),
    [cars],
  );

  const agendaDays = useMemo(
    () => uniqueDays(agenda.map((item) => dayKeyOf(item.startTime))),
    [agenda],
  );

  const days = useMemo(
    () =>
      uniqueDays([
        ...agendaDays,
        ...trips.map((trip) => dayKeyOf(trip.departureTime)),
        ...scheduledCars.map((car) => dayKeyOf(car.startTime)),
      ]),
    [agendaDays, trips, scheduledCars],
  );

  const currentDay = useMemo(() => currentDayOf(), []);

  // 整页的「现在」只取一次：每行各自读一次时钟的话，长列表渲染跨过整点时会
  // 出现前几行算作已结束、后几行还没有的错位。
  const now = useMemo(() => Date.now(), []);
  const status = useMemo(
    () =>
      (item: AgendaItem): AgendaStatus =>
        statusOf(item.startTime, item.endTime, now),
    [now],
  );

  const entriesByDay = useMemo(() => {
    const map = new Map<string, DayEntry[]>();
    const push = (day: string, entry: DayEntry) => {
      if (!day) return;
      const list = map.get(day) ?? [];
      list.push(entry);
      map.set(day, list);
    };

    for (const item of agenda) {
      push(dayKeyOf(item.startTime), {
        kind: "agenda",
        key: `agenda-${item.id}`,
        time: timeOf(item.startTime),
        item,
      });
    }

    // 过期只算到「天」，和日卡上的「已结束」同一粒度 —— 精确到分钟会让页面在
    // 活动当天不断变样，而这页的数据本来就是一次性拉下来的。
    for (const trip of trips) {
      const day = dayKeyOf(trip.departureTime);
      push(day, {
        kind: "trip",
        key: `trip-${trip.id}`,
        time: timeOf(trip.departureTime),
        trip,
        finished: day < currentDay,
      });
    }

    for (const car of scheduledCars) {
      const day = dayKeyOf(car.startTime);
      push(day, {
        kind: "car",
        key: `car-${car.id}`,
        time: timeOf(car.startTime),
        car,
        finished: day < currentDay,
      });
    }

    for (const list of map.values()) {
      list.sort((a, b) => a.time.localeCompare(b.time));
    }
    return map;
  }, [agenda, trips, scheduledCars, currentDay]);

  const total = agenda.length + trips.length + scheduledCars.length;

  return (
    <section aria-label="我的行程" className="px-4">
      {/* 一行安静的小标题，把「这是什么活动」（头图）和「我要做什么」（日程）
          分开 —— 原来是那条页签在担这个界，去掉页签后得有东西补上。 */}
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="font-bold text-caption text-ink-3 tracking-[0.14em]">
          我的行程
        </h2>
        {total > 0 && (
          <span className="text-caption text-ink-4">
            共{days.length}天 · <span className="tabular-nums">{total}</span>项
          </span>
        )}
      </div>

      {total === 0 ? (
        <EmptySchedule />
      ) : days.length <= 1 ? (
        <DayTimeline
          entries={entriesByDay.get(days[0] ?? "") ?? []}
          status={status}
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
              <DayTimeline entries={entries} status={status} />
            </DayCard>
          );
        })
      )}

      {undatedCars.length > 0 && <UndatedCars cars={undatedCars} />}
    </section>
  );
}

/**
 * 议程和交通都空的时候。
 *
 * 最可能的原因不是"这个人没安排"，而是运营还没给环节开人员管理、或者还没把
 * 人拉进去 —— 所以话术指向主办方，而不是一句冷冰冰的"暂无数据"。
 */
function EmptySchedule() {
  return (
    <div className="rounded-2xl border border-line bg-surface px-4 py-8 text-center">
      <p className="text-body text-ink-2">您的行程尚未安排</p>
      <p className="mt-1 text-caption text-ink-3">
        主办方安排完成后会显示在这里，如有疑问请联系主办方
      </p>
    </div>
  );
}

/** 没有发车时间的用车。塞进任何一天都是猜，所以单列在页尾。 */
function UndatedCars({ cars }: { cars: Car[] }) {
  return (
    <section aria-label="用车安排" className="mt-4">
      <div className="mb-2 flex items-center gap-1.5">
        <Icon name="car-front" size={13} className="text-ink-3" />
        <h2 className="font-bold text-caption text-ink-3 tracking-[0.14em]">
          用车安排
        </h2>
        <span className="text-caption text-ink-4">（未定发车时间）</span>
      </div>
      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
        {cars.map((car, index) => (
          <div
            key={car.id}
            className={
              index > 0 ? "border-line border-t px-3 py-2.5" : "px-3 py-2.5"
            }
          >
            <CarBody car={car} />
          </div>
        ))}
      </div>
    </section>
  );
}
