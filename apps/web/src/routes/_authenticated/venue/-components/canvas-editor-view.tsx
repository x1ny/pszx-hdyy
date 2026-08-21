import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  Loader2Icon,
  SaveIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { canvasEditor } from "#/features/venue-editor/canvas";
import {
  patchSeats as patchSeatsCommand,
  patchZone as patchZoneCommand,
  removeSeats as removeSeatsCommand,
  removeZones as removeZonesCommand,
} from "#/features/venue-editor/canvas/core/commands";
import {
  type CanvasDoc,
  canvasDocFromProjection,
} from "#/features/venue-editor/canvas/core/document";
import {
  type EditorState,
  execute,
  initialState,
  markSaved,
} from "#/features/venue-editor/canvas/core/history";
import {
  EMPTY_SELECTION,
  type Selection,
} from "#/features/venue-editor/canvas/core/interaction";
import { CanvasEditor } from "#/features/venue-editor/canvas/react/canvas-editor";
import {
  SeatPropertyPanel,
  ZonePropertyPanel,
} from "#/features/venue-editor/canvas/react/property-panel";
import { ZoneSeatingEditor } from "#/features/venue-editor/canvas/react/zone-seating-editor";
import { validateProjection } from "#/features/venue-editor/contract";
import { Button, buttonVariants } from "#/shared/components/ui/button.tsx";
import { cn } from "#/shared/lib/utils.ts";
import { saveVenueLayout, type VenueLayoutBundle } from "../-queries";
import { bundleToProjection } from "../-utils";

/**
 * 画布编辑器在场地页里的外壳：初始文档从哪来、保存怎么发、校验怎么显示，
 * 以及**在两级编辑器之间切换**——区域分布画布（顶层）和某个区域的排位画布
 * （进入区域之后），两者共享同一份 `state`/`onCommand`，只是当前显示哪一个
 * 由 `activeZoneId` 决定（`null` = 顶层，非空 = 正在编辑该区域的排位）。
 *
 * `activeZoneId` 是纯本地状态，不写进 URL——跟旧的表单式编辑器页里
 * `selectedZoneId` 的做法一致（没有深链接、没有浏览器后退支持），这次先不
 * 为它单独引入路由层，等真的需要"分享一个具体区域的排位链接"时再改。
 *
 * 编辑器本体（`features/venue-editor/canvas`）不认识接口也不认识路由——
 * 它只吃一份 `CanvasDoc`、吐一份 `CanvasDoc`。这一层才是胶水。
 */
