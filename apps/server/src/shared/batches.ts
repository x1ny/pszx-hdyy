/** 分批构造 SQL 参数，避免单条语句超出数据库参数数量限制；不限制业务总量。 */
export function* batches<T>(items: readonly T[]): Generator<T[]> {
  for (let offset = 0; offset < items.length; offset += 1000) {
    yield items.slice(offset, offset + 1000);
  }
}
