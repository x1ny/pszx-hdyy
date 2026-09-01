import { Tabs } from "@base-ui/react/tabs";
import { useMemo } from "react";
import type { AgendaItem, Transfer } from "../-data";
import { currentDayOf, groupByDay, transferDay, uniqueDays } from "../-utils";
import { AgendaTimeline } from "./agenda-timeline";
import { DayCard } from "./day-card";
import { TransferCards } from "./transfer-cards";

/**
 * 我的议程 / 行程信息 的分段切换。
 *
 * 用 Base UI 的 Tabs：那颗白色滑块是 `Tabs.Indicator`，位置由它自己算出的
 * `--active-tab-left` / `--active-tab-width` 驱动，不用我们测量 DOM；键盘
 * 左右键切换和 `aria-selected` 也一并带上了。
 *
 * 单天活动直接铺内容，不套「第一天」的壳——头图上已经写了日期，再包一层
 * 只有一项的分组是纯噪音。
 */
export function ScheduleTabs({
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
  const transferDays = useMemo(
    () => uniqueDays(transfers.map(transferDay)),
    [transfers],
  );
  const currentDay = useMemo(
    () => currentDayOf(agendaDays, agenda),
    [agendaDays, agenda],
  );
  const agendaByDay = useMemo(
    () => groupByDay(agenda, (a) => a.date),
    [agenda],
  );
  const transfersByDay = useMemo(
    () => groupByDay(transfers, transferDay),
    [transfers],
  );

  return (
    <Tabs.Root defaultValue="agenda" aria-label="议程与行程">
      <div className="px-4">
        <Tabs.List className="relative grid grid-cols-2 rounded-full bg-[#ebedf2] p-1">
          <Tabs.Indicator className="absolute top-1 left-0 h-9 w-[var(--active-tab-width)] translate-x-[var(--active-tab-left)] rounded-full bg-white shadow-[0_1px_4px_rgb(20_26_38_/_0.1)] transition-[translate,width] duration-250 ease-out-expo" />
          <ScheduleTab value="agenda" label="我的议程" count={agenda.length} />
          <ScheduleTab
            value="transfers"
            label="行程信息"
            count={transfers.length}
          />
        </Tabs.List>
      </div>

      <div className="mt-2.5 px-4">
        <Tabs.Panel value="agenda">
          {agendaDays.length <= 1 ? (
            <AgendaTimeline
              agenda={agenda}
              transfers={transfers}
              onShowSeatMap={onShowSeatMap}
            />
          ) : (
            agendaDays.map((d, i) => (
              <DayCard
                key={d}
                index={i}
                day={d}
                count={agendaByDay.get(d)?.length ?? 0}
                isCurrent={d === currentDay}
                isPast={d < currentDay}
              >
                <AgendaTimeline
                  agenda={agendaByDay.get(d) ?? []}
                  transfers={transfers}
                  onShowSeatMap={onShowSeatMap}
                />
              </DayCard>
            ))
          )}
        </Tabs.Panel>

        <Tabs.Panel value="transfers">
          {transferDays.length <= 1 ? (
            <TransferCards transfers={transfers} />
          ) : (
            transferDays.map((d, i) => (
              <DayCard
                key={d}
                index={i}
                day={d}
                count={transfersByDay.get(d)?.length ?? 0}
                isCurrent={d === currentDay}
                isPast={d < currentDay}
              >
                <TransferCards transfers={transfersByDay.get(d) ?? []} inset />
              </DayCard>
            ))
          )}
        </Tabs.Panel>
      </div>
    </Tabs.Root>
  );
}

function ScheduleTab({
  value,
  label,
  count,
}: {
  value: string;
  label: string;
  count: number;
}) {
  return (
    <Tabs.Tab
      value={value}
      className="relative z-1 flex h-9 select-none items-center justify-center gap-1 rounded-full font-bold text-body text-ink-3 transition-colors duration-150 data-selected:text-brand"
    >
      {label}
      <span className="font-extrabold text-caption tabular-nums">{count}</span>
    </Tabs.Tab>
  );
}
