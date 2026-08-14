import * as React from "react"

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "#/shared/components/ui/dialog.tsx"
import { cn } from "#/shared/lib/utils.ts"

type SimpleDialogProps = Omit<React.ComponentProps<typeof Dialog>, "children"> & {
  title: React.ReactNode
  description?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  contentProps?: Omit<
    React.ComponentProps<typeof DialogContent>,
    "children"
  >
}

/**
 * 三段式 Dialog 的简洁入口。需要更复杂的头部或布局时，继续直接组合
 * DialogContent、DialogHeader、DialogBody 和 DialogFooter 即可。
 */
function SimpleDialog({
  title,
  description,
  children,
  footer,
  contentProps,
  ...dialogProps
}: SimpleDialogProps) {
  const { className: contentClassName, ...restContentProps } = contentProps ?? {}
  const actions = footer !== undefined ? <DialogFooter>{footer}</DialogFooter> : null

  return (
    <Dialog {...dialogProps}>
      <DialogContent
        {...restContentProps}
        className={cn(contentClassName)}
      >
        <DialogHeader title={title} description={description} />
        <DialogBody>{children}</DialogBody>
        {actions}
      </DialogContent>
    </Dialog>
  )
}

export { SimpleDialog }
