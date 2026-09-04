# 基础镜像做成 ARG：构建机拉不到 Docker Hub 时，用
# --build-arg BUN_IMAGE=<私有仓库里的 bun 镜像> 一行换掉，不用改这个文件。
ARG BUN_IMAGE=oven/bun:1.3-alpine

# ---------- 构建阶段 ----------
FROM ${BUN_IMAGE} AS builder
WORKDIR /app

# 依赖统一走这个源。不设的话，bun.lock 里没有显式 URL 的那些条目会去
# registry.npmjs.org 拉 —— 国内网络下经常中途断流，拿到截断的 tarball，报成
# `Integrity check failed for tarball: <包名>`，看着像锁文件坏了，其实是网络。
# （npmjs 和 npmmirror 对同一个版本给的 integrity 是一致的，换源不影响校验。）
# 换别的源：--build-arg NPM_REGISTRY=<url>，或给 build-push.ts 设 NPM_REGISTRY 环境变量。
ARG NPM_REGISTRY=https://registry.npmmirror.com
ENV BUN_CONFIG_REGISTRY=${NPM_REGISTRY}

# 先只拷 manifest 再装依赖，源码改动就不会让这一层的缓存失效。
# --linker=hoisted 是刻意的：isolated 会在 node_modules/.bun 下铺一片符号链接，
# 依赖结构对跨 stage 的 COPY 不友好。
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/h5/package.json apps/h5/
# 根 package.json 的 postinstall 会跑这个脚本，而这一层还没到 `COPY . .`，
# 不单独拷进来的话 bun install 直接报 "Module not found"。它在镜像里是空操作：
# 容器里既没有 .git 也没有 git 二进制，脚本会自行短路退出。
# 单独拷一个文件而不是整个 scripts/：这一层的缓存只在它自己变动时才失效。
COPY scripts/setup-git.ts scripts/
RUN bun install --frozen-lockfile --linker=hoisted

COPY . .

# 产出三样东西：apps/web/dist 和 apps/h5/dist（两份静态资源）+
# apps/server/dist/server.js（bun build 打的单文件，依赖全部内联）。
#
# 后者是运行阶段能完全不带 node_modules 的原因。别想着用
# `bun install --production` 代替 —— 在 workspace 根它只跳过根 package.json 的
# devDependencies，不会递归排除各工作区的，实测仍会把 vite / vitest /
# better-sqlite3 装进来，234MB 起步。
RUN bun run build

# ---------- 运行阶段 ----------
FROM ${BUN_IMAGE} AS runtime

# 监听 80 需要 root；官方 oven/bun 镜像可能已切到 bun 用户，显式写回来。
USER root
WORKDIR /app

# alpine 不自带时区库。基础镜像换成非 alpine 的话，这一层要跟着改。
RUN apk add --no-cache tzdata \
    && ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
    && echo "Asia/Shanghai" > /etc/timezone

# 两个 *_DIST_DIR 一设上，apps/server 就在同一个 Hono 里托管这两份静态产物，
# 各占一个端口：80 是管理端，81 是 h5（见 apps/server/src/index.ts）。两个端口
# 都提供完整的 /api，所以两端各自同源，不需要 CORS。
# 开发环境两个都不设，静态资源仍归 Vite。
ENV NODE_ENV=production \
    TZ=Asia/Shanghai \
    SERVER_PORT=80 \
    WEB_DIST_DIR=/app/web \
    H5_PORT=81 \
    H5_DIST_DIR=/app/h5 \
    FILE_STORAGE_DIR=/app/data/files \
    MIGRATIONS_DIR=/app/drizzle

COPY --from=builder /app/apps/server/dist/server.js ./server.js
# 迁移入口和迁移 SQL。entrypoint 在启动应用前跑一次（见 docs/database-migrations.md）。
# migrate.js 只内联了 drizzle-orm 的 migrator 和 pg —— **drizzle-kit 不进镜像**，
# 运行阶段仍然零 node_modules。
COPY --from=builder /app/apps/server/dist/migrate.js ./migrate.js
COPY --from=builder /app/apps/server/drizzle ./drizzle
COPY --from=builder /app/apps/web/dist ./web
COPY --from=builder /app/apps/h5/dist ./h5
COPY docker/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh && mkdir -p "$FILE_STORAGE_DIR"

EXPOSE 80 81
ENTRYPOINT ["/docker-entrypoint.sh"]
