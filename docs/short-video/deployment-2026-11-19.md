# L1 生产部署记录 — 2026-11-19

用户明确要求“重新部署上线”，并指示继续。已部署应用提交 **eef0e0f**，入口 **https://comic.cloudsentryai.com/short-videos**。仅当前管理员/超管及服务端allowlist可访问；新付费生成和AUTO发布提交保持关闭。三平台自动连接器仍为BLOCKED，未把人工路径写成自动接通。

## 已执行操作

- 原Web为880bdcf、PID2198391。工作区无用户未提交改动；保留.env、素材、旧.next、版本标记及服务配置。
- 生产Prisma有6份已完成迁移，其校验和全部与仓库一致；仅`20261119000000_add_short_video`待应用。核对原表字段及关联，新增表不存在。部署前、停止前及停止后均确认无PENDING/PROCESSING生成、running/stopping助手执行或活跃回复租约。
- 创建数据库自定义格式备份、schema、上传目录压缩包和旧构建副本。将生产备份仅恢复至专用测试容器的`ai_comic_verify_sv_restore_20261119`，用户/项目/分镜/积分流水/模型配置五类数量一致；没有在生产运行测试、reset、db push。恢复验证后删除该临时恢复库并停止专用测试容器。
- 以生产环境配置在独立副本构建，不覆盖在线.next；586份源文件SHA核对一致，Next完整构建及TypeScript通过。21首内置MP3、助手技能追踪文件保留；构建后删除临时生产.env副本。运行依赖无升级、未重建锁文件。
- 执行`prisma migrate deploy`，仅应用上述新增迁移；15张Sv表就绪，迁移收据及SQL校验和匹配。原User/Project/Scene/CreditTransaction/UserAIConfig数量仍为1/9/201/243/7。
- 新增短视频开关：`SHORT_VIDEO_ENABLED=true`，`SHORT_VIDEO_AUTO_SUBMIT_ENABLED=false`，allowlist为空，管理员角色可访问。原环境14个已有键值全部不变；原加密/模型/存储密钥未替换。
- 保持原systemd Web运行用户、目录及资源上限，切换新.next及版本标记，安装并启用唯一的`ai-comic-short-video-worker.service`。worker的ExecStartPre执行只读数据库/FFmpeg/ffprobe检查。
- 仅comic站点短视频上传路径`/api/short-videos/videos/*/artifacts/upload`放宽Caddy请求体到210MB（应用文件上限仍200MiB），其余请求继续50MB，原10分钟代理读取超时不变。Caddy配置验证及reload成功，未重启其他应用。
- 保留9个旧静态资源，随后在无在途任务时刷新Web静态文件快照，验证旧构建manifest和新JS资源均可访问，避免已打开页面所需旧资源立即失效。

## 上线验证

- 内网`http://127.0.0.1:3100/api/health`及公网`https://comic.cloudsentryai.com/api/health`均HTTP200，`ok=true`、`commit=eef0e0f`。
- 44项内外网检查全部通过：只读管理员运维会话、capabilities、作品/来源/账号/发布列表、worker心跳、新页面与导航、原项目/模型配置页面、新JS资产及匿名拒绝。运维会话仅内存签发、有效5分钟，不创建生产用户、不改密码、不调用业务写入或模型；没有把它声称为真实密码登录测试。
- 21首音乐逐一内网与公网Range206，另旧JS资源公网200且SHA一致，共43项素材检查通过。首次Python默认UA被公网403拒绝，使用常见浏览器UA后可访问；旧静态资源在Web启动后才复制时404，静态快照刷新后200。
- 生产核心数据数量未变；SvRun/SvPublication/SvSource均0。worker心跳持续更新，Web和worker均active/running，NRestarts=0。新调用日志检查未发现错误。
- 沿用开发交付证据：2549项单元、74项隔离数据库、5项浏览器验收及真实隔离HTTP人工链路，未在生产重复测试。

## 回滚与证据

长期回滚目录：`/backup/short-video-deploy-20261119T112715Z`（仅root可读）。包含：

- `database.dump`、`schema.sql`、`restore-verification.json`、`uploads.tar.gz`；
- `previous.live.next`、独立旧构建副本、`previous.git-commit`、`previous.env.local`、Web服务及Caddy原配置；
- 构建/迁移/上线日志、源码SHA清单、44项业务检查和43项素材检查、最终服务状态；
- `rollback.py`（语法已检查、未执行）。先核对在途/未知外部请求，再停止并禁用新worker、停止Web、恢复旧构建/原env/版本及Caddy、启动旧Web并校验健康。脚本拒绝覆盖后续已经变化的Caddy配置。新增表及短视频数据保留，不执行down SQL或整库恢复。

数据库备份已做独立恢复验证，不意味着现在需要恢复生产。应用自动回退分支未触发；实际上线成功。禁止在未核对后来产生的业务数据时执行整库回退。

## 当前边界

本次部署完成L1上线；未执行收费模型调用、自动搜索实测或平台公开发布，未注册任何未核验AUTO适配器。当前可使用热点手动导入、脚本手动版本、成片上传、审核排期、人工发布包和结果/指标回填。模型生成计划可查看，执行确认仍受新提交关闭开关阻止；如需启用收费生成，另按用户授权打开开关并单独验收。L2/L3仍需补齐平台应用权限、授权账号及真实提交/查单证据。
