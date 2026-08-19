/**
 * 构造 Content-Disposition。
 *
 * 两段是必须的：`filename=` 只能放 ASCII，中文文件名要靠 RFC 5987 的
 * `filename*=UTF-8''` 那段才传得过去；老浏览器只认前者，所以两段都给。
 *
 * 换行和引号必须先剔除——它们能把响应头截断成两个头（HTTP 响应拆分）。
 */
export function contentDisposition(name: string, download: boolean) {
  const safeName =
    name.replace(/[\r\n"]/g, "_").replace(/[^\u0020-\u007e]/g, "_") || "file";

  return `${download ? "attachment" : "inline"}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
