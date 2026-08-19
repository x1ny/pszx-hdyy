import { DocxScrollViewer } from "@silurus/ooxml/docx";
import { useQuery } from "@tanstack/react-query";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { AlertCircleIcon, Loader2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "#/shared/lib/utils";

const embeddedFontTag =
  /<(?:\w+:)?embed(?:Regular|Bold|Italic|BoldItalic)\b[^>]*\/>/g;
const paragraphTag = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
const paragraphPropertiesTag = /<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/;
const runTag = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
const textTag = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
const singleUnderlineTag = /<w:u\b[^>]*w:val=["']single["'][^>]*\/>/;
const redColorTag = /<w:color\b[^>]*w:val=["']FF0000["'][^>]*\/>/i;
const fontSizeTag = /<w:sz\b[^>]*w:val=["'](\d+)["'][^>]*\/>/g;
const spacingTag = /<w:spacing\b[^>]*\/>/;
const exactLineRuleAttribute = /w:lineRule=["']exact["']/;
const lineHeightAttribute = /w:line=["'](\d+)["']/;

/**
 * WPS/Word 会把“整段红色下划线空格”按两端对齐拉伸到正文宽度；
 * @silurus/ooxml 目前按普通空格宽度排版，字号较大的那一段会换行，多画一截。
 * 对这种纯装饰段落，等价地改成段落底边框：宽度、上下间距仍由原段落决定，
 * 同时不会再受空格度量和换行实现影响。
 */
function normalizeUnderlinedWhitespaceRules(documentXml: string) {
  return documentXml.replace(paragraphTag, (paragraph) => {
    const textMatches = [...paragraph.matchAll(textTag)];
    const spacing = paragraph.match(spacingTag)?.[0];
    const lineHeight = Number(spacing?.match(lineHeightAttribute)?.[1]);
    if (
      textMatches.length === 0 ||
      textMatches.some((match) => !/^\s*$/.test(match[1] ?? "")) ||
      !singleUnderlineTag.test(paragraph) ||
      !redColorTag.test(paragraph) ||
      !spacing ||
      !exactLineRuleAttribute.test(spacing) ||
      !Number.isFinite(lineHeight) ||
      lineHeight > 100
    ) {
      return paragraph;
    }

    const explicitFontSizes = [...paragraph.matchAll(fontSizeTag)].map((match) =>
      Number(match[1]),
    );
    const largestFontSize = Math.max(0, ...explicitFontSizes);
    // w:sz 是半磅，边框 w:sz 是八分之一磅。大字号下划线约为字号的 1/20；
    // 普通字号使用 Word 的最细 0.5pt 线，正好对应模板的“上粗下细”。
    const borderSize =
      largestFontSize >= 40 ? Math.ceil(largestFontSize / 5) : 4;
    const border = `<w:pBdr><w:bottom w:val="single" w:sz="${borderSize}" w:space="0" w:color="FF0000"/></w:pBdr>`;
    const properties = paragraph.match(paragraphPropertiesTag)?.[0];
    if (!properties) return paragraph;

    const borderedProperties = properties.replace(
      "</w:pPr>",
      `${border}</w:pPr>`,
    );
    return paragraph
      .replace(properties, borderedProperties)
      .replace(runTag, (run) => {
        const texts = [...run.matchAll(textTag)];
        return texts.length > 0 &&
          texts.every((match) => /^\s*$/.test(match[1] ?? ""))
          ? ""
          : run;
      });
  });
}

/**
 * 只调整内存里的预览副本，不改服务端文件和下载内容。
 *
 * 业务模板嵌入的是子集字体，只包含模板原有字符。占位符替换出来的人名等字符
 * 可能不在子集中，Canvas 会把它们画成空字形。保留字体名称和所有排版信息，
 * 仅去掉 fontTable 里的 embed 标签，可让渲染器改用本机同名字体或系统回退字体。
 * 同时把上面的纯装饰下划线归一化为等价边框，规避空格换行差异。
 */
function prepareDocxPreviewSource(source: ArrayBuffer) {
  const files = unzipSync(new Uint8Array(source));
  let changed = false;

  const fontTable = files["word/fontTable.xml"];
  if (fontTable) {
    const xml = strFromU8(fontTable);
    const sanitizedXml = xml.replace(embeddedFontTag, "");
    if (sanitizedXml !== xml) {
      files["word/fontTable.xml"] = strToU8(sanitizedXml);
      changed = true;
    }
  }

  const document = files["word/document.xml"];
  if (document) {
    const xml = strFromU8(document);
    const normalizedXml = normalizeUnderlinedWhitespaceRules(xml);
    if (normalizedXml !== xml) {
      files["word/document.xml"] = strToU8(normalizedXml);
      changed = true;
    }
  }

  return changed ? Uint8Array.from(zipSync(files, { level: 1 })).buffer : source;
}

/**
 * 在页面里渲染一份真实的 .docx。
 *
 * **渲染源是服务端产出的那个文件本身，不是数据。** 上一版的预览是前端用 React
 * 照着数据另画一个版面，两套版面代码必然漂移——真实案例：附则在 HTML 预览里排
 * 在落款之后，在导出的 Word 里却排在联系人之前，没人发现。现在版式只存在于
 * docx 模板文件里，前端无从近似，也就没有漂移的余地。
 *
 * @silurus/ooxml 直接解析 OOXML，并按分页结果绘制到 Canvas，不再把 Word 结构
 * 转成 HTML/CSS 后让浏览器重新排版。它仍然依赖客户端可用字体，所以没有安装
 * 模板字体的设备可能出现字形差异；最终归档内容始终以下载的原始文件为准。
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
  const [renderState, setRenderState] = useState<{
    blob?: Blob;
    status: "idle" | "loading" | "ready" | "error";
    message?: string;
  }>({ status: "idle" });

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
    let viewer: DocxScrollViewer | undefined;

    const handleRenderError = (error: unknown) => {
      if (cancelled) return;
      console.error("Failed to render docx preview", error);
      setRenderState({
        blob,
        status: "error",
        message: "这份文件无法在页面内预览，可以下载后用 Word 打开查看",
      });
    };

    setRenderState({ blob, status: "loading" });

    const render = async () => {
      try {
        viewer = new DocxScrollViewer(container, {
          // 邀请函通常只有几页。主线程模式直接使用浏览器字体度量，优先保证版式；
          // Canvas 仅负责只读绘制，不开启文本/对象选择或链接交互。
          mode: "main",
          useGoogleFonts: false,
          enableTextSelection: false,
          enableElementSelection: false,
          enableHyperlinks: false,
          background: "transparent",
          gap: 16,
          paddingTop: 16,
          paddingBottom: 16,
          paddingLeft: 16,
          paddingRight: 16,
          onError: handleRenderError,
        });

        const source = prepareDocxPreviewSource(await blob.arrayBuffer());
        if (cancelled) return;

        await viewer.load(source);
        if (!cancelled) setRenderState({ blob, status: "ready" });
      } catch (error) {
        handleRenderError(error);
      }
    };

    void render();

    return () => {
      cancelled = true;
      // 释放画布、ResizeObserver、字体和解析器持有的 WASM/文档资源。
      viewer?.destroy();
    };
  }, [blob]);

  const renderError =
    renderState.blob === blob && renderState.status === "error"
      ? renderState.message
      : undefined;
  let queryError: string | undefined;
  if (fileQuery.error instanceof Error) queryError = fileQuery.error.message;
  else if (fileQuery.error) queryError = String(fileQuery.error);
  const message = renderError ?? queryError;
  const isRendering =
    !!blob &&
    (renderState.blob !== blob || renderState.status === "loading");
  const isLoading = fileQuery.isPending || isRendering;

  return (
    <div className="relative h-[70vh] max-h-[50rem] min-h-64 overflow-hidden rounded-md border bg-muted/30">
      {/* 只在「还没有任何内容可看」时挡住。后台重拉时保留已渲染的文档，
          不要一有 fetch 就把用户正在看的东西撤掉。 */}
      {isLoading ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-muted/30 text-muted-foreground text-sm">
          <Loader2Icon className="size-4 animate-spin" />
          {fileQuery.isPending ? "正在生成预览…" : "正在渲染文档…"}
        </div>
      ) : null}

      {message ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground text-sm">
          <AlertCircleIcon className="size-5 text-destructive" />
          {message}
        </div>
      ) : null}

      {/* 容器常驻并保留尺寸；display:none 会让滚动预览器按 0 宽度布局。 */}
      <div
        ref={containerRef}
        className={cn("size-full", (message || isLoading) && "invisible")}
      />
    </div>
  );
}
