import { cn } from "#/shared/lib/utils";
import type { AgendaItem, Car, Trip } from "../-queries";
import {
  type AgendaStatus,
  isTicketed,
  TRANSPORT_MODE_LABELS,
  TRANSPORT_SCENE_LABELS,
  timeOf,
} from "../-utils";
import { Copyable } from "./copyable";
import { Icon, type IconName } from "./icon";
import { NavigationPicker } from "./navigation-picker";
import { PhoneChip } from "./phone-chip";
import { PillTag } from "./pill-tag";

/** 融合时间轴上的一行。`time`（`HH:mm`）是当天内的排序键。 */
export type DayEntry =
  | {
      kind: "agenda";
      key: string;
      time: string;
      startTime: string;
      endTime: string;
      item: AgendaItem;
    }
  | { kind: "trip"; key: string; time: string; trip: Trip; finished: boolean }
  | { kind: "car"; key: string; time: string; car: Car; finished: boolean };

const TRIP_ICON: Record<Trip["transportMode"], IconName> = {
  train: "train-front",
  flight: "plane",
  drive: "car-front",
  other: "navigation",
};

/**
 * 一天的行程时间轴：**议程和交通混在同一条轴上，按时间先后排**。
 *
 * 上一版把它们分成「我的议程」和「行程信息」两个页签，代价是嘉宾要在两个列表
 * 之间自己对时间 ——「几点的车去哪一场」得来回翻。现在一趟接驳车就排在它要送达
 * 的那一场前面，一眼看下去就是当天的真实顺序。
 *
 * 交通有**两个互不相干的来源**：`member_trip` 是嘉宾自己的到离行程（火车/飞机/
 * 驾车/其他），`activity_resource` 是主办方安排的用车。它们的字段完全不同，所以
 * 是两种行，不是一种行的两个变体。
 */
