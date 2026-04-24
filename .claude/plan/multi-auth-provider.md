# 实施计划：AI 模型供应商多认证方式

## 任务类型
- [x] 前端 (→ Gemini)
- [x] 后端 (→ Codex)
- [x] 全栈 (→ 并行)

## 背景

用户有 GPT Team 和 Gemini Pro 订阅，不想额外购买 API 额度。需要：
1. **ChatGPT Access Token 认证**：利用 ChatGPT 网页版的 access_token，通过自部署逆向代理转为 OpenAI 兼容 API
2. **Gemini 免费 API Key 引导**：引导用户从 Google AI Studio 一键获取免费 API Key（Gemini 2.5 Pro 免费 5RPM/100次天）

## 技术方案

### 认证架构

```
用户配置 → authType 决定凭证处理方式
  ├─ API_KEY (现有)    → 直接用 apiKey 调用
  ├─ CHATGPT_TOKEN     → access_token → 自部署代理 → OpenAI 兼容 API
  └─ OAUTH (未来)      → Google OAuth → Vertex AI（Phase 2 预留）
```

### ChatGPT Token 方案

**核心原理**：用户从 chatgpt.com 获取 access_token → 填入系统 → 系统将 access_token 发送到用户自部署的 chatgpt-to-api 代理 → 代理转为 OpenAI 兼容 `/v1/chat/completions`

**关键决策**：
- 主应用**不内置**逆向代理逻辑（隔离风险）
- 用户需自部署代理服务（如 ChatGPT-to-API），主应用只认 OpenAI 兼容端点
- `customBaseUrl` 填代理地址，`authType` 标记为 `CHATGPT_TOKEN`
- access_token 按现有 AES-256-GCM 加密存储

**用户流程**：
1. 选择 OpenAI 供应商 → 切到"ChatGPT 账号"Tab
2. 按引导步骤获取 access_token（chatgpt.com → /api/auth/session）
3. 粘贴 token + 填写代理地址（customBaseUrl）
4. 测试连接 → 保存

### Gemini 免费 Key 方案

**核心原理**：Google AI Studio 提供完全免费的 Gemini API Key，无需信用卡

**用户流程**：
1. 选择 Gemini 供应商 → 看到"获取免费 API Key"引导
2. 点击跳转到 aistudio.google.com/apikey
3. 复制 Key 回来粘贴
4. 测试连接 → 保存

## 实施步骤

### Phase 1：数据模型扩展（后端）

**步骤 1.1**：Prisma Schema 增加 authType

```prisma
enum AuthType {
  API_KEY          // 标准 API Key（默认）
  CHATGPT_TOKEN    // ChatGPT access_token + 代理
  OAUTH            // OAuth 认证（预留）
}

model UserAIConfig {
  // ... 现有字段
  authType      AuthType  @default(API_KEY)    // 新增
  tokenExpiresAt DateTime? // 新增：token 过期时间（ChatGPT token 约30天）
}
```

**步骤 1.2**：更新配置 API 路由

- `POST /api/ai-models/configs` — 接受 `authType` 参数
- `PUT /api/ai-models/configs/[id]` — 支持更新 `authType`
- `GET /api/ai-models/configs` — 返回 `authType` 和 `tokenExpiresAt`

**步骤 1.3**：更新 ai-config.ts

- `getUserLLMConfig()` 等函数返回 `authType`
- ChatGPT token 认证时，base URL 指向用户代理地址

### Phase 2：前端 UI 改造

**步骤 2.1**：types.ts 扩展

```typescript
export type AuthType = 'API_KEY' | 'CHATGPT_TOKEN' | 'OAUTH';

export interface UserConfig {
  // ... 现有字段
  authType: AuthType;
  tokenExpiresAt: string | null;
}

// 供应商支持的认证方式
export const providerAuthMethods: Record<string, AuthType[]> = {
  'openai': ['API_KEY', 'CHATGPT_TOKEN'],
  'gemini': ['API_KEY'],  // Gemini 只是增加获取引导，认证方式不变
  // 其他供应商默认 ['API_KEY']
};
```

**步骤 2.2**：ConfigDialog.tsx 改造

- 对 OpenAI 供应商：顶部增加 Tabs 切换 "API Key" / "ChatGPT 账号"
- "ChatGPT 账号" Tab 内容：
  - 步骤引导 Alert（3步获取 token）
  - access_token 输入框（textarea，token 较长）
  - 代理地址输入框（customBaseUrl，预填示例）
  - token 有效期提示（约30天，需定期更新）
- 对 Gemini 供应商：
  - API Key 输入框旁增加"获取免费 Key"按钮
  - 点击新窗口打开 aistudio.google.com/apikey
  - 下方 Alert 说明免费额度（2.5 Pro: 5RPM, 2.5 Flash: 10RPM）

**步骤 2.3**：ProviderCard.tsx 增强

- 显示 authType 标签（如 "ChatGPT Token" 标记）
- token 即将过期时显示警告图标
- 已过期时显示红色提示"Token 已过期，请更新"

### Phase 3：后端认证路由适配

**步骤 3.1**：AI 服务调度适配

