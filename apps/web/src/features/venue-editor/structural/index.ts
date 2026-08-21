import type { LayoutEditor } from "../contract";
import {
  emptyDoc,
  parseStructuralDoc,
  projectStructural,
  type StructuralDoc,
} from "./model";

/**
 * `structural-v1` —— 目前唯一的编辑器实现。
 *
 * 它同时扮演两个角色：**表单式录入**（很多场地本来就不需要画图）和
 * **降级视图**（画布渲染器认不出某份 blob 时退回到它）。
 *
 * 将来接 SVG 画布编辑器时，这个对象旁边会多一个 `svgEditor`，页面按
 * `rendererKind` 挑一个。按底层设计 §4，`rendererKind` 一经写入不再更换——
 * 唯一的例外是 `structural-v1` → 画布：结构里没有任何几何信息，画布可以从零
 * 布局它，属于"从没有几何升级到有几何"，不是两套几何格式互转。反向不允许。
 */
export const structuralEditor: LayoutEditor<StructuralDoc> = {
  kind: "structural-v1",
  version: 1,
  title: "表单式区域与位置",

  createEmpty: emptyDoc,

  safeParse(raw) {
    return parseStructuralDoc(raw);
  },

  project: projectStructural,
};

export type { StructuralDoc };
