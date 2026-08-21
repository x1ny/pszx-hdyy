import {
  CircleDotIcon,
  RectangleHorizontalIcon,
  Rows3Icon,
  TriangleAlertIcon,
} from "lucide-react";
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
import { Input } from "#/shared/components/ui/input.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/shared/components/ui/select.tsx";
import { cn } from "#/shared/lib/utils.ts";
import {
  countLayout,
  DEFAULT_LAYOUT_PARAMS,
  type LayoutParams,
  type LayoutPreset,
  NUMBERING_MODES,
  type NumberingMode,
  PRESET_FIELDS,
} from "../core/layout";

/**
 * "导入模板"——一次性生成座位坐标的**操作**，不是区域的一个持久属性。
 *
 * 之前的做法是把模板选择器摆成排位画布常驻的左侧栏，选中的卡片存在
 * `CanvasZone.preset`/`params` 里、下次进这个区域还会记得。这会造成一个真实的
 * 误导：用户手动拖过几个座位之后，这两个字段就跟当前座位对不上了，但选择器
 * 还是照旧把"上次用的模板"显示成当前选中——像是"这个区域仍然是剧场排位"，
 * 其实早就不是了。
 *
 * 改成对话框之后：模板只是**输入**，点"生成"那一刻起消费掉、产出一批普通座位，
 * 关闭对话框后不留任何痕迹——跟直接用「点放位置」逐个摆出来的座位没有任何区别。
 * `CanvasZone` 因此也不用再存 `preset`/`params`（见 `document.ts`）。
 *
 * 只列剧场/宴会/秀场三种真正生成座位的预设，不再把"自由排座"也做成一张卡片——
 * 不点这个按钮、直接用「点放位置」，本来就是自由排座，不需要在这里假装选中它。
 */

const PRESETS = [
  "theater",
  "banquet",
  "runway",
] as const satisfies readonly Exclude<LayoutPreset, "free">[];

const PRESET_META: Record<
  (typeof PRESETS)[number],
  { title: string; subtitle: string; scenes: string[]; icon: typeof Rows3Icon }
> = {
  theater: {
    title: "剧场直排",
    subtitle: "经典横排看台，可加中间过道",
    scenes: ["发布会", "开幕秀", "观众席"],
    icon: Rows3Icon,
  },
  banquet: {
    title: "圆桌宴会",
    subtitle: "多张圆桌，席位环绕",
    scenes: ["晚宴", "VIP 招待"],
    icon: CircleDotIcon,
  },
  runway: {
    title: "秀场双边",
    subtitle: "中间留 T 台通道，两侧看台",
    scenes: ["时装秀", "Walk"],
    icon: RectangleHorizontalIcon,
  },
};

const NUMBERING_LABELS: Record<NumberingMode, string> = {
  rowCol: "排号 + 列号（A1）",
  sequential: "顺序编号（A1…An）",
  tableSeat: "桌号 + 座号（1桌2号）",
};

const PARAM_LABELS = {
  rows: "排数",
  cols: "每排座位",
  aisleEvery: "每几列留过道",
  tableCount: "桌数",
  seatsPerTable: "每桌座位",
} as const;

export function TemplateDialog({
  open,
  onOpenChange,
  existingSeatCount,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingSeatCount: number;
  onApply: (preset: LayoutPreset, params: LayoutParams) => void;
}) {
  const [preset, setPreset] = useState<LayoutPreset>("theater");
  const [params, setParams] = useState<LayoutParams>(DEFAULT_LAYOUT_PARAMS);

  // 每次打开都回到干净的默认选择——这是一次新的操作，不是"恢复上次的状态"。
  useEffect(() => {
    if (!open) return;
    setPreset("theater");
    setParams(DEFAULT_LAYOUT_PARAMS);
  }, [open]);

  const fields = PRESET_FIELDS[preset];
  const willGenerate = countLayout(preset, params);

  const apply = () => {
    onApply(preset, params);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader
          title="导入排位模板"
          description="选一种排法快速生成座位，生成之后就是普通座位，可以随时手动调整。"
        />
        <DialogBody className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-3">
            {PRESETS.map((value) => {
              const meta = PRESET_META[value];
              const active = value === preset;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPreset(value)}
                  className={cn(
                    "flex cursor-pointer flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors",
                    active
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:bg-muted/60",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-md",
                        active
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      <meta.icon className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="font-medium text-sm">{meta.title}</div>
                    </div>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {meta.subtitle}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {meta.scenes.map((scene) => (
                      <span
                        key={scene}
                        className="rounded border border-border bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                      >
                        {scene}
                      </span>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-3 gap-3 border-t pt-4">
            {fields.map((field) => (
              <Field key={field}>
                <FieldLabel htmlFor={`param-${field}`}>
                  {PARAM_LABELS[field]}
                </FieldLabel>
                <Input
                  id={`param-${field}`}
                  type="number"
                  min={0}
                  value={params[field]}
                  onChange={(event) =>
                    setParams({
                      ...params,
                      [field]: Math.max(0, Number(event.target.value) || 0),
                    })
                  }
                />
              </Field>
            ))}
            <Field>
              <FieldLabel>编号规则</FieldLabel>
              <Select
                items={NUMBERING_LABELS}
                value={params.numbering}
                onValueChange={(value) =>
                  setParams({ ...params, numbering: value as NumberingMode })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NUMBERING_MODES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {NUMBERING_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </DialogBody>
        <DialogFooter className="sm:justify-between">
          {existingSeatCount > 0 ? (
            <p className="flex items-center gap-1.5 text-warning-foreground text-xs">
              <TriangleAlertIcon className="size-3.5 shrink-0" />
              当前已有 {existingSeatCount}{" "}
              个位置，导入模板会整体替换，手动调整过的位置也会丢失
            </p>
          ) : (
            <span />
          )}
          <Button type="button" onClick={apply}>
            生成 {willGenerate} 个位置
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
