/**
 * 浏览器端 AK 最终必须下发到浏览器，它不是服务端密钥；这里仅把来源从构建产物
 * 改为运行中的服务进程。部署平台更新变量并重启工作负载后，新的请求就会读到新值。
 */
export function getBaiduMapAk() {
  return process.env.BAIDU_MAP_AK?.trim() ?? "";
}
