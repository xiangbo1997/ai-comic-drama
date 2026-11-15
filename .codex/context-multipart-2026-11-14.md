# 三视图400 prompt is required

- 用户要求查看三视图失败日志。UTC10:14:11、10:14:13、10:14:16、10:14:30四个任务均400，网关同秒记录/images/edits400；没有新的生图调用记录，失败发生在参数解析阶段。
- 复现：Node原生FormData传入独立Undici.Request得到text/plain与[object FormData]；使用Undici.FormData则得到multipart并保留prompt。
- 归因：上一轮将编辑请求由原生fetch改走safeFetch时引入的兼容回归。已明确向用户承认并纠正。
- 修复：safeFetch在DNS/IP校验后，将非当前Undici构造器的FormData按字段复制为当前Undici.FormData，保留字符串、重复字段、文件名、MIME与内容；其他请求体、安全校验和禁止重定向继续有效。
- 人工推理/流程：sequential-thinking及三个项目协议技能仍不可用，按已提供根规范记录阶段；复用tdd/security补充规则。先真实本地HTTP收包两项失败后修复，并补充真实Provider贯穿安全出口的传输用例。
- 验收：190项相关测试、类型/lint/格式通过，构建部署与最终健康记录见verification；不改网关、不触发付费生图。
- 回退：部署前备份.next与版本文件，失败自动恢复；不reset或覆盖既有改动。
