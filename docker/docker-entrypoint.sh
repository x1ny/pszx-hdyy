#!/bin/sh
set -eu

# 容器里没有 .env —— apps/server 的 `start` 脚本那套 --env-file=../../.env
# 在这里不适用，配置一律来自真实环境变量。

require() {
  # 内层引号不能省：连接串里但凡有空格或 shell 元字符，不加引号的 eval
  # 会把它们当成命令跑起来。
  eval "value=\"\${$1:-}\""
  if [ -z "$value" ]; then
    echo "Error: $1 is required" >&2
    exit 1
  fi
}

require DATABASE_URL
require BETTER_AUTH_SECRET

# APP_URL 是**管理端**的地址。管理端和它的 API 在同一个端口上，浏览器只看得到
# 一个 origin，所以 Better Auth 要的两个变量其实永远相等 —— 给一个 APP_URL 让
# 它们派生出来，少两个能配错的地方。
#
# h5 不在这里配：它跑在另一个端口、另一个域名下，同样和自己的 API 同源，前端直接
# 用 window.location.origin。等 h5 那套手机号身份接进来、需要签 Cookie 的域时，
# 再在这里加 H5_URL。
if [ -n "${APP_URL:-}" ]; then
  export BETTER_AUTH_URL="${BETTER_AUTH_URL:-$APP_URL}"
  export WEB_ORIGIN="${WEB_ORIGIN:-$APP_URL}"
fi

require BETTER_AUTH_URL
require WEB_ORIGIN

FILE_STORAGE_DIR="${FILE_STORAGE_DIR:-/app/data/files}"
export FILE_STORAGE_DIR
mkdir -p "$FILE_STORAGE_DIR"

# DATABASE_URL 带密码，打日志前抹掉。纯参数展开，不依赖 sed —— busybox 的
# `sed -E` 是较新版本才有的，不值得为一行日志赌基础镜像里 sed 的版本。
case "$DATABASE_URL" in
  *://*@*) safe_database_url="${DATABASE_URL%%://*}://***@${DATABASE_URL##*@}" ;;
  *) safe_database_url="$DATABASE_URL" ;;
esac

echo "pszx-hdyy starting"
echo "  BETTER_AUTH_URL:  $BETTER_AUTH_URL"
echo "  WEB_ORIGIN:       $WEB_ORIGIN"
echo "  SESSION_EXPIRES:  ${BETTER_AUTH_SESSION_EXPIRES_IN_SECONDS:-604800}s"
echo "  SERVER_PORT:      ${SERVER_PORT:-80}"
echo "  WEB_DIST_DIR:     ${WEB_DIST_DIR:-(unset, 不托管前端)}"
echo "  H5_PORT:          ${H5_PORT:-8788}"
echo "  H5_DIST_DIR:      ${H5_DIST_DIR:-(unset, 不起 h5 端口)}"
echo "  FILE_STORAGE_DIR: $FILE_STORAGE_DIR"
echo "  DATABASE_URL:     $safe_database_url"

# 数据库迁移不在这里做，是有意的：schema 变更由人在部署前执行
# （bun run db:push），理由见 docker/README.md。

exec bun run /app/server.js
