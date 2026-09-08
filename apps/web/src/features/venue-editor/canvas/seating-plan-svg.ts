import {
  browserSeatingPlanJpegBridge,
  buildSeatingPlanJpegFileName,
  buildSeatingPlanSvg,
  type SeatingPlanJpegInput,
} from "./seating-plan-jpeg";

/** 直接保存矢量内容，不经过 Canvas 栅格化，放大后仍保留文字和座位细节。 */
export function downloadSeatingPlanSvg(
  input: SeatingPlanJpegInput,
  options: {
    now?: Date;
    saveFile?: (blob: Blob, fileName: string) => void;
  } = {},
) {
  const { svg } = buildSeatingPlanSvg(input);
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const fileName = buildSeatingPlanJpegFileName(
    input.segmentName,
    input.zoneName,
    options.now,
  ).replace(/\.jpg$/, ".svg");
  (options.saveFile ?? browserSeatingPlanJpegBridge.saveFile)(blob, fileName);
  return { blob, fileName };
}
