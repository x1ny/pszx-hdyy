/**
 * 生成活动行程分享链接用的短 token。
 *
 * 9 个随机字节编码后正好是 12 个 Base64URL 字符（72 bit 熵）：链接足够短，
 * 同时碰撞概率远低于业务规模。数据库唯一索引仍是最终的并发与碰撞兜底。
 */
export function createItineraryShareToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_");
}
