# 测试覆盖与实测边界

所有PG用例使用本机独立容器的`ai_comic_verify_short_video_final`。收费模型和平台提交用测试替身；FFmpeg、ffprobe、存储、ZIP、Prisma事务和SQL使用真实实现。默认单元测试不连接应用数据库。

| 规格测试           | 代码/证据                                                        | 边界                                                      |
| ------------------ | ---------------------------------------------------------------- | --------------------------------------------------------- |
| T01 权限/开关      | tests/api/short-video.test.ts、short-video.postgres.ts           | 新APIfresh用户状态、worker未确认/关闭不执行               |
| T02 归属           | PostgreSQL来源/脚本/配置/账号/素材/任务/发布和真实路由           | 跨用户404，账号响应无凭据                                 |
| T03 幂等/参数变化  | 并发导入、脚本保存、取消；配置停用后重放计划收据                 | 真事务及唯一索引，不靠按钮禁用                            |
| T04 去重           | tests/lib/short-video.test.ts、PG                                | 保留身份参数，短链不声称跨短链去重                        |
| T05 无效脚本       | 单元时长/角色/重复key；PG模型无效JSON                            | 无额外付费自动修复                                        |
| T06 计划/预算      | PG未确认不调用、摘要不匹配、配置变化、紧急开关                   | 供应方费用未取得账单                                      |
| T07 父任务停止     | generation-job-operation、segmented-video、PG                    | 新旧父任务边界、每段提交前guard                           |
| T08 丢失关联       | PG真实createGenerationJob callback失败再查原operation            | 不第二次建凭证/下单                                       |
| T09 受理后中断     | PG acceptedUnknown、自动发布unknown                              | 只核对，不重提；真实供应方找回待接入验收                  |
| T10 租约竞争       | PG过期token/global worker/heartbeat                              | 使用真实PG锁；未对生产进程发信号                          |
| T11 结算           | PG真实账本+mock模型边界，TTS结算与素材事务                       | 两次drive不重复费用；真实收费回调未执行                   |
| T12 素材变化       | 原jobs安全/CAS回归，verifyScenes、final版本CAS                   | 原图/视频结果保留；部分跨进程时间窗仍依赖保守UNKNOWN      |
| T13 上传/URL       | 流式multipart单元、真实multipart API/ffprobe、URL守卫回归        | 未开启任意第三方原片抓取                                  |
| T14 排期/时区/迟到 | PG未来不领取、超期EXPIRED；浏览器+08:00→UTC                      | 不承诺精确公开时间                                        |
| T15 审核版本       | PG错误hash、已批准不可改、模板快照保留                           | 修改须取消旧任务再新建                                    |
| T16 取消竞争/断开  | PG CAS cancel与SUBMITTING竞争、账号断开                          | 不冒充撤回平台作品                                        |
| T17 发布结果未知   | PG测试连接器submit unknown/只提交一次                            | 真实平台能力BLOCKED                                       |
| T18 平台状态       | PG受理PROCESSING→核对PUBLISHED、浏览器状态展示                   | CONNECTOR_CONFIRMED只来自注入测试连接器或未来真实验证实现 |
| T19 多目标         | 每账号独立publication/operationKey与事务                         | 真实多平台部分成功尚无权限实测                            |
| T20 存储/空间      | durable key、R2重新签名/HeadObject、受控本地路径、探测和磁盘预检 | 本轮仅真实本地存储；R2真实云存储故障待授权环境验收        |
| T21 人工回填/指标  | PG ZIP/USER_REPORTED/null、浏览器人工全流程                      | 缺失指标不置0，无分母为0比率推算                          |
| T22 关闭/刷新      | 浏览器导入和UNKNOWN刷新，GET恢复进度                             | 不通过useEffect创建任务                                   |
| T23 原功能回归     | pnpm test、pnpm test:postgres和原分段/cleanup用例                | 生产登录/生成/导出未运行                                  |
| T24 停新提交/退出  | PG autoSubmit=false仍核对、独立worker --check/关闭模式退出       | SIGKILL后的真实供应方结果不能凭mock宣布可找回             |

实际命令、最终通过数量、覆盖率和第20节状态见acceptance.md。没有把mock输出、HTTP200官方页面或本地构建写成平台/生产已接通。
