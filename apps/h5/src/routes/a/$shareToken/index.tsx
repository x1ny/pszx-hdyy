import { useSuspenseQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  isRedirect,
  notFound,
  redirect,
} from "@tanstack/react-router";
import { useState } from "react";
import { PageMessage } from "#/shared/components/page-message";
import { ApiError, H5_UNAUTHORIZED } from "#/shared/lib/api";
import { EventHero } from "./-components/event-hero";
import { ScheduleList } from "./-components/schedule-list";
import { SeatMapSheet } from "./-components/seat-map-sheet";
import { ToastLayer } from "./-components/toast-layer";
import { type AgendaItem, itineraryQueryOptions } from "./-queries";

/**
 * 嘉宾的专属行程页 —— 一个活动一张合一长页：头图（活动信息）+ 议程时间轴 +
 * 交通，座位以文字挂在议程行上。
 *
 * ## 守卫：不检查 cookie，直接请求
 *
 * 手机号存在 **HttpOnly cookie** 里，前端根本读不到，所以这里没有"先看看有没有
 * 登录过"这一步 —— 下面这个 loader 直接请求行程数据，成功即渲染，拿到
 * `H5_UNAUTHORIZED` 就跳手机号页。
 *
 * 这不比"先读 cookie 再请求"多一次往返：整页数据本来就要请求一次，那一次请求
 * 本身就是判断。而且它顺带保证了前端守卫和服务端守卫永远同一个口径 ——
 * 前端不可能因为自己那份判断写歪了而放行一个服务端会拒绝的人。
 */
export const Route = createFileRoute("/a/$shareToken/")({
  loader: async ({ context, params }) => {
    const { shareToken } = params;

    try {
      await context.queryClient.ensureQueryData(
        itineraryQueryOptions(shareToken),
      );
    } catch (error) {
      // redirect 是靠 throw 实现的，被 catch 接住就失效了 —— 现在 try 块里只有
      // 一个请求、不会抛 redirect，但重构时很容易往里加东西，先挡住。
      if (isRedirect(error)) throw error;

      if (error instanceof ApiError && error.code === "NOT_FOUND") {
        throw notFound();
      }

      if (error instanceof ApiError && error.code === H5_UNAUTHORIZED) {
        throw redirect({
          to: "/a/$shareToken/phone",
          params: { shareToken },
        });
      }
      throw error;
    }

    return { shareToken };
  },
  component: ItineraryPage,
  errorComponent: () => (
    <PageMessage
      title="页面加载失败"
      hint="请检查网络后重新打开，或联系主办方"
    />
  ),
  notFoundComponent: () => (
    <PageMessage title="活动不存在" hint="请通过主办方提供的链接或二维码进入" />
  ),
});

/**
 * 白色内容面从头图下缘一路白到底，卡片之间靠描边和阴影分隔 —— 中间换灰底会在
 * 头图卡下方留一道很脏的接缝。
 */
function ItineraryPage() {
  const { shareToken } = Route.useLoaderData();
  const { data } = useSuspenseQuery(itineraryQueryOptions(shareToken));

  /**
   * 座位图面板**整页只有一个**，由它记住当前看的是哪一场。
   *
   * 放在每一行里各渲染一个的话，一位有五场带排位环节的嘉宾，页面上就同时挂着
   * 五套焦点陷阱和滚动锁定 —— 而其中至多一个会被打开。
   */
  const [seatMapFor, setSeatMapFor] = useState<AgendaItem | null>(null);

  return (
    <ToastLayer>
      <div className="mx-auto min-h-dvh w-full max-w-[480px] bg-surface pb-6">
        <EventHero userName={data.member.name} activity={data.activity} />

        <div className="pt-4">
          <ScheduleList
            agenda={data.agenda}
            trips={data.trips}
            cars={data.cars}
            onOpenSeatMap={setSeatMapFor}
          />
        </div>
      </div>

      <SeatMapSheet
        shareToken={shareToken}
        item={seatMapFor}
        onClose={() => setSeatMapFor(null)}
      />
    </ToastLayer>
  );
}
