import { ArrowDownIcon, ArrowUpIcon, Trash2Icon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button } from "#/shared/components/ui/button";
import { Field, FieldLabel } from "#/shared/components/ui/field";
import { Input } from "#/shared/components/ui/input";
import type { CanvasRow } from "../core/document";
import {
  DEFAULT_TABLE_SIDES,
  type RowParams,
  sumSides,
  validRowParams,
} from "../core/rows";

const SIDE_FIELDS = [
  ["top", "上"],
  ["right", "右"],
  ["bottom", "下"],
  ["left", "左"],
] as const;

export function RowPanel({
  rows,
  activeRow,
  creating,
  defaults,
  onDefaults,
  onSelect,
  onChange,
  onCreate,
  onRemove,
  onOrder,
}: {
  rows: CanvasRow[];
  activeRow?: CanvasRow;
  creating: boolean;
  defaults: RowParams;
  onDefaults: (params: RowParams) => void;
  onSelect: (row: CanvasRow | null) => void;
  onChange: (params: RowParams) => void;
  onCreate: () => void;
  onRemove: () => void;
  onOrder: (rowId: string, direction: -1 | 1) => void;
}) {
  return (
    <section
      className="space-y-3 rounded-lg border bg-card p-3"
      aria-label="排管理"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm">排 · {rows.length}</h3>
        {activeRow && (
          <Button size="sm" variant="ghost" onClick={() => onSelect(null)}>
            返回座位属性
          </Button>
        )}
      </div>
      {creating ? (
        <>
          <p className="text-muted-foreground text-xs">
            直排拖出起点和方向；环形排从圆心向外拖。圆桌/方桌按四周人数自动生成，不用手画，点一下或按参数在视野中心创建即可。
          </p>
          <RowFields params={defaults} onChange={onDefaults} />
          <Button
            className="w-full"
            disabled={!validRowParams(defaults)}
            onClick={onCreate}
          >
            按参数创建
          </Button>
        </>
      ) : activeRow ? (
        <RowEdit row={activeRow} onChange={onChange} onRemove={onRemove} />
      ) : (
        <p className="text-muted-foreground text-xs">
          选择一排可整体移动和调整参数；排的先后与名称、画布位置无关。
        </p>
      )}
      <div className="max-h-56 space-y-1 overflow-y-auto">
        {rows.map((row, index) => (
          <div key={row.externalId} className="flex items-center gap-1">
            <Button
              variant={
                row.externalId === activeRow?.externalId ? "secondary" : "ghost"
              }
              size="sm"
              className="min-w-0 flex-1 justify-start"
              onClick={() => onSelect(row)}
            >
              <span className="truncate">
                {index + 1}. {row.name}
              </span>
              <span className="ml-auto text-muted-foreground">
                {row.seatIds.length}座
              </span>
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`上移${row.name}`}
              disabled={index === 0}
              onClick={() => onOrder(row.externalId, -1)}
            >
              <ArrowUpIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`下移${row.name}`}
              disabled={index === rows.length - 1}
              onClick={() => onOrder(row.externalId, 1)}
            >
              <ArrowDownIcon />
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}

function RowEdit({
  row,
  onChange,
  onRemove,
}: {
  row: CanvasRow;
  onChange: (params: RowParams) => void;
  onRemove: () => void;
}) {
  const [params, setParams] = useState<RowParams>({
    ...row,
    count: Math.max(1, row.seatIds.length),
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    setParams({ ...row, count: Math.max(1, row.seatIds.length) });
  }, [row]);
  const changeParams = (next: RowParams) => {
    setParams(next);
    if (validRowParams(next) && next.name.trim()) onChange(next);
  };
  return (
    <div className="space-y-3">
      <RowFields params={params} onChange={changeParams} />
      <p className="text-muted-foreground text-xs">
        增减从排尾开始，保留座位的编号不变。修改间距、方向或形状会按参数重新排列本排；环形排增减座位也会重排。
      </p>
      {params.count < row.seatIds.length && (
        <output className="text-destructive text-xs">
          将移除排尾 {row.seatIds.length - params.count} 个座位，可撤销。
        </output>
      )}
      {confirmDelete ? (
        <div className="space-y-2">
          <p className="text-sm">
            删除本排及全部 {row.seatIds.length} 个座位？
          </p>
          <Button variant="destructive" size="sm" onClick={onRemove}>
            确认删除
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirmDelete(false)}
          >
            取消
          </Button>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2Icon />
          删除整排
        </Button>
      )}
    </div>
  );
}

function RowFields({
  params,
  onChange,
}: {
  params: RowParams;
  onChange: (params: RowParams) => void;
}) {
  const id = useId();
  const isRect = params.shape === "rect";
  const sides = params.sides ?? DEFAULT_TABLE_SIDES;
  const fields: Array<
    ["count" | "spacing" | "angle" | "aisleEvery", string, number | undefined]
  > = isRect
    ? [
        ["spacing", "座位中心间距", 1],
        ["angle", "方向角度（°）", undefined],
      ]
    : [
        ["count", "座位数量", 1],
        ["spacing", "座位中心间距", 1],
        ["angle", "方向角度（°）", undefined],
        ...(params.shape === "line"
          ? [
              ["aisleEvery", "每几座留过道", 0] as [
                "aisleEvery",
                string,
                number,
              ],
            ]
          : []),
      ];
  return (
    <div className="space-y-3">
      <Field>
        <FieldLabel htmlFor={`${id}-name`}>
          {isRect || params.shape === "circle" ? "桌名称" : "排名称"}
        </FieldLabel>
        <Input
          id={`${id}-name`}
          aria-label="排名称"
          value={params.name}
          maxLength={128}
          placeholder="留空自动命名"
          onChange={(event) =>
            onChange({ ...params, name: event.target.value })
          }
        />
      </Field>
      <fieldset className="flex gap-1" aria-label="排形状">
        <Button
          size="sm"
          variant={params.shape === "line" ? "secondary" : "ghost"}
          onClick={() => onChange({ ...params, shape: "line" })}
        >
          直排
        </Button>
        <Button
          size="sm"
          variant={params.shape === "circle" ? "secondary" : "ghost"}
          onClick={() => onChange({ ...params, shape: "circle" })}
        >
          圆桌
        </Button>
        <Button
          size="sm"
          variant={isRect ? "secondary" : "ghost"}
          onClick={() =>
            onChange({
              ...params,
              shape: "rect",
              sides,
              count: sumSides(sides),
            })
          }
        >
          方桌
        </Button>
      </fieldset>
      {isRect && (
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs">
            桌子四周各自的座位数，允许为 0；两侧长桌把上下填 0 即可。
          </p>
          <div className="grid grid-cols-2 gap-3">
            {SIDE_FIELDS.map(([key, label]) => (
              <Field key={key}>
                <FieldLabel htmlFor={id + key}>{label}侧人数</FieldLabel>
                <Input
                  id={id + key}
                  aria-label={`${label}侧人数`}
                  type="number"
                  min={0}
                  step={1}
                  value={sides[key]}
                  onChange={(event) => {
                    const next = {
                      ...sides,
                      [key]: Math.max(0, Number(event.target.value) || 0),
                    };
                    onChange({ ...params, sides: next, count: sumSides(next) });
                  }}
                />
              </Field>
            ))}
          </div>
          <p className="text-muted-foreground text-xs">
            共 {sumSides(sides)} 座。
          </p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        {fields.map(([key, label, min]) => (
          <Field key={key}>
            <FieldLabel htmlFor={id + key}>{label}</FieldLabel>
            <Input
              id={id + key}
              aria-label={label}
              type="number"
              min={min}
              step={1}
              value={Number.isNaN(params[key]) ? "" : params[key]}
              onChange={(event) =>
                onChange({
                  ...params,
                  [key]:
                    event.target.value === ""
                      ? Number.NaN
                      : Number(event.target.value),
                })
              }
            />
          </Field>
        ))}
      </div>
      <p className="text-muted-foreground text-xs">
        间距为画布单位；过道填 0 表示不留。
      </p>
    </div>
  );
}
