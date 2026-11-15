# 语音模型配置

已于2026-11-15部署至 https://comic.cloudsentryai.com ，版本 `508e22b-tts-c1da6dba6a78`，24项本机/公网检查通过。已有指定Grok语音配置已切换为Grok协议；刷新设置页面后重新点击「测试」即可检查模型登记。未执行付费合成验收。

语音模型不能使用聊天接口测试。同一个网关的不同分类可能使用不同协议，必须按接口文档选择。

| 模型                                                | API 协议    | Base URL                                   | 实际合成路径    |
| --------------------------------------------------- | ----------- | ------------------------------------------ | --------------- |
| `grok-voice-latest`、`grok-voice-think-fast-1.0` 等 | Grok (xAI)  | `https://grok2api.cloudsentryai.com/v1`    | `/tts`          |
| `chatgpt-tts`                                       | OpenAI 兼容 | `https://chatgpt2api.cloudsentryai.com/v1` | `/audio/speech` |

Grok 发送 `model`、`text`、`voice_id`、`language` 和 `output_format: { codec: "mp3" }`；默认音色 `eve`、语言 `zh`。OpenAI 兼容发送 `model`、`input`、`voice`、`response_format: "mp3"` 和 `speed`；默认音色 `alloy`。模型名保留用户选择，不在两套模型之间偷偷替换。

Base URL 填到 `/v1`，不要包含 `/tts` 或 `/audio/speech`；API Key 填对应网关的真实Key，示例中的 `g2a_your_api_key` 是占位符。在编辑已有配置时，Key留空会继续使用原Key；测试会使用当前表单选中的协议。

「测试」只调用 `/models` 检查鉴权和所选模型是否登记，不调用 `/chat/completions`，也不会生成付费音频。测试成功会明确写「未执行真实语音合成」；这不证明上游合成额度、音色或实时生成一定成功。模型未在列表中只说明未登记，需向供应商核对别名；不是聊天接口报错所代表的“模型不支持聊天”。

未保存表单的测试不会覆盖原配置测试状态。上游返回网页、JSON错误或空音频时不会保存为MP3；合成失败不会自动重新下单。浏览器验收使用本地模拟接口，没有对生产项目执行测试写入或付费合成。
