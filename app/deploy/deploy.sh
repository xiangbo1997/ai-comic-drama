#!/usr/bin/env bash
#
# 部署脚本（在开发机执行，rsync 推代码到服务器 + 远端重建重启 + 健康检查）
#
# 服务器上没有 git，代码靠 rsync 同步；故「回滚」= 在旧版本代码上重跑本脚本
# （见 deploy/README.md）。脚本幂等：重复执行等价于再部署一次同样的代码。
#
# 用法：
#   bash app/deploy/deploy.sh              # 常规部署（不动数据库结构）
#   SCHEMA_CHANGED=1 bash app/deploy/deploy.sh   # 本次改了 schema.prisma
#   DRY_RUN=1 bash app/deploy/deploy.sh     # 只看 rsync 会传哪些文件，不实际改动
#
# 前置：本机 ssh 配置里有 team-register-server 别名（含端口），且免密登录可用。

set -euo pipefail

REMOTE="${REMOTE:-team-register-server}"
REMOTE_DIR="${REMOTE_DIR:-/software/ai-comic-drama}"
SERVICE="${SERVICE:-ai-comic-drama.service}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3100/api/health}"
HEALTH_TIMEOUT_SEC="${HEALTH_TIMEOUT_SEC:-60}"
SCHEMA_CHANGED="${SCHEMA_CHANGED:-0}"
DRY_RUN="${DRY_RUN:-0}"

# 仓库根目录（本脚本位于 <repo>/app/deploy/）
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# 排除项说明：
# - node_modules / .next 远端自己装自己构建（跨平台二进制不可搬）
# - public/uploads 是服务器上的用户产物，传过去会覆盖/删档
# - .env* 只在服务器上维护（含生产密钥，绝不从开发机推送）
EXCLUDES=(
  --exclude ".git"
  --exclude "node_modules"
  --exclude ".next"
  --exclude "public/uploads"
  --exclude ".env"
  --exclude ".env.*"
  --exclude "tsconfig.tsbuildinfo"
  --exclude ".playwright-mcp"
  --exclude "test-results"
  --exclude "coverage"
  --exclude ".codegraph"
  --exclude ".ace-tool"
  --exclude ".claude"
  --exclude "._*"
  --exclude ".DS_Store"
)

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m!! %s\033[0m\n' "$*" >&2; exit 1; }

# 写入本次部署的 commit，供 /api/health 回报「跑的到底是不是新代码」。
# 服务器上没有 git，拿不到 rev-parse；systemd unit 也没注入 GIT_COMMIT，
# 故在开发机侧算好写文件、随 rsync 一起推过去（lib/env.ts 读它兜底）。
# 注意：该文件不在 EXCLUDES 里，且 .gitignore 忽略它（部署产物不进版本库）。
GIT_COMMIT_FILE="${REPO_ROOT}/app/.git-commit"
if commit=$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null); then
  # 工作区有未提交改动时标记 -dirty，避免 health 报的版本与实际代码不符
  if ! git -C "$REPO_ROOT" diff --quiet HEAD 2>/dev/null; then
    commit="${commit}-dirty"
  fi
  printf '%s\n' "$commit" > "$GIT_COMMIT_FILE"
  log "本次部署版本：${commit}（已写入 app/.git-commit）"
else
  # 非 git 环境（如从 tar 包部署）：删掉旧文件，避免推送过期版本号误导排查
  rm -f "$GIT_COMMIT_FILE"
  log "非 git 工作区，跳过 commit 版本注入（/api/health 的 commit 将为 null）"
fi

log "同步代码到 ${REMOTE}:${REMOTE_DIR}"
RSYNC_FLAGS=(-az --delete --human-readable)
if [ "$DRY_RUN" = "1" ]; then
  RSYNC_FLAGS+=(--dry-run --verbose)
fi
rsync "${RSYNC_FLAGS[@]}" "${EXCLUDES[@]}" \
  "${REPO_ROOT}/" "${REMOTE}:${REMOTE_DIR}/"

if [ "$DRY_RUN" = "1" ]; then
  log "DRY_RUN=1，仅同步预演，未在远端执行任何命令"
  exit 0
fi

log "远端安装依赖 / 构建 / 重启（SCHEMA_CHANGED=${SCHEMA_CHANGED}）"
ssh "$REMOTE" \
  REMOTE_DIR="$REMOTE_DIR" \
  SERVICE="$SERVICE" \
  SCHEMA_CHANGED="$SCHEMA_CHANGED" \
  'bash -seuo pipefail' <<'REMOTE_SCRIPT'
cd "${REMOTE_DIR}/app"

echo "--- pnpm install"
pnpm install --frozen-lockfile

if [ "$SCHEMA_CHANGED" = "1" ]; then
  echo "--- prisma db push（schema 有变更）"
  # 服务器用 db push 部署（无 migrate 历史）
  npx prisma db push
fi

echo "--- prisma generate"
pnpm db:generate

echo "--- next build"
pnpm build

echo "--- restart ${SERVICE}"
systemctl restart "${SERVICE}"
REMOTE_SCRIPT

log "健康检查（最多 ${HEALTH_TIMEOUT_SEC}s）：${HEALTH_URL}"
# 服务只监听 127.0.0.1，健康检查必须在服务器上发起
if ssh "$REMOTE" \
  HEALTH_URL="$HEALTH_URL" \
  HEALTH_TIMEOUT_SEC="$HEALTH_TIMEOUT_SEC" \
  'bash -seuo pipefail' <<'HEALTH_SCRIPT'
deadline=$(( $(date +%s) + HEALTH_TIMEOUT_SEC ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  if body=$(curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null); then
    echo "$body"
    exit 0
  fi
  sleep 2
done
exit 1
HEALTH_SCRIPT
then
  log "部署成功，服务健康"
else
  fail "健康检查未通过：${HEALTH_URL} 在 ${HEALTH_TIMEOUT_SEC}s 内未返回 200。排查：ssh ${REMOTE} journalctl -u ${SERVICE} -n 100 --no-pager"
fi
