import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeftIcon, Loader2Icon, SaveIcon } from "lucide-react";
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
  emptyCanvasDoc,
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
import { Button, buttonVariants } from "#/shared/components/ui/button.tsx";
import { cn } from "#/shared/lib/utils.ts";
import {
  type ActivityVenueLayoutBundle,
  fetchZoneUsage,
  saveActivityVenueLayout,
} from "../-venue-queries";

/**
 * 活动空间自己的画布编辑器外壳。**跟 venue 模块的 `CanvasEditorView` 是同一套
 * 骨架**——两级架构（区域分布 + 进区域排位）、同一个 `EditorState`/Command
 * 历史、同一个保存流程，字面意义上"复用编辑器的功能"。
 *
 * 跟场地库那份的三处差别，都是因为这份画布是**活动私有的拷贝**，不是场地库
 * 的原件：
 *
 * 1. 没有"表单式编辑器"这条分支——导入时源场地必然已经是画布渲染器写的
 *    （venue 模块现在只产出 `svg-canvas-v1`），不存在要升级的老结构。
 * 2. 保存不带座位——活动层不落座位行（底层设计 §3.3），`projectCanvas()`
 *    投影出的座位那部分直接丢弃，只把区域投影发给 `activityVenue/saveLayout`。
 * 3. 区域属性面板多一截业务字段（活动用途/可用点位/状态），这些字段编辑器
 *    压根不认识，靠 `ZonePropertyPanel` 的 `extra` 插槽从外面塞进去。
 */
export function ActivityVenueCanvasEditorView({
  activityVenueId,
  projectId,
  activityId,
  bundle,
  onSaved,
  onOpenBusinessFields,
}: {
  activityVenueId: number;
  projectId: string;
  activityId: string;
  bundle: ActivityVenueLayoutBundle;
  onSaved: () => void;
  /** 打开"活动用途/可用点位"那个业务字段弹窗（现成的 `ActivityZoneDialog`）。 */
  onOpenBusinessFields: (zoneId: number) => void;
}) {
  const initialDoc = useMemo<CanvasDoc>(() => {
    if (!bundle.layout) return emptyCanvasDoc();
    return canvasEditor.safeParse(bundle.layout.data) ?? emptyCanvasDoc();
  }, [bundle]);

  const [state, setState] = useState<EditorState>(() =>
    initialState(initialDoc),
  );
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null);

  const doc = state.doc;
  const activeZone =
    doc.zones.find((zone) => zone.externalId === activeZoneId) ?? null;

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

  /** externalId → 活动区域行的数字 id，业务字段弹窗按这个 id 找行。 */
  const zoneRowIdByExternalId = useMemo(
    () => new Map(bundle.zones.map((row) => [row.externalId, row.id])),
    [bundle.zones],
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const projection = canvasEditor.project(doc);

      /**
       * 保存前先拦一道"删掉了正被排位引用的区域"。
       *
       * 不拦的话这次保存会撞 `fk_seating_plan_zone` 外键——服务端只能回一句
       * "服务器内部错误"，而且**整批改动一起回滚**，用户既不知道是哪块区域，
       * 也不知道这次编辑的其它内容为什么没保存（评审 §3.2）。
       *
       * venue 模块看不见 seating（单向依赖），拦不了也不该拦；但前端把两个
       * 模块的数据拼起来是允许的——概览页的「引用环节」列本来就是这么做的。
       */
      const stillHere = new Set(projection.zones.map((z) => z.externalId));
      const removed = bundle.zones.filter((z) => !stillHere.has(z.externalId));

      if (removed.length > 0) {
        const usage = await fetchZoneUsage(Number(activityId));
        const usedBy = new Map<number, string[]>();
        for (const row of usage) {
          const list = usedBy.get(row.activityVenueZoneId) ?? [];
          list.push(row.segmentName);
          usedBy.set(row.activityVenueZoneId, list);
        }
        const blocked = removed
          .map((zone) => ({ zone, segments: usedBy.get(zone.id) ?? [] }))
          .filter((item) => item.segments.length > 0);

        if (blocked.length > 0) {
          throw new Error(
            `这些区域正被环节排位引用，删不掉：${blocked
              .map((b) => `${b.zone.name}（${b.segments.join("、")}）`)
              .join("；")}。请先作废那些排位方案，或撤销删除后再保存。`,
          );
        }
      }

      // 只投影区域——活动层不落座位行，座位那部分不发给服务端（§3.3）。
      return saveActivityVenueLayout({
        activityVenueId,
        layout: {
          rendererKind: canvasEditor.kind,
          rendererVersion: canvasEditor.version,
          data: doc,
        },
        zones: projection.zones,
      });
    },
    onSuccess: (result) => {
      setState(markSaved);
      toast.success(
        `已保存：区域 +${result.zones.added}/~${result.zones.updated}/-${result.zones.removed}`,
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
            to="/project/$projectId/activity/$activityId/venue"
            params={{ projectId, activityId }}
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon" }),
              "text-muted-foreground",
            )}
            aria-label="返回场地空间"
          >
            <ArrowLeftIcon />
          </Link>
          <div>
            <h1 className="font-semibold text-xl tracking-tight">
              {bundle.activityVenue.name}
            </h1>
            <p className="text-muted-foreground text-sm">
              活动空间平面图 · {doc.zones.length} 个区域 · {doc.seats.length}{" "}
              个座位
              {state.dirty && (
                <span className="ml-2 text-warning-foreground">
                  有未保存的修改
                </span>
              )}
            </p>
          </div>
        </div>
        <Button
          disabled={saveMutation.isPending || !state.dirty}
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

      {activeZone ? (
        <ZoneSeatingEditor
          key={activeZone.externalId}
          zone={activeZone}
          state={state}
          selection={selection}
          onSelectionChange={setSelection}
          onCommand={runCommand}
          onBack={leaveZone}
          backLabel="返回活动空间分布"
          title="布置座位"
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
              enterLabel="布置座位"
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
              extra={(zone) => {
                const rowId = zoneRowIdByExternalId.get(zone.externalId);
                if (!rowId) return null;
                return (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => onOpenBusinessFields(rowId)}
                  >
                    活动用途 / 可用点位
                  </Button>
                );
              }}
            />
          }
        />
      )}
    </div>
  );
}
