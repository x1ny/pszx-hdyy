import { useEffect, useState } from "react";
import { Button } from "#/shared/components/ui/button.tsx";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "#/shared/components/ui/dialog.tsx";
import { Field, FieldLabel } from "#/shared/components/ui/field.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/shared/components/ui/select.tsx";
import { Textarea } from "#/shared/components/ui/textarea.tsx";

/** 退回原因的常用选项，照原型 seating-confirm.html。选完还能补一段说明。 */
const REASONS = {
  座位安排需调整: "座位安排需调整",
  人员名单有变: "人员名单有变",
  场地区域需调整: "场地区域需调整",
  其他: "其他",
} as const;

export function SeatingRejectDialog({
  open,
  segmentName,
  pending,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  segmentName: string;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState<keyof typeof REASONS>("座位安排需调整");
  const [detail, setDetail] = useState("");

  useEffect(() => {
    if (!open) return;
    setReason("座位安排需调整");
    setDetail("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader
          title="退回排位"
          description={`退回「${segmentName}」的排位方案，排位人员可以重新调整后再次提交。`}
        />
        <DialogBody className="flex flex-col gap-4">
          <Field>
            <FieldLabel>退回原因</FieldLabel>
            <Select
              items={REASONS}
              value={reason}
              onValueChange={(value) =>
                setReason(value as keyof typeof REASONS)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(REASONS) as (keyof typeof REASONS)[]).map(
                  (value) => (
                    <SelectItem key={value} value={value}>
                      {REASONS[value]}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="reject-detail">原因说明</FieldLabel>
            <Textarea
              id="reject-detail"
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
              placeholder="例如：请调整嘉宾席顺序后重新提交确认。"
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              onSubmit(detail.trim() ? `${reason}：${detail.trim()}` : reason)
            }
          >
            确认退回
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