export function DayTimeline({
  entries,
  status,
  onOpenSeatMap,
}: {
  entries: DayEntry[];
  /** 议程行的进行状态由页面统一算一次传进来，避免每行各自读一次时钟。 */
  status: (item: AgendaItem) => AgendaStatus;
  /**
   * 座位图面板由页面持有，这里只发出"打开哪一场"。
   *
   * 面板放在页面而不是每行各自渲染一个：一位嘉宾可能有四五场带座位图的环节，
   * 每行一个 Drawer 就是四五套焦点陷阱和滚动锁定同时挂在 DOM 上。
   */
  onOpenSeatMap: (item: AgendaItem) => void;
}) {
  return (
    <div>
      {entries.map((entry, index) => {
        const shared = { index, isLast: index === entries.length - 1 };
        if (entry.kind === "agenda") {
          return (
            <AgendaRow
              key={entry.key}
              item={entry.item}
              startTime={entry.startTime}
              endTime={entry.endTime}
              status={status(entry.item)}
              onOpenSeatMap={onOpenSeatMap}
              {...shared}
            />
          );
        }
        if (entry.kind === "trip") {
          return (
            <TripRow
              key={entry.key}
              trip={entry.trip}
              finished={entry.finished}
              {...shared}
            />
          );
        }
        return (
          <CarRow
            key={entry.key}
            car={entry.car}
            finished={entry.finished}
            {...shared}
          />
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 左侧时间列 + 竖线 + 节点：三种行共用，才对得齐                        */
/* ------------------------------------------------------------------ */

function TimeRail({
  top,
  bottom,
  isLast,
  finished,
}: {
  top: string;
  bottom?: string;
  isLast: boolean;
  /** 只有节点圆点表达「已过去」，行内容不降调 —— 降调的信息更难读，而嘉宾
      回看已结束的场次多半正是为了确认细节。 */
  finished: boolean;
}) {
  return (
    <div className="relative flex w-14 shrink-0 flex-col items-end pt-2.5 pr-2.5">
      <span className="text-ink-1 text-time tabular-nums">{top}</span>
      {bottom && (
        <span className="font-bold text-ink-3 text-xs leading-4 tabular-nums">
          {bottom}
        </span>
      )}
      {/* 竖线要一直连到下一行的节点，最后一行才收住 */}
      <span
        className={cn(
          "absolute top-[0.5625rem] right-0 w-px bg-line",
          isLast ? "h-[calc(100%-0.5625rem)]" : "h-[calc(100%+1px)]",
        )}
      />
      {/* 节点套一圈卡片底色的描边，才不会被竖线穿过去 */}
      <span
        className={cn(
          "absolute top-[1.125rem] right-[-0.21875rem] h-2 w-2 rounded-full border-[1.5px] bg-surface ring-3 ring-surface",
          finished ? "border-ink-4" : "border-brand",
        )}
      />
    </div>
  );
}

function Row({
  index,
  isLast,
  children,
}: {
  index: number;
  isLast: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative flex animate-slide-in gap-2.5",
        !isLast && "border-line border-b",
      )}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 议程行                                                              */
/* ------------------------------------------------------------------ */

function AgendaRow({
  item,
  startTime,
  endTime,
  status,
  index,
  isLast,
  onOpenSeatMap,
}: {
  item: AgendaItem;
  startTime: string;
  endTime: string;
  status: AgendaStatus;
  index: number;
  isLast: boolean;
  onOpenSeatMap: (item: AgendaItem) => void;
}) {
  return (
    <Row index={index} isLast={isLast}>
      <TimeRail
        top={startTime}
        bottom={endTime}
        isLast={isLast}
        finished={status === "finished"}
      />

      <div className="min-w-0 flex-1 py-2.5">
        <h3 className="text-ink-1 text-title">{item.name}</h3>

        {/* 地点只有文字，没有导航按钮 —— 全库没有任何经纬度列，编一个坐标点
            下去会把人导到错误的地点，而人一旦跳出 App 就再也看不到提示了。 */}
        {item.locationText && (
          <div className="mt-1 flex w-full items-center gap-1">
            <Icon name="map-pin" size={12} className="shrink-0 text-ink-3" />
            <span className="min-w-0 flex-1 truncate text-body text-ink-3">
              {item.locationText}
            </span>
          </div>
        )}

        {/* 只有已确认的个人排位才会给出 zone/seat（服务端已按当前人员过滤），
            所以这里展示的始终是这位嘉宾自己的真实座位。 */}
        {item.zone && item.seat && (
          <div className="mt-1.5 flex items-center gap-2.5">
            <PillTag variant="outline">
              <span>{item.zone}</span>
              <span className="tabular-nums">{item.seat}</span>
            </PillTag>

            {/*
              `hasSeatMap` 是服务端的**便宜判定**（画布行在不在、渲染器认不认识），
              没有解析画布。所以按钮不出现 = 确实没有图；出现了 = 几乎一定有图，
              残余的失败在面板里有降级文案，不会给出一个空面板。

              这里不是「座位胶囊整颗可点」：那颗胶囊在没有图的时候也存在，做成
              可点的话就有一半的场次点了没反应。
            */}
            {item.hasSeatMap && (
              <button
                type="button"
                onClick={() => onOpenSeatMap(item)}
                aria-label={`查看${item.zone}座位图`}
                /*
                  纯文字链接，没有边框和底色 —— 描边按钮会和左边那颗同样描边的
                  座位胶囊连成两个框，视觉上分不出谁是信息谁是操作。

                  代价是可点区域只剩 16px 高，所以用 `before:` 伪元素往外撑到
                  40px 上下：它是绝对定位的，撑大的是热区而不是行高，旁边那颗
                  胶囊的位置一点不动。
                */
                className="relative flex shrink-0 items-center gap-0.5 text-brand text-caption before:absolute before:-inset-x-2 before:-inset-y-3 before:content-['']"
              >
                <Icon name="map" size={12} />
                座位图
              </button>
            )}
          </div>
        )}

        {/* 环节说明。**这是真数据**（`activity_segment.description`），不是
            "对嘉宾的要求" —— 库里没有后者那个字段，两者语义不同但这是最接近的
            一个，所以原样展示、不加占位标记。底色用中性灰、只留红图标承担注意
            力：整页只有主题红一种强调色，再来一套琥珀色就成了第二套语义。 */}
        {item.description && (
          <div className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-page px-2 py-1.5">
            <Icon
              name="megaphone"
              size={12}
              className="mt-[0.1875rem] shrink-0 text-brand"
            />
            <span className="min-w-0 text-caption text-ink-2 leading-[1.125rem]">
              {item.description}
            </span>
          </div>
        )}
      </div>
    </Row>
  );
}

/* ------------------------------------------------------------------ */
/* 到离行程行（member_trip）                                            */
/* ------------------------------------------------------------------ */

function TripRow({
  trip,
  finished,
  index,
  isLast,
}: {
  trip: Trip;
  finished: boolean;
  index: number;
  isLast: boolean;
}) {
  return (
    <Row index={index} isLast={isLast}>
      <TimeRail
        top={timeOf(trip.departureTime)}
        bottom={timeOf(trip.arrivalTime)}
        isLast={isLast}
        finished={finished}
      />

      <div className="min-w-0 flex-1 py-2.5">
        <div className="flex gap-2">
          {/* 图标底色恒定用主题浅底：过没过期由节点圆点表达，这里再灰一层会让
              整行看起来像是禁用了。 */}
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand">
            <Icon name={TRIP_ICON[trip.transportMode]} size={13} />
          </span>
          <div className="min-w-0 flex-1">
            {isTicketed(trip) ? (
              <TicketBody trip={trip} />
            ) : (
              <PlainTripBody trip={trip} />
            )}
            <div className="mt-0.5 text-body text-ink-3">
              {trip.departureLocation} → {trip.destination}
            </div>
          </div>
        </div>
      </div>
    </Row>
  );
}

/** 火车 / 飞机：展示车次或航班号。 */
function TicketBody({ trip }: { trip: Trip }) {
  return (
    <>
      {trip.serviceNumber ? (
        <Copyable
          text={trip.serviceNumber}
          className="font-extrabold text-ink-1 text-title tabular-nums"
        >
          {trip.serviceNumber}
        </Copyable>
      ) : (
        <h3 className="text-ink-1 text-title">
          {TRANSPORT_MODE_LABELS[trip.transportMode]}
        </h3>
      )}
    </>
  );
}

/** 驾车 / 其他：没有票务字段，只有方式和起讫点。 */
function PlainTripBody({ trip }: { trip: Trip }) {
  return (
    <h3 className="text-ink-1 text-title">
      {TRANSPORT_MODE_LABELS[trip.transportMode]}
      {trip.serviceNumber && (
        <span className="ml-1.5 font-normal text-body text-ink-3 tabular-nums">
          {trip.serviceNumber}
        </span>
      )}
    </h3>
  );
}

/* ------------------------------------------------------------------ */
/* 用车行（activity_resource）                                          */
/* ------------------------------------------------------------------ */

function CarRow({
  car,
  finished,
  index,
  isLast,
}: {
  car: Car;
  finished: boolean;
  index: number;
  isLast: boolean;
}) {
  const startTime = timeOf(car.startTime);

  return (
    <Row index={index} isLast={isLast}>
      <TimeRail
        top={startTime || "待定"}
        bottom={startTime ? "发车" : undefined}
        isLast={isLast}
        finished={finished}
      />

      <div className="min-w-0 flex-1 py-2.5">
        <div className="flex gap-2">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand">
            <Icon name="car-front" size={13} />
          </span>
          <div className="min-w-0 flex-1">
            <CarBody car={car} />
          </div>
        </div>
      </div>
    </Row>
  );
}

function CarBody({ car }: { car: Car }) {
  const durationMinutes = getDurationMinutes(car);

  return (
    <>
      <h3 className="text-ink-1 text-title">
        {car.name}
        {car.transportScene && (
          <span className="ml-1.5 font-normal text-body text-ink-3">
            {TRANSPORT_SCENE_LABELS[car.transportScene]}
          </span>
        )}
      </h3>

      {durationMinutes !== null && (
        <div className="mt-0.5 text-caption text-ink-3">
          路程预计 {durationMinutes} 分钟
        </div>
      )}

      {/* 车牌 / 司机 / 电话三样在 375px 上正好排一行；320px 上放不下时让电话
          整颗换行，而不是把司机名字截掉 —— 名字截一半比多占一行难用得多。
          **这颗电话是真数据，可拨**。 */}
      {(car.vehicleInfo || car.driverName || car.driverPhone) && (
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-1.5 gap-y-1 text-body text-ink-2">
          <div className="flex items-center gap-1">
            {car.vehicleInfo && (
              <Copyable
                text={car.vehicleInfo}
                ariaLabel={`复制车牌 ${car.vehicleInfo}`}
              >
                <span className="shrink-0 whitespace-nowrap rounded-md border border-transit bg-transit-soft px-1 py-px font-extrabold text-caption text-transit tabular-nums">
                  {car.vehicleInfo}
                </span>
              </Copyable>
            )}
            {car.driverName && (
              <span className="whitespace-nowrap">{car.driverName}</span>
            )}
          </div>
          {car.driverPhone && (
            <PhoneChip
              phone={car.driverPhone}
              ariaLabel={`拨打司机${car.driverName ?? ""}的电话`}
            />
          )}
        </div>
      )}

      {(car.location || car.locationPoint) && (
        <div className="mt-1 flex min-w-0 items-center gap-1">
          <Icon name="map-pin" size={12} className="shrink-0 text-ink-3" />
          <span className="truncate text-caption text-ink-3">
            集合：{car.location ?? car.locationPoint?.name}
          </span>
          {car.locationPoint && (
            <NavigationPicker
              point={car.locationPoint}
              locationText={car.location}
            />
          )}
        </div>
      )}

      {car.remark && (
        <div className="mt-1 text-caption text-ink-3">{car.remark}</div>
      )}
    </>
  );
}

function getDurationMinutes(car: Car): number | null {
  if (!car.startTime || !car.endTime) return null;

  const start = Date.parse(car.startTime);
  const end = Date.parse(car.endTime);
  const duration = (end - start) / 60000;
  if (!Number.isFinite(start) || !Number.isFinite(end) || duration < 0) {
    return null;
  }

  return Math.round(duration);
}
