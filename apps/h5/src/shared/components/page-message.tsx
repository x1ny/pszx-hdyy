/**
 * 整屏居中的一句话 —— 404、加载失败这类"没有内容可渲染"的终局状态共用。
 *
 * 公众端的错误页不能写"Not Found"或者堆技术细节：看到它的是嘉宾，不是开发。
 * 每一条都得给出下一步能做什么，而这一端的下一步通常只有一个：找主办方。
 */
export function PageMessage({ title, hint }: { title: string; hint?: string }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col items-center justify-center px-8 text-center">
      <h1 className="font-bold text-[1.0625rem] text-ink-1 leading-6">
        {title}
      </h1>
      {hint && <p className="mt-1.5 text-body text-ink-3">{hint}</p>}
    </main>
  );
}
