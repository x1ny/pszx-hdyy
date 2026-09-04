/**
 * 把 `modules/<名>/schema.ts` 导出的表汇成一个对象，喂给 drizzle-kit 的
 * `pushSchema` / `generateDrizzleJson`。
 *
 * Glob 而不是一个个手写 import：新增 `modules/<名>/schema.ts` 不用动这里，
 * 和 drizzle.config.ts 里 `schema` 那条 glob 是同一个理由。
 *
 * **放在 `src/` 根而不是 `infra/`**：它 import 所有 `modules/*\/schema.ts`，
 * 放进 `infra/` 就把依赖方向倒过来了（AGENTS.md「代码结构」：infra 不许认识
 * modules）。`src/` 根是组合根，`index.ts` 和 `client-type.ts` 本来就认识 modules。
 *
 * 只被开发和运维工具用（dev-seed / schema-check / 漂移测试），**不在
 * `migrate.ts` 的 import 链上** —— 那条链必须干净到不含 drizzle-kit，
 * 否则打进镜像的 `migrate.js` 会把整个 kit 拖进去。
 */
export async function buildSchema() {
  const glob = new Bun.Glob("*/schema.ts");
  const modulesDir = new URL("./modules/", import.meta.url);
  const schema: Record<string, unknown> = {};

  for await (const relativePath of glob.scan({
    cwd: Bun.fileURLToPath(modulesDir),
  })) {
    const moduleUrl = new URL(relativePath.replaceAll("\\", "/"), modulesDir);
    for (const [name, value] of Object.entries(await import(moduleUrl.href))) {
      schema[name] = value;
    }
  }

  return schema;
}
