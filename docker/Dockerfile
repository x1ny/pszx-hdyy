# 基础镜像做成 ARG：构建机拉不到 Docker Hub 时，用
# --build-arg BUN_IMAGE=<私有仓库里的 bun 镜像> 一行换掉，不用改这个文件。
ARG BUN_IMAGE=oven/bun:1.3-alpine

# ---------- 构建阶段 ----------
FROM ${BUN_IMAGE} AS builder
WORKDIR /app

# ARG NPM_REGISTRY=https://registry.npmmirror.com
# ENV BUN_CONFIG_REGISTRY=${NPM_REGISTRY}

# 先只拷 manifest 再装依赖，源码改动就不会让这一层的缓存失效。
# --linker=hoisted 是刻意的：isolated 会在 node_modules/.bun 下铺一片符号链接，
# 依赖结构对跨 stage 的 COPY 不友好。
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
# 根 package.json 的 postinstall 会跑这个脚本，而这一层还没到 `COPY . .`，
# 不单独拷进来的话 bun install 直接报 "Module not found"。它在镜像里是空操作：
# 容器里既没有 .git 也没有 git 二进制，脚本会自行短路退出。
# 单独拷一个文件而不是整个 scripts/：这一层的缓存只在它自己变动时才失效。
COPY scripts/setup-git.ts scripts/
RUN bun install --frozen-lockfile --linker=hoisted

COPY . .

# 产出两样东西：apps/web/dist（静态资源）和 apps/server/dist/server.js
# （bun build 打的单文件，依赖全部内联）。
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

# WEB_DIST_DIR 一设上，apps/server 就会在同一个 Hono 里托管 web 的静态产物
# （见 apps/server/src/index.ts）。开发环境不设这个变量，静态资源仍归 Vite。
ENV NODE_ENV=production \
    TZ=Asia/Shanghai \
    SERVER_PORT=80 \
    WEB_DIST_DIR=/app/web \
    FILE_STORAGE_DIR=/app/data/files

COPY --from=builder /app/apps/server/dist/server.js ./server.js
COPY --from=builder /app/apps/web/dist ./web
COPY docker/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh && mkdir -p "$FILE_STORAGE_DIR"

EXPOSE 80
ENTRYPOINT ["/docker-entrypoint.sh"]