export function CanvasEditorView({
  venueId,
  bundle,
  onSaved,
}: {
  venueId: number;
  bundle: VenueLayoutBundle;
  onSaved: () => void;
}) {
  /**
   * 初始文档三条来源，优先级从高到低：
   *
   * 1. blob 就是画布写的且能解析 → 直接用，坐标原样保留
   * 2. 其它情况 → 从核心表的区域和位置**从零布局**一份
   *
   * 第 2 条同时覆盖了两个场景：全新场地（什么都没有），以及从表单式编辑器
   * 升级过来（有结构没几何）。后者是 docs/场地排位底层设计.md §4 里唯一允许的
   * `rendererKind` 变更方向——结构里没有几何，画布可以给它编一套。
   */
  const initialDoc = useMemo<CanvasDoc>(() => {
    const parsed =
      bundle.layout?.rendererKind === canvasEditor.kind
        ? canvasEditor.safeParse(bundle.layout.data)
        : null;
    return parsed ?? canvasDocFromProjection(bundleToProjection(bundle));
  }, [bundle]);

  const upgradedFrom =
    bundle.layout && bundle.layout.rendererKind !== canvasEditor.kind
      ? bundle.layout.rendererKind
      : null;

  const [state, setState] = useState<EditorState>(() =>
    initialState(initialDoc),
  );
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null);

  const doc = state.doc;
  const projection = useMemo(() => canvasEditor.project(doc), [doc]);
  const issues = useMemo(() => validateProjection(projection), [projection]);
  const activeZone =
    doc.zones.find((zone) => zone.externalId === activeZoneId) ?? null;

  /** 所有文档修改的唯一入口——组件内部从不直接 setState 改 doc。 */
  const runCommand = (run: (current: EditorState) => EditorState) =>
    setState((current) => run(current));

  const enterZone = (zoneId: string) => {
    setSelection(EMPTY_SELECTION);
    setActiveZoneId(zoneId);
  };

  const leaveZone = () => {
    setSelection(EMPTY_SELECTION);
    setActiveZoneId(null);
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      saveVenueLayout({
        venueId,
        layout: {
          rendererKind: canvasEditor.kind,
          rendererVersion: canvasEditor.version,
          data: doc,
        },
        zones: projection.zones,
        seats: projection.seats,
      }),
    onSuccess: (result) => {
      setState(markSaved);
      toast.success(
        `已保存：区域 +${result.zones.added}/~${result.zones.updated}/-${result.zones.removed}，` +
          `位置 +${result.seats.added}/~${result.seats.updated}/-${result.seats.removed}`,
      );
      onSaved();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            to="/venue"
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon" }),
              "text-muted-foreground",
            )}
            aria-label="返回场地列表"
          >
            <ArrowLeftIcon />
          </Link>
          <div>
            <h1 className="font-semibold text-xl tracking-tight">
              {bundle.venue.name}
            </h1>
            <p className="text-muted-foreground text-sm">
              平面图 · {doc.zones.length} 个区域 · {doc.seats.length} 个位置
              {state.dirty && (
                <span className="ml-2 text-warning-foreground">
                  有未保存的修改
                </span>
              )}
            </p>
          </div>
        </div>
        <Button
          disabled={saveMutation.isPending || issues.length > 0 || !state.dirty}
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending ? (
            <Loader2Icon className="animate-spin" />
          ) : (
            <SaveIcon />
          )}
          保存
        </Button>
      </div>

      {upgradedFrom && (
        <Banner>
          这个场地原来用的是「{upgradedFrom}
          」，区域已经按现有结构自动排了一版分布。调整好之后保存，它就正式变成平面图场地了——这个方向不可逆。
        </Banner>
      )}

      {issues.length > 0 && (
        <Banner tone="error">
          <ul className="list-inside list-disc">
            {issues.slice(0, 5).map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
            {issues.length > 5 && <li>还有 {issues.length - 5} 处问题…</li>}
          </ul>
        </Banner>
      )}

      {activeZone ? (
        <ZoneSeatingEditor
          key={activeZone.externalId}
          zone={activeZone}
          state={state}
          selection={selection}
          onSelectionChange={setSelection}
          onCommand={runCommand}
          onBack={leaveZone}
          rightPanel={
            <SeatPropertyPanel
              doc={doc}
              selection={selection}
              onPatchSeats={(seatIds, patch) =>
                runCommand((s) => execute(s, patchSeatsCommand(seatIds, patch)))
              }
              onRemoveSeats={(seatIds) => {
                runCommand((s) => execute(s, removeSeatsCommand(seatIds)));
                setSelection(EMPTY_SELECTION);
              }}
            />
          }
        />
      ) : (
        <CanvasEditor
          state={state}
          selection={selection}
          onSelectionChange={setSelection}
          onCommand={runCommand}
          onEnterZone={enterZone}
          rightPanel={
            <ZonePropertyPanel
              doc={doc}
              selection={selection}
              onSelectZone={(zoneId) =>
                setSelection({ zoneIds: [zoneId], seatIds: [] })
              }
              onClearSelection={() => setSelection(EMPTY_SELECTION)}
              onPatchZone={(zoneId, patch) =>
                runCommand((s) => execute(s, patchZoneCommand(zoneId, patch)))
              }
              onRemoveZone={(zoneId) => {
                runCommand((s) => execute(s, removeZonesCommand([zoneId])));
                setSelection(EMPTY_SELECTION);
              }}
              onEnterZone={enterZone}
            />
          }
        />
      )}
    </div>
  );
}

function Banner({
  children,
  tone = "warning",
}: {
  children: React.ReactNode;
  tone?: "warning" | "error";
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border px-4 py-3 text-sm",
        tone === "error"
          ? "border-destructive/30 bg-destructive/5 text-destructive"
          : "border-warning/30 bg-warning/10 text-warning-foreground",
      )}
    >
      <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
