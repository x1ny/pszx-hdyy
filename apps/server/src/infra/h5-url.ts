/**
 * H5 的对外访问地址。
 *
 * 这是运行时配置而不是 `VITE_*` 构建变量：同一个管理端镜像可以部署到不同环境，
 * 分享链接仍会指向该环境真正的 H5 域名。H5 自身调 API 仍走同源，和这里无关。
 */
export function getH5BaseUrl(): URL {
  const raw = process.env.H5_URL?.trim();
  if (!raw) {
    throw new Error("H5_URL is not configured");
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      `H5_URL must be an absolute URL, got ${JSON.stringify(raw)}`,
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`H5_URL must use http or https, got ${url.protocol}`);
  }

  return url;
}
