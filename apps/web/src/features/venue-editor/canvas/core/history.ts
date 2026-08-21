import {
  applyPatches,
  enablePatches,
  type Patch,
  produceWithPatches,
} from "immer";
import type { Command } from "./commands";
import type { CanvasDoc } from "./document";

// immer 的补丁功能默认关闭，用之前必须显式打开一次。
enablePatches();

/**
 * 撤销栈。存的是**补丁对，不是全量快照**——一次拖动只产生几个字节的 diff，
 * 而快照要复制整份文档（上千个座位）。
 *
 * 边界就是 Command：**一次手势 = 一个 Command = 一个 undo 步**。这不是巧合，
 * 是 §4.2 把工具接口设计成"只有 onDragEnd 能产出 Command"换来的——拖拽过程中
 * 根本没有机会往文档里写中间态，所以也就不会产生一串没人想要的撤销步。
 */

export type HistoryEntry = {
  label: string;
  patches: Patch[];
  inverse: Patch[];
};

export type EditorState = {
  doc: CanvasDoc;
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** 上次保存之后有没有改动过。 */
  dirty: boolean;
};

/** 栈深度。50 步够覆盖一次连续编辑，再深的收益递减、内存却线性涨。 */
const LIMIT = 50;

export const initialState = (doc: CanvasDoc): EditorState => ({
  doc,
  past: [],
  future: [],
  dirty: false,
});

export function execute(state: EditorState, command: Command): EditorState {
  const [next, patches, inverse] = produceWithPatches(state.doc, command.apply);

  // 命令没改到任何东西就不要压栈——否则会出现"按了撤销但界面没变化"的空步。
  if (patches.length === 0) return state;

  return {
    doc: next,
    past: [...state.past, { label: command.label, patches, inverse }].slice(
      -LIMIT,
    ),
    // 新操作让重做链失效，这是撤销栈的标准语义。
    future: [],
    dirty: true,
  };
}

export function undo(state: EditorState): EditorState {
  const entry = state.past.at(-1);
  if (!entry) return state;

  return {
    doc: applyPatches(state.doc, entry.inverse),
    past: state.past.slice(0, -1),
    future: [entry, ...state.future],
    dirty: true,
  };
}

export function redo(state: EditorState): EditorState {
  const [entry, ...rest] = state.future;
  if (!entry) return state;

  return {
    doc: applyPatches(state.doc, entry.patches),
    past: [...state.past, entry],
    future: rest,
    dirty: true,
  };
}

/** 保存成功后调用：文档不变，只是把"有未保存修改"的标记清掉。撤销栈保留。 */
export const markSaved = (state: EditorState): EditorState => ({
  ...state,
  dirty: false,
});

export const canUndo = (state: EditorState) => state.past.length > 0;
export const canRedo = (state: EditorState) => state.future.length > 0;
/** 撤销按钮的 tooltip 上显示"撤销：移动位置"，比光一个图标好懂。 */
export const undoLabel = (state: EditorState) => state.past.at(-1)?.label;
export const redoLabel = (state: EditorState) => state.future[0]?.label;
