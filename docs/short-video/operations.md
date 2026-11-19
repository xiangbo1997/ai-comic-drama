# 操作、验证、部署与回滚

## 日常使用

1. 管理员配置总开关和允许用户；默认关闭。进入“抽象短视频”，在热点页面手工导入安全平台链接及摘要，或创建原创空白选题。链接仅记录来源，不下载他人原片。短链未展开，仅同输入去重。
2. 创建作品时选择“打工动物”或“生活小事史诗化”模板。文字模型来自现有“模型配置”；查看脚本计划，核对实际模型及费用提示，然后单独确认。脚本结构无效会明确失败，不自动额外调用修复。也可手工保存规格第7节合同的JSON；新版本不可覆盖旧版。
3. 选择脚本版本、图像/视频配置、是否配音与积分上限，查看逐步计划。计划创建不调用模型；确认后独立worker推进。无配音不需要TTS配置。供应方费用未知时显示“未取得账单”，站内积分不是上游消费上限。
4. 也可上传本人有使用权限的MP4成片与封面，填写权利备注。上传经过流式限量、实际格式、ffprobe与SHA验证。预览时查看版本、时长、尺寸、字节和持久存储后端。
5. 在发布账号页添加人工目标账号（仅昵称记录，不代表认证）。在详情选择成片版本、账号、文案、封面、话题和AI/商业声明，创建待审核快照。批准后才可排期，时间为至少60秒后的带偏移时间，例如`2026-11-20T20:00:00+08:00`；数据库存UTC，展示时区使用IANA名称。
6. worker到期转“待人工发布”，超过默认600秒则EXPIRED，避免重启后补发过时内容。下载ZIP包后在平台官方入口手工发布。确认公开后回填真实作品链接和发生的发布时间；系统记录USER_REPORTED，不声称平台核验。
7. 手填24/72小时或自定义指标；观测时间须在发布时间之后，缺失值保留null。自动指标未接通。一个作品向多个账号发布需要各自独立审核和排期，结果互不回滚。

已批准任务不可直接修改。先取消未提交任务，再用新文案创建新的DRAFT。SUBMITTING以后不能宣称取消或撤回成功；只有核对原请求。UNKNOWN没有“一键重试全部”，不能通过resume绕过。

## 独立验证

使用锁文件指定的pnpm，Node22（worker使用内建loadEnvFile）。Web/worker均需本机FFmpeg、ffprobe及现有字体。正常构建：

```sh
cd app
pnpm install --frozen-lockfile
pnpm exec prisma generate
pnpm type-check
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm build:short-video-worker
```

收费与平台边界在测试中mock；真实费用、真实授权及公开作品验收单列。`pnpm test:components short-video.spec.ts`验证真实React界面，不能替代平台测试。

数据库测试严格使用新建容器/临时库，不使用应用.env数据库。现有历史migrations缺完整初始基线，不能用`migrate reset`伪造历史。测试初始化流程：先从基线提交schema生成全表SQL（仅本地diff，无数据库连接），再在显式标记的独立库加载旧schema+哨兵并应用新增SQL。

```sh
# 在仓库根目录生成旧schema；不打印.env或连接串
 git show 82865ea:app/prisma/schema.prisma > /tmp/short-video-baseline.prisma
 cd app
 DOTENV_CONFIG_QUIET=true pnpm exec prisma migrate diff --from-empty --to-schema /tmp/short-video-baseline.prisma --script > /tmp/short-video-test-baseline.sql
# 预先在专属临时容器建ai_comic_verify前缀库，端口仅绑定127.0.0.1。
# 在当前终端显式设置COMIC_POSTGRES_TEST_URL为该库；不复制生产DATABASE_URL。
 SHORT_VIDEO_TEST_DB_SETUP=isolated-only node scripts/short-video-test-db.mjs
 pnpm test:postgres
```

初始化脚本同时要求本机地址、`ai_comic_verify`库前缀与`isolated-only`开关；已有测试迁移收据则跳过重复SQL。缺测试URL直接拒绝。不是生产迁移工具。

## 上线准备（尚未执行，需用户确认）

