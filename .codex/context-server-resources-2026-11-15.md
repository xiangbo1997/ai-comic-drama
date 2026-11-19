# 服务器磁盘与内存检查（2026-11-15）

采样：13:38–13:41 UTC；主机 racknerd-7c28d47。用户仅要求查看占用和可清理项，本轮不执行任何删除、prune、重启、停服务、swapoff 或 drop_caches。

## 流程与边界
- 读取根 AGENTS.md、.codex/AGENTS.md，bootstrap 三协议及 ECC verification-loop；ECC仅补充，只读检查不适用构建/类型/单测。
- 工具目录无 sequential-thinking；codex mcp list 显示无配置，已采用人工顺序推理。/root/.codex/settings.local.json 不存在；不为本次检查安装MCP、放宽或修改全局权限。
- 人工推理：资源快照→低优先级大目录盘点→Docker与日志→硬链接和进程引用→服务/资源复核。仅追加/更新本任务流程记录，可按本任务差异撤销；生产无回退操作必要。

## 资源快照
- df -h /：96G总量、88G已用、3.3G可用、97%；inode使用25%。13:40快照精确可用3479355392字节。
- 13:41:27 free -h：物理内存5.8Gi，used4.1Gi、available1.7Gi；swap7.0Gi、used5.1Gi。检查中swap约4.7–5.2Gi，属于动态采样。
- memory PSI末次avg10 some1.14%、full0.79%；有交换和轻度回收压力，没有本服务OOM证据。
- 41/49个Docker容器运行；35个Chromium进程RSS合计约1034MiB（含共享页，不能作为精确独占内存）；warp-svc约626MiB RSS、hermes约313MiB RSS。
- ai-comic-drama.service PID1716649，active/running、NRestarts=0；cgroup memory约38–44MiB、swap约247MiB，本次invocation memory.events high/max/oom/oom_kill均0、内存PSI0。
- 正确生产端口3100，GET /api/health ok=true、commit=edf1d2b；初次默认3000得到404，读取进程PORT后纠正，非业务故障。
- root低优先级du -x -B1 --max-depth=1完成：/var46001987584、/backup10855698432、/root9976573952、/software7882498048、/tmp5839175680、/usr5416632320、/opt3079376896字节。跨目录硬链接会使单独du/顺序统计不同，不能直接相加。

## 可清理候选（尚未执行）
| 候选 | 证据/规模 | 边界 |
| --- | --- | --- |
| Docker构建缓存 | total4.441GB、reclaimable2.38GB，约2.22GiB | 可重建，清后后续构建变慢；执行前重新核对无相关构建 |
| /tmp/chatgpt2api-npm-cache | 独立文件块752754688字节，约718MiB | 未见其他进程cmd/cwd/exe/maps/fd引用；可重建 |
| /tmp/ai-comic-playwright | 独立文件块676438016字节，约645MiB | 当前浏览器使用容器内其他路径；后续测试需重新下载 |
| /backup/uploads-*.tar.gz | 11月1–15日共15份，10853761024字节 | 若保留最新7份，删除更旧8份可释放5788672000字节，约5.39GiB；先确认保留策略与恢复可用性，不动数据库备份 |
| Docker未使用镜像 | reclaimable4.48GB，约4.17GiB | 包括Barto等近期回滚镜像，不能把unused等同无用 |
| Docker未挂载卷 | reclaimable1.248GB | 含icloud-gomod540.8MB缓存，但另有Mongo/PG/上传/输出数据；禁止整批volume prune |
| 两份旧隔离构建 | 独占文件块32395264与17960960字节，合计约48MiB | 其余约1.19/1.32GB文件块有目录外硬链接，不能按目录表观大小声称释放数GiB |

上述缓存三项合计约3.55GiB（目录元数据未计），加备份保留策略约8.94GiB；不计镜像/卷，非已释放空间。

## 其他发现
- /root/.config约3.95GiB：RoxyBrowser约2.77GiB、adspower_global约1.18GiB；包含内核、配置、Cookies/IndexedDB与登录状态，不可整目录删除。Roxy chrome-bin约1.85GiB、browser-cache约653MiB，未逐版本校验，不计入确定收益。
- /root/.codex约2.65GiB，其中packages约1.94GiB，含当前工具运行包；不整批清理。Go模块目录约1.06GiB，属于可重下载候选，不影响本次主建议。
- /var/log合计约533MiB，journal约160MiB，Docker JSON轮转日志约218MiB；不是当前主要空间来源。
- 打开的已删除文件>=1MiB合计分配约79MiB，多为活跃Chrome临时文件；不为此终止浏览器。
- /swap-extra、/swap-headroom均为正在使用的2GiB交换文件；另有3GiB交换分区，禁止为腾盘直接删除或swapoff。

## 验证与异常
- 完成df/inode、free/swapon、ps与/proc、PSI、vmstat、systemctl/cgroup、Docker system df -v/stats、journal/日志/缓存、备份元数据、du与硬链接/进程占用核对。
- 独立/var/lib/containerd深度扫描超时55秒停止，根目录完整du与Docker自身空间盘点完成，未伪造细分数据。
- 进程占用首轮命中检查脚本自身bash命令文本；排除检查进程及祖先后复核四个候选，其他进程引用均为空。
- 未调用付费模型、读取密钥内容、写生产数据库、改源码、启动构建或负载测试；仅维护.codex记录。
