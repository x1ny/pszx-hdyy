import { useQuery } from "@tanstack/react-query";
import { renderAsync } from "docx-preview";
import { AlertCircleIcon, Loader2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * 在页面里渲染一份真实的 .docx。
 *
 * **渲染源是服务端产出的那个文件本身，不是数据。** 上一版的预览是前端用 React
 * 照着数据另画一个版面，两套版面代码必然漂移——真实案例：附则在 HTML 预览里排
 * 在落款之后，在导出的 Word 里却排在联系人之前，没人发现。现在版式只存在于
 * docx 模板文件里，前端无从近似，也就没有漂移的余地。
 *
 * 已知边界：docx-preview 受 HTML/CSS 能力限制（[官方说明]，Google Docs 那种
 * 像素级还原是靠 canvas 画的）。固定行距、首行缩进这类能还原；浮动锚定的印章
 * 位置、红头双线可能有偏差。它是**够用的近似**，不是所见即所得——真正的最终
 * 效果以下载下来的文件为准。
 */
export function DocxPreview({
  load,
  queryKey,
  enabled = true,
}: {
  /** 拉取要预览的文件。放成函数而不是 blob，是为了让打开弹窗时才请求。 */
  load: () => Promise<{ blob: Blob }>;
  queryKey: readonly unknown[];
  enabled?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [renderError, setRenderError] = useState<string>();

  const fileQuery = useQuery({
    queryKey,
    queryFn: load,
    enabled,
    // 预览是一次性动作，缓存住会让用户改完模板重开弹窗还看到旧内容。
    staleTime: 0,
    gcTime: 0,
    retry: false,
    // 但**不能**跟着窗口聚焦重拉：staleTime 为 0 时，用户每次切出去再切回来，
    // 预览就整个白屏重新渲染一遍。变量改了会因为 queryKey 变化而重拉，
    // 聚焦这条路径带不来任何新信息，只会闪。
    refetchOnWindowFocus: false,
  });

  const blob = fileQuery.data?.blob;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !blob) return;

    let cancelled = false;
    setRenderError(undefined);

    renderAsync(blob, container, undefined, {
      className: "docx",
      inWrapper: true,
      /**
       * ⚠️ 不要注入模板里嵌入的字体。
       *
       * 业务给的模板嵌的是**子集化**字体（每个 176–270 KB，完整中文字体是
       * 5–20 MB），只含原文档里出现过的那些字。docx-preview 会把它们注入成
       * `@font-face` 并声明 `unicode-range: U+0-10FFFF`——等于告诉浏览器
       * 「这套字体什么字都有」，于是遇到子集里没有的字（替换进去的人名，
       * 比如「佳」「耿」）浏览器**不回退**，直接画一个空的 .notdef：
       * 元素有正确宽度、颜色是黑的，但一个字形都没有。
       *
       * 关掉之后按字体名走系统字体（仿宋/黑体/楷体在中文 Windows 上都是
       * 自带的），没装的机器会回退到默认字体——观感略有出入，但**所有字都
       * 看得见**，比隐形的人名强得多。
       */
      ignoreFonts: true,
      // 让文档按自己的纸张尺寸排版，容器负责滚动——这份公函的页边距
      // （上下 2.54cm / 左右 3.17cm）本身就是版式的一部分，压掉就不像了。
      ignoreWidth: false,
      ignoreHeight: false,
      breakPages: true,
      renderHeaders: true,
      renderFooters: true,
    }).catch((error: unknown) => {
      if (cancelled) return;
      console.error("Failed to render docx preview", error);
      setRenderError("这份文件无法在页面内预览，可以下载后用 Word 打开查看");
    });

    return () => {
      cancelled = true;
      // docx-preview 是直接往容器里塞 DOM 的，不清掉会在重渲染时叠加一份。
      container.innerHTML = "";
    };
  }, [blob]);

  const message = renderError ?? (fileQuery.error as Error | null)?.message;

  return (
    <div className="relative max-h-[70vh] min-h-64 overflow-auto rounded-md border bg-muted/30 p-4">
      {/* 只在「还没有任何内容可看」时挡住。后台重拉时保留已渲染的文档，
          不要一有 fetch 就把用户正在看的东西撤掉。 */}
      {fileQuery.isPending ? (
        <div className="flex h-64 items-center justify-center gap-2 text-muted-foreground text-sm">
          <Loader2Icon className="size-4 animate-spin" />
          正在生成预览…
        </div>
      ) : null}

      {message ? (
        <div className="flex h-64 flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground text-sm">
          <AlertCircleIcon className="size-5 text-destructive" />
          {message}
        </div>
      ) : null}

      {/* 容器常驻。docx-preview 拿的是 ref，条件渲染会让它在首次渲染时拿到 null。 */}
      <div
        ref={containerRef}
        className={message || fileQuery.isPending ? "hidden" : undefined}
      />
    </div>
  );
}
