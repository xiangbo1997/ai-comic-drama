# 部署与运维

本目录存放生产部署所需的脚本与 systemd unit。生产环境事实：

| 项目     | 现状                                                                  |
| -------- | --------------------------------------------------------------------- |
| 进程     | 单个 `next start -p 3100`，由 systemd 管（`ai-comic-drama.service`）  |
| 运行时   | Node 22，服务器上 pnpm 11（本地 `packageManager` 钉 pnpm 10.28.1）    |
| 代码目录 | `/software/ai-comic-drama`（服务器上**没有 git**，代码靠 rsync 同步） |
| 数据库   | Docker 容器 `comic-postgres`，监听 127.0.0.1:5432                     |
| 存储     | 生产已配 R2；`public/uploads` 里还有历史遗留文件                      |
| 部署方式 | 开发机执行 `deploy.sh`（rsync + 远端构建重启 + 健康检查）             |

## 文件清单

| 文件                     | 用途                                                    |
| ------------------------ | ------------------------------------------------------- |
| `ai-comic-drama.service` | systemd unit，与服务器上现行版本逐字一致                |
| `deploy.sh`              | 在**开发机**执行：同步代码 → 远端重建 → 重启 → 健康检查 |
| `backup.sh`              | 在**服务器**上由 cron 执行：备份数据库与上传目录        |

## 部署

在仓库根目录（开发机）执行：

```bash
# 常规部署（未改 prisma/schema.prisma）
bash app/deploy/deploy.sh

# 改了 schema.prisma —— 必须带上，否则新字段/索引不会同步到数据库
SCHEMA_CHANGED=1 bash app/deploy/deploy.sh

# 只想看会传哪些文件，不实际改动服务器
DRY_RUN=1 bash app/deploy/deploy.sh
```

脚本做的事：

0. 把本机 `git rev-parse --short HEAD` 写进 `app/.git-commit`（工作区有未提交改动
   则带 `-dirty` 后缀），随代码一起推送；服务器上没有 git，这是 `/api/health`
   能报出版本号的唯一来源。该文件被 `.gitignore` 忽略，不进版本库。
1. `rsync -az --delete` 推送仓库（排除 `node_modules`、`.next`、`public/uploads`、`.env*` 等）
2. 远端 `pnpm install --frozen-lockfile`
3. `SCHEMA_CHANGED=1` 时 `npx prisma db push`（本服务器无 migrate 历史，用 db push 部署）
4. `pnpm db:generate` → `pnpm build`
5. `systemctl restart ai-comic-drama.service`
6. 轮询 `http://127.0.0.1:3100/api/health`，60s 内不健康即退出码非 0

> `.env.local` 只在服务器上维护（含生产密钥），rsync 明确排除，不会被开发机覆盖。
> `public/uploads` 同样排除，避免 `--delete` 删掉用户产物。

### 首次安装 systemd unit

```bash
scp app/deploy/ai-comic-drama.service team-register-server:/etc/systemd/system/
ssh team-register-server 'systemctl daemon-reload && systemctl enable --now ai-comic-drama.service'
```

### 健康检查

```bash
ssh team-register-server 'curl -fsS http://127.0.0.1:3100/api/health'
# {"ok":true,"uptime":123.4,"commit":"723cf38"}
```

`GET /api/health` 真跑一次 `SELECT 1`，数据库不通返回 503。

`commit` 字段的取值顺序（见 `src/lib/env.ts` 的 `getRuntimeEnv()`）：

1. 环境变量 `GIT_COMMIT`（若在 systemd unit 里显式注入则优先）
2. `app/.git-commit` 文件（由 `deploy.sh` 在 rsync 前写入，**常规路径走这条**）
3. 都没有 → `null`

所以部署完 curl 一次健康检查，看到的短 SHA 与本地 `git rev-parse --short HEAD`
一致，就能确认「重启后跑的确实是新代码」。若显示 `null`，说明这次不是用
`deploy.sh` 部署的（或部署机不是 git 工作区）；若带 `-dirty` 后缀，说明部署时
开发机工作区有未提交改动，线上代码与该 commit 并不完全一致。

## 回滚

服务器上没有 git，回滚 = **在旧版本代码上重跑一次 `deploy.sh`**：

```bash
git checkout <上一个可用的 tag 或 commit>
bash app/deploy/deploy.sh          # 改过 schema 则加 SCHEMA_CHANGED=1
git checkout main                  # 回滚完把本地切回来
```

⚠️ 数据库回滚不是自动的。若上一次部署做了 `db push` 且删了字段，回滚代码不会
恢复数据，需从备份恢复（见下）。所以**破坏性 schema 变更前先手动跑一次 `backup.sh`**。

## 备份

服务器上没有任何自动备份时，先装：

```bash
ssh team-register-server 'mkdir -p /backup'
```

crontab（`crontab -e`）：

```cron
# 每天 03:30 备份数据库与上传目录，保留 14 天
30 3 * * * bash /software/ai-comic-drama/app/deploy/backup.sh >> /var/log/ai-comic-backup.log 2>&1

# 每小时清理过期任务/订单/僵尸状态（已有）
0 * * * * curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" http://127.0.0.1:3100/api/admin/cleanup >> /var/log/ai-comic-cleanup.log 2>&1
```

`backup.sh` 从 `.env.local` 的 `DATABASE_URL` 解析用户名与库名，
经 `docker exec comic-postgres pg_dump` 导出，产物：

- `/backup/db-YYYY-MM-DD.sql.gz`
- `/backup/uploads-YYYY-MM-DD.tar.gz`

### 恢复

```bash
gunzip -c /backup/db-2026-09-08.sql.gz | docker exec -i comic-postgres psql -U <user> <dbname>
tar -xzf /backup/uploads-2026-09-08.tar.gz -C /software/ai-comic-drama/app/public/
```

## 定时清理

`POST /api/admin/cleanup` 已由每小时 cron 调用（请求头 `x-cron-secret` 对应
`.env.local` 里的 `CRON_SECRET`）。它负责：删除 30 天前终结的生成任务与
workflow、把 24h 未支付订单置 EXPIRED、回收超时僵尸任务，以及裁剪分镜历史
版本（每分镜保留最近 20 条 `GenerationAttempt` 并删除其存储文件）。

## 常见排查

```bash
ssh team-register-server 'systemctl status ai-comic-drama.service'
ssh team-register-server 'journalctl -u ai-comic-drama -n 200 --no-pager'
ssh team-register-server 'docker ps --filter name=comic-postgres'
```

启动时若日志里出现 `启动配置校验失败 — XXX`，说明 `.env.local` 里必填变量缺失
或格式错（`DATABASE_URL` / `NEXTAUTH_SECRET` / `ENCRYPTION_KEY`），生产下进程会
直接退出，systemd 会按 `Restart=on-failure` 反复重启——先看日志改配置，别盯着重启计数。
