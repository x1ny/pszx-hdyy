/**
 * 「（占位数据）」标记。
 *
 * 跟在占位值后面，告诉看页面的人这一项还没有真实来源（清单和理由见
 * `-placeholders.ts`）。刻意不做成灰得看不见的小字 —— 它的读者是产品和运营，
 * 需要一眼能挑出来；等这些字段接上真实数据，标记连同常量一起删掉。
 *
 * 它只解决「看得出是假的」。**会产生真实后果的占位（拨号、导航）另有一条更硬
 * 的规则：不渲染成可点的东西。** 标注拦不住已经按下去的手指。
 */
export function PlaceholderMark() {
  return (
    <span className="ml-1 whitespace-nowrap rounded border border-line bg-page px-1 py-px align-middle font-normal text-[0.625rem] text-ink-4 leading-[0.875rem]">
      占位数据
    </span>
  );
}