- 核实真实服务器版本、迁移历史和已应用SQL；核对备份可恢复、R2/本地目录、空间、FFmpeg/ffprobe/字体、Node22/pnpm、运行用户和资源余量。不能根据本地schema自动migrate resolve。
- 独立审查增量`20261119000000_add_short_video/migration.sql`：仅新增，不重命名/删除旧表。生产应用SQL前先确认历史基线和备份。**禁止生产db push、reset、测试和未批准迁移。**
- 构建产物包含Web、`build/short-video-worker.cjs`、Prisma客户端、锁文件和生产依赖；构建时复用已声明tsx依赖内的esbuild，运行时不依赖tsx。不要只同步.next而漏worker。
- 保留.env、现有素材和BGM目录，不使用未经审查的rsync --delete或旧deploy.sh里的db push。现有worker示例沿用仓库服务路径/用户，实际部署前再核实，不修改全局权限或现有Web用户。
- CPU/内存核算：新worker最多1个付费生成、1个合成、1个提交，数据库全局租约跨新worker进程；未知请求继续占位。旧Web生成闸门仍是进程内，**总并发是旧Web+新worker之和**，不是全站全局1。默认worker堆512MiB，媒体流不整片读内存；FFmpeg还需额外原生内存/磁盘预算。
- 确认反向代理上传体积/超时（200MiB视频、10MiB封面）、磁盘额度、限流和私有存储访问方式。对象存储读时重新签名；本地存储目录支持绝对/相对路径，Web和worker必须指向同一位置。

## 获准后的顺序

1. 总开关与新提交开关关闭；备份并验证恢复步骤。
2. 经核实的增量迁移按现有环境受控流程应用；生成Prisma客户端。不可自动执行旧部署脚本。
3. 部署Web和worker一致版本；使用环境变量覆盖为关闭模式，执行`node build/short-video-worker.cjs --check`（只读SELECT/工具检查）。安装systemd示例前核实路径、Node位置和运行用户。
4. 启动恰好一个登记的worker。`SHORT_VIDEO_AUTO_SUBMIT_ENABLED=false`下可在启用范围核对在途任务、推进人工排期；未确认计划不会执行。
5. 旧漫剧登录/CRUD/生成/预览/导出、助手与积分冒烟；为指定用户启用L1，核对人工完整路径和存储。
6. 付费调用、真实授权搜索和公开发布测试分别获准后执行；补connector matrix真实证据后才能注册VERIFIED。当前生产无AUTO适配器。

管理端`GET /api/short-videos/health`需ADMIN/SUPER_ADMIN，返回心跳、到期数量、未知数、过期数与失败分类；不改变公开/api/health既有语义。worker错误仅记录受限code/ID，不输出凭据或上游全文。

## 停机、未知结果与回滚

1. `SHORT_VIDEO_AUTO_SUBMIT_ENABLED=false`停止新付费/发布提交，仍对原凭证只读核对。变更环境后按部署流程重载进程；不可先SIGKILL丢失凭证。
2. 核查SUBMITTING/PROCESSING/UNKNOWN，保留operationKey、GenerationTask、租约与预算，不删除排期引用素材。不确定外部是否受理时标NEEDS_RECONCILIATION；部分现有供应商没有可持久恢复的外部taskId，不能承诺自动找回，需平台/供应方人工查账。
3. SIGTERM使worker停止领取，当前小步骤完成后落检查点退出；最长步骤可能接近现有30分钟上限，systemd给1800秒。SIGKILL后原PROCESSING只核对、不重提。确认不存在活跃旧进程后再允许新worker接管。
4. 关闭总入口，停止新worker并回退已验证的旧Web构建。新增表及所有业务证据保留，不执行破坏性down SQL。旧构建忽略新增表；服务层旧枚举不变。停机不会撤回平台作品。
5. 验证旧漫剧登录、项目CRUD、手动生成、积分、预览和导出，不只检查进程启动。必要的数据回退需另行授权。

本次只在独立库验证迁移/旧数据保留/构建和关停；没有验证生产迁移历史、备份恢复或生产上线。当前交付不能声称线上已更新。
