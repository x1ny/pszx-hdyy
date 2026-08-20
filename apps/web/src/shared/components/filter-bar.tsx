import type { ComponentProps, ReactNode } from "react";
import { Button } from "#/shared/components/ui/button.tsx";
import { cn } from "#/shared/lib/utils.ts";

/**
 * 列表页筛选栏。
 *
 * 全站的表格筛选统一走「攒草稿 → 点查询才生效」这一种交互，不再有「选完下拉
 * 立刻刷新」的页面。理由是混着来最难用：同一个筛选栏里，下拉一改就刷新、输入框
 * 却要回车，用户没法从外观判断哪个控件是哪种脾气，只能靠试。统一成「都要点查询」
 * 之后，那颗蓝色按钮就是唯一的触发点，规则一眼可见。
 *
 * 附带的好处是少发请求：改三个条件原来是三次往返（还夹着三条 history），现在是一次。
 *
 * 用法——筛选控件一律绑在本地草稿 state 上，URL 只在 onSubmit 里写：
 *
 * ```tsx
 * <FilterBar
 *   onSubmit={() => applyFilter({ name: nameInput.trim() || undefined, status: statusInput ?? undefined })}
 * >
 *   <Input value={nameInput} onChange={(e) => setNameInput(e.target.value)} />
 *   <FilterActions onReset={reset} />
 * </FilterBar>
 * ```
 *
 * 是 `<form>` 而不是 `<div>`：回车提交、按钮 `type="submit"` 这些都由浏览器免费
 * 提供，不用自己在每个输入框上挂 onKeyDown 判断 Enter。
 */
function FilterBar({
  className,
  onSubmit,
  children,
  ...props
}: ComponentProps<"form">) {
  return (
    <form
      data-slot="filter-bar"
      // items-end 而不是 items-center：带字段标签的筛选栏（标签在控件上方）要靠
      // 底边对齐才能让所有控件排成一条线，不带标签的那些控件等高，两者等价。
      className={cn(
        "flex flex-wrap items-end gap-2 rounded-lg border bg-card p-3 shadow-sm",
        className,
      )}
      onSubmit={(event) => {
        // 统一在这里 preventDefault，省得每个页面自己写一遍（漏一次就是整页刷新）。
        event.preventDefault();
        onSubmit?.(event);
      }}
      {...props}
    >
      {children}
    </form>
  );
}

/**
 * 筛选栏右侧的「查询 / 重置」按钮组，放在 `<FilterBar>` 里用。
 *
 * 查询是 `default` 变体（实心蓝），全站唯一的筛选触发点，视觉权重要压得住一排
 * 输入框；重置是次要动作，按视觉规范走 ghost + `text-muted-foreground`，不跟
 * 查询抢注意力，也不跟表格行内的蓝色操作撞色。
 */
function FilterActions({
  onReset,
  pending,
  className,
  children,
}: {
  /** 清空草稿并把 URL 上的筛选条件一起抹掉；不传就不渲染「重置」。 */
  onReset?: () => void;
  /** 查询进行中，禁用按钮避免重复提交。 */
  pending?: boolean;
  className?: string;
  /** 额外的动作（比如「导出」），排在重置后面。 */
  children?: ReactNode;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Button type="submit" disabled={pending}>
        查询
      </Button>
      {onReset && (
        <Button
          type="button"
          variant="ghost"
          className="text-muted-foreground hover:text-foreground"
          onClick={onReset}
        >
          重置
        </Button>
      )}
      {children}
    </div>
  );
}

export { FilterActions, FilterBar };
