import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/shared/components/ui/select.tsx";
import { cn } from "#/shared/lib/utils.ts";

/**
 * 表格行里的状态快捷变更控件：一个长得像彩色徽章的下拉，选中即提交目标值。
 *
 * 为什么不是"取反"按钮：供应商那种二态启用/停用可以用一个按钮表达，三态
 * （未发布 / 已上架 / 已下架）不行——"取反"没有定义。所以这里选中的是**目标
 * 状态**，不是一个切换动作（语义见 modules/project/validation.ts 的
 * SetXxxStatusInput 注释）。
 *
 * 它对业务一无所知：取值、标签、配色全部由调用方传进来，所以放 shared/。
 * 目前三个消费方——项目列表、项目详情下的活动列表、一级菜单的活动管理。
 */
export function StatusSelect<T extends string>({
  value,
  values,
  labels,
  chipClass,
  disabled,
  onChange,
}: {
  value: T;
  values: readonly T[];
  labels: Record<T, string>;
  chipClass: Record<T, string>;
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <Select
      items={labels}
      value={value}
      disabled={disabled}
      onValueChange={(next) => next && next !== value && onChange(next)}
    >
      <SelectTrigger
        size="sm"
        className={cn(
          // 下拉箭头图标在 select.tsx 里写死了 text-muted-foreground，跟色块
          // 徽章的彩色文字对不上（比如绿底绿字的"已上架"配一个灰箭头）。
          // [&_svg]:text-current 靠更高的选择器特异性压过图标自身那个类，
          // 让箭头跟随这里的文字颜色——只在这个彩色小徽章场景这么做，
          // 不动 select.tsx 本身：普通筛选下拉的箭头就该是低调的灰色，
          // 不该跟着占位文字或选中值的颜色走。
          "h-7 w-auto gap-1 rounded-full border px-2.5 font-medium text-xs shadow-none [&_svg]:text-current",
          chipClass[value],
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {values.map((item) => (
          <SelectItem key={item} value={item}>
            {labels[item]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
