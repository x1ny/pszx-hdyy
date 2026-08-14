import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "#/shared/lib/utils.ts"
import { Button } from "#/shared/components/ui/button.tsx"
import { XIcon } from "lucide-react"

// ⚠️ 这个文件相对 shadcn registry 原版有改动，`shadcn add dialog` 会静默覆盖，
// 覆盖后要按下面几条重新打一遍（AGENTS.md：vendored 组件改了必须留说明）：
//
// 1. **DialogContent 从 `grid gap-6 p-6` 改成 `flex flex-col overflow-hidden`
//    + `max-h-[calc(100dvh-2rem)]`。** 原版靠每个调用点自己写
//    `max-h-[85vh] overflow-y-auto`，滚动的是整个弹窗，头部标题和底部按钮会
//    一起滚出视野——十几个字段的表单里"保存"按钮直接掉到视口外。现在头尾
//    `shrink-0` 钉住，只有 DialogBody 滚。用 `dvh` 不用 `vh`：移动端地址栏
//    伸缩时 `vh` 算出来是错的。
//
// 2. **新增 DialogBody**（原版没有这个 slot）。`min-h-0` 是关键且反直觉的
//    一条：不加的话 flex 子元素不肯收缩，`overflow-y-auto` 永远不触发。
//    注意 **DialogContent 不再有内边距**，内容必须放进 DialogBody 才有
//    `px-6 py-6`，否则会贴着弹窗边缘。
//
// 3. **DialogHeader 加 `pr-12`** 给右上角关闭按钮留位，标题长了不会被盖住；
//    并接受可选的 `title`/`description` props（不传 children 时才生效）。
//
// 4. **DialogFooter 加 `border-t bg-popover`**，作为钉住的操作条。

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl bg-popover text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-md data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-4 right-4"
                size="icon-sm"
              />
            }
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({
  className,
  title,
  description,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & {
  title?: React.ReactNode
  description?: React.ReactNode
}) {
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        "flex shrink-0 flex-col gap-2 border-b px-6 py-4 pr-12",
        className
      )}
      {...props}
    >
      {children ?? (
        <>
          {title != null && <DialogTitle>{title}</DialogTitle>}
          {description != null && (
            <DialogDescription>{description}</DialogDescription>
          )}
        </>
      )}
    </div>
  )
}

function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-body"
      className={cn(
        "min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-6 py-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className
      )}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex shrink-0 flex-col-reverse gap-2 border-t bg-popover px-6 py-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("font-heading leading-none font-medium", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
