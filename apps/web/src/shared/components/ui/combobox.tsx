"use client"

import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"
import { CheckIcon, ChevronDownIcon, XIcon } from "lucide-react"

import { cn } from "#/shared/lib/utils.ts"

const Combobox = ComboboxPrimitive.Root

/**
 * 清空按钮。只在有值时显示（visible 状态由 base-ui 自己管）。
 *
 * 相对 shadcn 原版多出来的一个部件。清空**不能**做成列表里的一个“不填写”项——
 * 试过，base-ui 不把这种项当成可选中的值，Enter 下去没反应，输入框里还留着
 * “不填写”当选中值显示。这个部件才是这个组件库给的清空方式。
 */
function ComboboxClear({ className, ...props }: ComboboxPrimitive.Clear.Props) {
  return (
    <ComboboxPrimitive.Clear
      data-slot="combobox-clear"
      type="button"
      aria-label="清空"
      className={cn(
        "absolute top-1/2 right-8 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <XIcon />
    </ComboboxPrimitive.Clear>
  )
}

function ComboboxInput({
  className,
  disabled = false,
  showTrigger = true,
  showClear = false,
  ...props
}: ComboboxPrimitive.Input.Props & {
  showTrigger?: boolean
  showClear?: boolean
}) {
  return (
    <div className={cn("relative", className)}>
      <ComboboxPrimitive.Input
        data-slot="combobox-input"
        disabled={disabled}
        className="h-9 w-full min-w-0 rounded-md border border-input bg-transparent py-1 pr-9 pl-2.5 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"
        {...props}
      />
      {showClear ? <ComboboxClear disabled={disabled} /> : null}
      {showTrigger ? (
        <ComboboxPrimitive.Trigger
          data-slot="combobox-trigger"
          type="button"
          disabled={disabled}
          aria-label="打开选项"
          className="absolute top-1/2 right-1 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg:not([class*='size-'])]:size-4"
        >
          <ChevronDownIcon />
        </ComboboxPrimitive.Trigger>
      ) : null}
    </div>
  )
}

/**
 * 独立的按钮式触发器，配 `ComboboxSearchInput` 用——组成"看起来是个下拉、
 * 点开之后弹层顶部才是搜索框"的形态（base-ui 管这叫 select-like combobox）。
 *
 * 相对 shadcn 原版多出来的第二个部件。为什么不用现成的 `ComboboxInput`：那个
 * 是常驻输入框，一屏上并排放好几个（比如每张资源卡片一个绑人控件）会多出一排
 * 空文本框，视觉噪音比一颗小按钮重得多。两种形态各有各的场合，所以是新增部件
 * 而不是改 `ComboboxInput`。
 */
function ComboboxTrigger({
  className,
  children,
  ...props
}: ComboboxPrimitive.Trigger.Props) {
  return (
    <ComboboxPrimitive.Trigger
      data-slot="combobox-trigger"
      type="button"
      className={cn(
        // cursor-pointer 的理由同 select.tsx 的 SelectTrigger：Tailwind v4 去掉了
        // button 的默认 pointer 光标，而这里本身就是个 <button>。
        "flex h-9 w-fit cursor-pointer items-center justify-between gap-1.5 rounded-md border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <ChevronDownIcon className="text-muted-foreground" />
    </ComboboxPrimitive.Trigger>
  )
}

/**
 * 放在 `ComboboxContent` 顶部的搜索框，配 `ComboboxTrigger` 用。
 *
 * 和 `ComboboxInput` 的区别只是位置和样式：它待在弹层里，所以不需要边框和自己的
 * 触发器按钮，只用一条下边框跟列表分开。过滤仍然由 base-ui 按 Root 的
 * `itemToStringLabel` 做，这里不接管。
 */
function ComboboxSearchInput({
  className,
  ...props
}: ComboboxPrimitive.Input.Props) {
  return (
    <div className="border-border border-b p-1">
      <ComboboxPrimitive.Input
        data-slot="combobox-search-input"
        className={cn(
          "h-8 w-full min-w-0 rounded-sm bg-transparent px-2 text-base outline-none placeholder:text-muted-foreground md:text-sm",
          className
        )}
        {...props}
      />
    </div>
  )
}

function ComboboxContent({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "start",
  alignOffset = 0,
  ...props
}: ComboboxPrimitive.Popup.Props &
  Pick<
    ComboboxPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        className="isolate z-50 outline-hidden"
      >
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          className={cn(
            "relative isolate z-50 max-h-[calc(var(--available-height)*2/3)] min-w-(--anchor-width) max-w-(--available-width) origin-(--transform-origin) overflow-hidden rounded-md border border-border bg-popover bg-clip-padding text-popover-foreground shadow-md duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          {...props}
        >
          {children}
        </ComboboxPrimitive.Popup>
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  )
}

function ComboboxList({
  className,
  ...props
}: ComboboxPrimitive.List.Props) {
  return (
    <ComboboxPrimitive.List
      data-slot="combobox-list"
      className={cn(
        "max-h-[calc(var(--available-height)*2/3)] overflow-y-auto overscroll-contain p-1",
        className,
      )}
      {...props}
    />
  )
}

function ComboboxItem({
  className,
  children,
  ...props
}: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      <ComboboxPrimitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center" />
        }
      >
        <CheckIcon className="pointer-events-none" />
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  )
}

function ComboboxEmpty({
  className,
  ...props
}: ComboboxPrimitive.Empty.Props) {
  return (
    <ComboboxPrimitive.Empty
      data-slot="combobox-empty"
      className={cn(
        "w-full py-2 text-center text-sm text-muted-foreground",
        className,
      )}
      {...props}
    />
  )
}

function ComboboxGroup({
  className,
  ...props
}: ComboboxPrimitive.Group.Props) {
  return (
    <ComboboxPrimitive.Group
      data-slot="combobox-group"
      className={cn(className)}
      {...props}
    />
  )
}

function ComboboxLabel({
  className,
  ...props
}: ComboboxPrimitive.GroupLabel.Props) {
  return (
    <ComboboxPrimitive.GroupLabel
      data-slot="combobox-label"
      className={cn("px-2 py-1.5 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

function ComboboxSeparator({
  className,
  ...props
}: ComboboxPrimitive.Separator.Props) {
  return (
    <ComboboxPrimitive.Separator
      data-slot="combobox-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function ComboboxValue({ ...props }: ComboboxPrimitive.Value.Props) {
  return (
    <ComboboxPrimitive.Value data-slot="combobox-value" {...props} />
  )
}

export {
  Combobox,
  ComboboxClear,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxSearchInput,
  ComboboxSeparator,
  ComboboxTrigger,
  ComboboxValue,
}
