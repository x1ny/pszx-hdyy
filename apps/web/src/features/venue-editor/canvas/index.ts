import type { LayoutEditor } from "../contract";
import {
  type CanvasDoc,
  emptyCanvasDoc,
  parseCanvasDoc,
  projectCanvas,
} from "./core/document";

/**
 * `svg-canvas-v1` —— 画布编辑器。
 *
 * 和 `structural-v1` 实现同一个契约，两者共存：页面按场地已有的 `rendererKind`
 * 决定用哪个打开。这就是 docs/场地排位底层设计.md §4 那套设计要买的东西——
 * 换编辑器不动核心表、状态机、权限和级联规则的任何一行。
 *
 * `rendererKind` 一经写入不再更换，唯一的例外是 `structural-v1` → 本编辑器：
 * 结构里没有几何信息，画布可以用 `canvasDocFromProjection` 从零布局它，属于
 * "从没有几何升级到有几何"。反向不允许（会丢掉全部坐标）。
 */
export const canvasEditor: LayoutEditor<CanvasDoc> = {
  kind: "svg-canvas-v1",
  version: 1,
  title: "平面图画布",

  createEmpty: emptyCanvasDoc,
  safeParse: parseCanvasDoc,
  project: projectCanvas,
};

export type { CanvasDoc };
