type FullscreenRequestTarget = Element & {
  requestFullscreen?: () => Promise<void>;
};

/** 当前浏览器原生全屏的元素是否就是调用方预期的目标。 */
export function isTargetFullscreen(
  fullscreenElement: Element | null,
  target: Element | null,
) {
  return target !== null && fullscreenElement === target;
}

/**
 * Fullscreen API 在部分嵌入式 WebView 中不存在。调用点据此切到页面铺满的
 * CSS 降级，不让功能按钮变成无响应的摆设。
 */
export function supportsFullscreenRequest(
  target: Element | null,
): target is FullscreenRequestTarget {
  return (
    typeof (target as FullscreenRequestTarget | null)?.requestFullscreen ===
    "function"
  );
}
