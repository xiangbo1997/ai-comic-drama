/** 只有应用主动构造的安全错误才能传给模型/浏览器，供应商原始异常不得透出。 */
export class AssistantToolError extends Error {}

export class AssistantModelTimeoutError extends Error {
  constructor() {
    super(
      "助手本轮处理超时，未确认的操作请先查看作品和任务状态，再决定是否重试"
    );
    this.name = "AssistantModelTimeoutError";
  }
}