- `ai/index.ts` 或各 provider 文件：根据 `authType` 调整请求头
  - `API_KEY` → 现有逻辑不变
  - `CHATGPT_TOKEN` → Bearer header + 代理 base URL

**步骤 3.2**：测试连接适配

- `/api/ai-models/test` 和 `/api/ai-models/configs/[id]/test`
- 根据 `authType` 使用不同的测试策略

### Phase 4：安全加固

**步骤 4.1**：access_token 加密存储
- 复用现有 AES-256-GCM 加密（存到 apiKey 字段即可）

**步骤 4.2**：SSRF 防护（重要）
- `customBaseUrl` 增加域名白名单或 SSRF 过滤
- 禁止内网 IP（127.0.0.1、10.x、172.16-31.x、192.168.x）
- 禁止非 HTTP/HTTPS 协议

## 关键文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `app/prisma/schema.prisma` | 修改 | 增加 AuthType enum + UserAIConfig 新字段 |
| `app/src/app/(dashboard)/settings/ai-models/components/types.ts` | 修改 | 增加 AuthType 类型 + providerAuthMethods |
| `app/src/app/(dashboard)/settings/ai-models/components/ConfigDialog.tsx` | 修改 | Tabs 切换 + ChatGPT token UI + Gemini 引导 |
| `app/src/app/(dashboard)/settings/ai-models/components/ProviderCard.tsx` | 修改 | authType 标签 + 过期警告 |
| `app/src/app/api/ai-models/configs/route.ts` | 修改 | 接受/返回 authType |
| `app/src/app/api/ai-models/configs/[id]/route.ts` | 修改 | 更新 authType |
| `app/src/app/api/ai-models/configs/[id]/test/route.ts` | 修改 | 按 authType 测试 |
| `app/src/app/api/ai-models/test/route.ts` | 修改 | 按 authType 测试 |
| `app/src/lib/ai-config.ts` | 修改 | 返回 authType |
| `app/src/services/ai/index.ts` | 修改 | 按 authType 路由请求 |

## 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| ChatGPT token 随时可能失效 | UI 明确提示非官方方式、定期检查、过期提醒 |
| OpenAI ToS 限制逆向 | 隔离到自部署代理，主应用只做 OpenAI 兼容调用 |
| SSRF 攻击（customBaseUrl） | 增加 URL 白名单/黑名单过滤 |
| Token 过期无感知 | tokenExpiresAt 字段 + 前端倒计时提醒 |
| 代理服务不稳定 | 测试连接功能 + 错误提示引导排查 |

## 伪代码

### ConfigDialog Tabs 切换逻辑

```tsx
// ConfigDialog.tsx 内
const supportedAuth = providerAuthMethods[provider.slug] || ['API_KEY'];
const showAuthTabs = supportedAuth.length > 1;

{showAuthTabs && (
  <Tabs value={authType} onValueChange={setAuthType}>
    <TabsList>
      <TabsTrigger value="API_KEY">API Key</TabsTrigger>
      <TabsTrigger value="CHATGPT_TOKEN">ChatGPT 账号</TabsTrigger>
    </TabsList>
  </Tabs>
)}

{authType === 'CHATGPT_TOKEN' && (
  <Alert>
    <Info className="h-4 w-4" />
    <AlertTitle>获取 ChatGPT Access Token</AlertTitle>
    <AlertDescription>
      <ol>
        <li>1. 登录 chatgpt.com</li>
        <li>2. 访问 chatgpt.com/api/auth/session</li>
        <li>3. 复制 accessToken 字段的值</li>
      </ol>
      <p className="text-yellow-400 mt-2">
        ⚠️ Token 约 30 天过期，届时需重新获取
      </p>
    </AlertDescription>
  </Alert>
)}

{provider.slug === 'gemini' && (
  <div className="flex items-center gap-2">
    <Input placeholder="Gemini API Key" ... />
    <Button variant="outline" size="sm"
      onClick={() => window.open('https://aistudio.google.com/apikey', '_blank')}>
      获取免费 Key
    </Button>
  </div>
  <p className="text-xs text-gray-500">
    免费额度：Gemini 2.5 Pro 5次/分钟、Gemini 2.5 Flash 10次/分钟
  </p>
)}
```

### 后端 authType 处理

```typescript
// ai-config.ts
export async function getUserLLMConfig(userId: string) {
  const config = await prisma.userAIConfig.findFirst({ ... });
  return {
    ...existingFields,
    authType: config.authType,        // 新增
    tokenExpiresAt: config.tokenExpiresAt, // 新增
  };
}

// ai/index.ts - 请求发送时
function getAuthHeaders(config: AIConfig) {
  switch (config.authType) {
    case 'CHATGPT_TOKEN':
      return { Authorization: `Bearer ${config.apiKey}` }; // token 存在 apiKey 字段
    case 'API_KEY':
    default:
      return getStandardAuthHeaders(config); // 现有逻辑
  }
}
```

## SESSION_ID（供 /ccg:execute 使用）
- CODEX_SESSION: 019d0ed5-cfa7-7d30-ae3a-aabf2b54c3c9
- GEMINI_SESSION: 12021387-ed6c-46ac-a3fc-642e6da80e23
