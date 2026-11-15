# 图像上传限额与502修复（2026-11-14）

后续回归修复：10:14四次三视图请求返回400 `prompt is required`，源于Node原生FormData与独立Undici不兼容，被序列化为text/plain的`[object FormData]`。安全HTTP出口现会转换为其自身的FormData实现，保留提示词与文件。新增真实本地HTTP收包及真实Provider传输测试，验证中文提示词、seed、单图/多图、文件元数据、字节内容及JSON兼容；未调用付费上游。该回归与上传限额独立，上述限额处理仍保留。

用户看到的“API返回网页（502）”实际对应上游文件上传接口429：`upload_protection_limit_exceeded`，提示7小时内重试。图像接口同时间存在成功请求，不能据此认定Base URL或Key错误。

应用单张参考图使用`image`，多张使用`image[]`，每张仅发送一次，避免网关同时收取两套兼容字段后重复上传。429展示结构化的中文原因；5xx提示图像服务暂时异常，避免在界面输出HTML或无依据要求修改配置。图像编辑请求复用已有安全HTTP出口。

网关只对`/backend-api/files`上传初始化明确返回的429及上述reason处理账号轮换；记录账号的上传冷却时间，图生图选择时避开该账号，冷却到期自动恢复。保留账号、原始配额及文生图能力。已有图像输出或其他接口故障不会因此重新提交，防止重复生成。没有其他可用账号时返回429和清楚的上传限额提示。

网关代码位于`/software/chatgpt2api/services/protocol/conversation.py`、`/software/chatgpt2api/services/account_service.py`；对应Compose使用本地镜像`chatgpt2api:upload-limit-20261114-3dc698b9`，修复随容器重建保留。后续更换上游镜像时需确认同等修复已包含。

应用测试144项、网关隔离单测9项、上线冒烟8项通过；没有通过真实付费生成验证上游限额恢复，也未修改上游的限额。应用部署版本`508e22b-imagefix-6e26af467d5b`，备份与日志位于`/tmp/ai-comic-deploy-imagefix-20261114T091330Z/`；网关原代码、SQLite快照、旧Compose与镜像构建日志位于`/tmp/chatgpt-upload-limit-backup-20261114T091120Z/`。
