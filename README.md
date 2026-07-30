# parse-prd

PRD 文档解析 → 标准化 → OpenSpec 生成流水线。

将原始 PRD 文档（Markdown / PDF / Excel / 纯文本）逐层转化为结构化的标准 PRD、技术提案，最终输出符合 [OpenSpec](https://openspec.dev/) 规范的 `openspec/` 目录结构。

## 架构

```
src/
├── parsers/              # Layer 0: 多格式文档解析
│   ├── types.ts          #   Parser 接口
│   ├── index.ts          #   Parser 注册中心
│   ├── utils.ts          #   共享工具（createNode / toPlainText / 标题检测）
│   ├── markdown.ts       #   Markdown → SchemaNode 树
│   ├── text.ts           #   纯文本 → 启发式标题识别
│   ├── pdf.ts            #   PDF → 文本提取 → SchemaNode 树
│   └── xlsx.ts           #   Excel → Sheet 级 table 节点树
├── pipeline/             # Layer 1-3: LLM 驱动的标准化流水线
│   ├── types.ts          #   StandardizedPRD / Proposal / OpenSpec 类型 + Zod schema
│   ├── llm.ts            #   DeepSeek LLM 客户端（兼容 OpenAI SDK）
│   ├── store.ts          #   持久化：读写 .prd-pipeline/{docId}/
│   ├── standardize.ts    #   Layer 1: AgentOutput → StandardizedPRD
│   ├── proposal.ts       #   Layer 2: StandardizedPRD → OpenSpecProposal
│   ├── generate.ts       #   Layer 3: Proposal → openspec/ Markdown 文件
│   └── pipeline.ts       #   状态机编排
├── agent.ts              #   runAgent — 解析入口 + 输出组装
├── format.ts             #   AgentOutput → Markdown 回写
├── env.ts                #   环境变量（Zod 校验）
├── logger.ts             #   Pino 日志
└── main.ts               #   CLI 入口
```

## 流水线

```
原始文档 (md/pdf/xlsx/text)
      ↓ Layer 0: parse
AgentOutput JSON (nodes + sections + evidence + stats)
      ↓ Layer 1: standardize (LLM)
StandardizedPRD JSON     → .prd-pipeline/{docId}/1-standardize.json
      ↓ Layer 2: proposal (LLM)
OpenSpecProposal JSON    → .prd-pipeline/{docId}/2-proposal.json
      ↓ Layer 3: generate (LLM)
openspec/changes/{docId}/
  ├── proposal.md        # 项目编号、模块拆分、API 端点、风险
  ├── design.md          # 架构方案、技术选型、数据库设计
  ├── tasks.md           # 分阶段实现清单
  └── specs/             # 按模块拆分的 OpenSpec 规范
      ├── 用户认证模块/spec.md
      ├── 权限管理模块/spec.md
      └── ...
```

## 环境变量

复制 `.env.example` 为 `.env`：

```bash
NODE_ENV=development
LOG_LEVEL=info
DEEPSEEK_API_KEY=sk-xxx      # DeepSeek API Key（兼容 OpenAI SDK）
DEEPSEEK_MODEL=deepseek-chat # 模型名
```

## CLI 命令

```bash
# 解析文档 → AgentOutput JSON
pnpm dev parse [docId]

# 执行流水线（默认全流程 Layer 1→3）
pnpm dev run [docId] [layer]

# 查看某层输出
pnpm dev layer [docId] <1|2|3>

# 查看流水线状态
pnpm dev status [docId]
```

### 示例

```bash
# 一键全流程
pnpm dev run my-prd

# 逐步执行（可中间审查）
pnpm dev run my-prd 1    # 生成标准化 PRD
# 审查 .prd-pipeline/my-prd/1-standardize.json
pnpm dev run my-prd 2    # 生成 OpenSpec 提案
# 审查 .prd-pipeline/my-prd/2-proposal.json
pnpm dev run my-prd 3    # 生成 openspec/ 目录
```

## 人工确认

每层输出 JSON 后，人工审查并保存确认版本：

```bash
cp .prd-pipeline/my-prd/1-standardize.json \
   .prd-pipeline/my-prd/1-standardize.review.json
```

程序检测到 `.review.json` 存在后跳过该层，直接进入下一层。

## 已支持的文档格式

| source | 解析方式 | 节点类型 |
|--------|----------|----------|
| `markdown` | unified + remark-parse 完整 AST | heading / paragraph / code / list / listItem / blockquote / table / link / image |
| `text` | 启发式标题识别 + 段落拆分 | heading / paragraph |
| `pdf` | pdf-parse v2 文本提取 + 结构识别 | heading / paragraph |
| `xlsx` | SheetJS 按 sheet 构建 table 树 | heading / table / paragraph |

## 技术栈

- **运行时**：Node.js ≥ 20
- **语言**：TypeScript（ESM，`module: ESNext` + `moduleResolution: bundler`）
- **文档解析**：unified + remark-parse / pdf-parse / SheetJS (xlsx)
- **LLM**：OpenAI SDK → DeepSeek API
- **校验**：Zod（环境变量 + LLM 输出 schema）
- **日志**：Pino
- **代码规范**：Biome（lint + format）
- **Git Hooks**：Husky + commitlint + lint-staged

## 开发

```bash
pnpm install
pnpm dev          # nodemon 热重载
pnpm build        # tsc 构建
pnpm start        # 运行构建产物
pnpm typecheck    # 类型检查
pnpm lint         # 代码检查
pnpm lint:fix     # 自动修复
```
