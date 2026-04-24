# AI Comic Drama - 项目开发规范

本文件定义 ai-comic-drama 项目的特定开发规范，作为父目录 CLAUDE.md 的补充。

## 技术栈

- **框架**: Next.js 14 (App Router)
- **语言**: TypeScript
- **数据库**: PostgreSQL + Prisma ORM
- **状态管理**: React Query (TanStack Query)
- **样式**: Tailwind CSS
- **认证**: NextAuth.js
- **AI 服务**: 多模型支持 (OpenAI/Claude/Gemini/DeepSeek 等)

## 项目特定规范

### 1. 全局影响原则（重要）

**修改代码时，必须检查并同步修改所有相关使用位置。**

| 场景            | 要求                                               |
| --------------- | -------------------------------------------------- |
| 添加新功能/组件 | 检查是否有多处使用相同逻辑的地方，全部同步添加     |
| 修改 API 接口   | 检查所有调用该接口的前端代码                       |
| 修改数据模型    | 检查所有使用该模型的 API 和页面                    |
| 修改表单字段    | 检查创建模式和编辑模式是否都需要修改               |
| 添加 UI 功能    | 检查列表视图、详情视图、弹窗等所有展示该数据的地方 |

**示例**：

- 为"外貌描述"添加 AI 生成按钮时，必须同时修改：
  - 创建角色弹窗中的外貌描述字段
  - 编辑角色卡片中的外貌描述字段
- 修改角色 API 返回字段时，必须检查：
  - 角色列表页面
  - 角色详情/编辑组件
  - 编辑器中的角色选择器

### 2. 文件组织

```
src/
├── app/
│   ├── api/           # API 路由
│   ├── (dashboard)/   # 需要认证的页面
│   └── (auth)/        # 认证相关页面
├── components/        # 可复用组件
├── lib/              # 工具函数和配置
└── services/         # AI 服务封装
```

### 3. API 规范

- 所有 API 必须验证 session
- 使用 `NextResponse.json()` 返回响应
- 错误响应格式: `{ error: string }`
- 动态路由参数使用 `Promise<{ id: string }>` 类型

### 4. 数据库操作

- 使用 Prisma Client (`@/lib/prisma`)
- 关联数据使用 `include` 查询
- 多表操作使用 `prisma.$transaction`
- 数据库变更后运行 `npx prisma db push`

### 5. 前端状态

- 服务端数据使用 React Query
- 表单状态使用 `useState`
- 查询 key 格式: `["resource", id?, filters?]`
- mutation 成功后调用 `invalidateQueries`

### 6. AI 服务调用

- LLM: 使用 `chatCompletion()` from `@/services/ai`
- 图像: 使用 `generateImage()` from `@/services/ai`
- 配置: 通过 `getUserLLMConfig()` / `getUserImageConfig()` 获取用户配置
