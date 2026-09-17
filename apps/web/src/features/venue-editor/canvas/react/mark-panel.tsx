import {
  CheckIcon,
  CircleIcon,
  Disc2Icon,
  PentagonIcon,
  SquareIcon,
  Trash2Icon,
} from "lucide-react";
import { useId } from "react";
import { Button } from "#/shared/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "#/shared/components/ui/field";
import { Input } from "#/shared/components/ui/input";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "#/shared/components/ui/toggle-group";
import { cn } from "#/shared/lib/utils";
import { type CanvasMark, MARK_LABEL_MAX } from "../core/document";
import { MARK_COLORS, type MarkDrawShape, markShapeLabel } from "../core/marks";
import { MarkSwatch } from "./mark-view";

/**
 * 形状选择放在面板里而不是工具栏：工具栏在窄屏上会因为多出一组按钮换行，
 * 画布正好在落笔前往下跳。
 */
const DRAW_SHAPES: {
  value: MarkDrawShape;
  label: string;
  icon: typeof SquareIcon;
}[] = [
  { value: "rect", label: "矩形", icon: SquareIcon },
  { value: "circle", label: "圆形", icon: CircleIcon },
  { value: "ellipse", label: "椭圆", icon: Disc2Icon },
  { value: "polygon", label: "多边形", icon: PentagonIcon },
];

const DRAW_HINTS: Record<MarkDrawShape, string> = {
  rect: "在画布上拖出矩形；点一下放一个默认大小的。",
  circle: "在画布上拖出圆形；点一下放一个默认大小的。",
  ellipse: "在画布上拖出椭圆；点一下放一个默认大小的。",
  polygon: "逐点点击画多边形，点回起点或按 Enter 闭合，Esc 取消。",
};

/**
 * 场地标注面板：列表 + 当前标注的文字、颜色、删除。
 *
 * 标注不影响座位和人员，删除直接生效、可撤销，不像整排删除那样二次确认。
 */
export function MarkPanel({
  marks,
  activeMark,
  drawShape,
  onDrawShapeChange,
  onSelect,
  onPatch,
  onRemove,
}: {
  marks: readonly CanvasMark[];
  activeMark?: CanvasMark;
  /** 标注工具激活时给出正在画的形状，面板显示对应的操作提示。 */
  drawShape?: MarkDrawShape;
  onDrawShapeChange: (shape: MarkDrawShape) => void;
  onSelect: (mark: CanvasMark | null) => void;
  onPatch: (
    markId: string,
    patch: Partial<Pick<CanvasMark, "label" | "color">>,
  ) => void;
  onRemove: (markId: string) => void;
}) {
  return (
    <section
      className="space-y-3 rounded-lg border bg-card p-3"
      aria-label="场地标注"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm">标注 · {marks.length}</h3>
        {activeMark && (
          <Button size="sm" variant="ghost" onClick={() => onSelect(null)}>
            完成
          </Button>
        )}
      </div>
      {activeMark ? (
        <MarkEdit
          mark={activeMark}
          marks={marks}
          onPatch={(patch) => onPatch(activeMark.externalId, patch)}
          onRemove={() => onRemove(activeMark.externalId)}
        />
      ) : drawShape ? (
        <div className="space-y-2">
          <ToggleGroup
            value={[drawShape]}
            onValueChange={(values) => {
              if (values.length) onDrawShapeChange(values[0] as MarkDrawShape);
            }}
            size="sm"
            className="flex-wrap"
            aria-label="标注形状"
          >
            {DRAW_SHAPES.map((item) => (
              <ToggleGroupItem
                key={item.value}
                type="button"
                value={item.value}
              >
                <item.icon data-icon="inline-start" />
                {item.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className="text-muted-foreground text-xs">
            {DRAW_HINTS[drawShape]}
          </p>
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">
          用工具栏的「标注」画出主题板、门口、舞台等参照物，帮嘉宾辨认方向。标注不影响排座。
        </p>
      )}
      {marks.length > 0 && (
        <div className="max-h-48 space-y-1 overflow-y-auto">
          {marks.map((mark) => (
            <Button
              key={mark.externalId}
              variant={
                mark.externalId === activeMark?.externalId
                  ? "secondary"
                  : "ghost"
              }
              size="sm"
              className="w-full justify-start"
              onClick={() => onSelect(mark)}
            >
              <MarkSwatch type={mark.shape.type} color={mark.color} />
              <span
                className={cn(
                  "truncate",
                  !mark.label.trim() && "text-muted-foreground",
                )}
              >
                {mark.label.trim() || "未命名标注"}
              </span>
              <span className="ml-auto text-muted-foreground text-xs">
                {markShapeLabel(mark.shape)}
              </span>
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}

function MarkEdit({
  mark,
  marks,
  onPatch,
  onRemove,
}: {
  mark: CanvasMark;
  marks: readonly CanvasMark[];
  onPatch: (patch: Partial<Pick<CanvasMark, "label" | "color">>) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const color = mark.color.toUpperCase();
  // 预置色都是大写十六进制，自定义色统一转大写后比较。
  const sameColor = marks.filter(
    (other) =>
      other.externalId !== mark.externalId &&
      other.color.toUpperCase() === color &&
      other.label.trim() !== mark.label.trim(),
  );

  return (
    <div className="space-y-3">
      <Field>
        <FieldLabel htmlFor={`${id}-label`}>文字</FieldLabel>
        <Input
          id={`${id}-label`}
          value={mark.label}
          maxLength={MARK_LABEL_MAX}
          placeholder="如：主题板、门口、舞台"
          autoFocus={!mark.label}
          onChange={(event) => onPatch({ label: event.target.value })}
        />
      </Field>
      <FieldSet className="gap-2">
        <FieldLegend variant="label" className="mb-0">
          颜色
        </FieldLegend>
        <div className="flex flex-wrap items-center gap-1.5">
          {MARK_COLORS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-label={option.name}
              aria-pressed={option.value === color}
              title={option.name}
              className="flex size-6 items-center justify-center rounded-full outline-none ring-offset-2 ring-offset-card focus-visible:ring-2 focus-visible:ring-ring"
              style={{ backgroundColor: option.value }}
              onClick={() => onPatch({ color: option.value })}
            >
              {option.value === color && (
                <CheckIcon className="size-3.5 text-white" />
              )}
            </button>
          ))}
          {/* 预置色不够用时再开原生拾色器，产出的 #rrggbb 与存储格式一致。 */}
          <input
            type="color"
            aria-label="自定义颜色"
            title="自定义颜色"
            value={color.toLowerCase()}
            onChange={(event) => onPatch({ color: event.target.value })}
            className="h-6 w-8 cursor-pointer rounded-md border bg-transparent p-0.5"
          />
        </div>
        {sameColor.length > 0 && (
          <FieldDescription>
            与「{sameColor[0].label.trim() || "未命名标注"}
            」同色。文字放不下时 H5 用颜色区分图例，建议换一种颜色。
          </FieldDescription>
        )}
      </FieldSet>
      <p className="text-muted-foreground text-xs">
        {markShapeLabel(mark.shape)} ·
        拖动可移动，拖四角可调整大小。形状太小写不下文字时，H5
        会在图上方用颜色图例说明。
      </p>
      <Button variant="ghost" size="sm" onClick={onRemove}>
        <Trash2Icon />
        删除标注
      </Button>
    </div>
  );
}
