import type { ReactNode } from "react";
import { Badge } from "#/shared/components/ui/badge.tsx";
import { Checkbox } from "#/shared/components/ui/checkbox.tsx";
import { cn } from "#/shared/lib/utils.ts";

/**
 * 配置页四个区块共用的外壳。
 *
 * 开关放在区块标题栏而不是基础信息区里（原型是这么画的，也更好读：开关和它
 * 控制的东西在一起，不用隔着两屏遥控）。关掉时区块**折叠但不删数据**——关
 * 开关经常是误操作，而人员是别处也在读的数据，静默删掉太狠。折叠标题上会
 * 把保留下来的条数写出来，不让它变成隐形状态。
 */
export function SectionCard({
  id,
  title,
  description,
  toggle,
  summary,
  actions,
  children,
}: {
  /** 保存失败时页面靠它滚到出错的区块。 */
  id: string;
  title: string;
  description?: string;
  toggle?: {
    checked: boolean;
    label: string;
    /** 关闭时保留了多少条数据，写进折叠提示里。 */
    keptSummary?: string;
    onChange: (checked: boolean) => void;
  };
  /** 标题右侧的一句话统计。 */
  summary?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const collapsed = toggle ? !toggle.checked : false;

  return (
    <section
      id={id}
      className="scroll-mt-20 rounded-xl border bg-card shadow-xs"
    >
      <header
        className={cn(
          "flex flex-wrap items-center gap-3 px-5 py-4",
          !collapsed && "border-b",
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-medium text-base">{title}</h2>
            {toggle ? (
              <Badge variant={toggle.checked ? "default" : "outline"}>
                {toggle.checked ? "已开启" : "已关闭"}
              </Badge>
            ) : null}
            {summary ? (
              <span className="text-muted-foreground text-sm">{summary}</span>
            ) : null}
          </div>
          {description ? (
            <p className="mt-1 text-muted-foreground text-sm">{description}</p>
          ) : null}
          {collapsed && toggle?.keptSummary ? (
            <p className="mt-1 text-muted-foreground text-sm">
              已关闭 · {toggle.keptSummary}（重新开启后还在）
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          {actions}
          {toggle ? (
            <label
              htmlFor={`${id}-toggle`}
              className="flex cursor-pointer items-center gap-2 text-sm"
            >
              <Checkbox
                id={`${id}-toggle`}
                checked={toggle.checked}
                onCheckedChange={(checked) => toggle.onChange(!!checked)}
              />
              {toggle.label}
            </label>
          ) : null}
        </div>
      </header>

      {collapsed ? null : <div className="px-5 py-4">{children}</div>}
    </section>
  );
}
