# parse-prd

PRD 文档解析 → 标准化 → OpenSpec 生成流水线。

将原始 PRD 文档（Markdown / PDF / Excel / 纯文本 / 图片）逐层转化为结构化的标准 PRD、技术提案，最终输出符合 [OpenSpec](https://openspec.dev/) 规范的 `openspec/` 目录结构。

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
│   ├── xlsx.ts           #   Excel → Sheet 级 table 节点树
│   └── image.ts          #   图片 → VLM 分析 → mockup 节点
├── vlm/                  # VLM 提供者（可插拔）
│   ├── types.ts          #   VlmProvider 接口
│   ├── noop.ts           #   空实现（默认）
│   ├── openai-vision.ts  #   OpenAI 兼容 Vision Provider
│   └── index.ts          #   setVlmProvider / getVlmProvider
├── scanner/              # 代码上下文扫描
│   ├── index.ts          #   编排入口
│   ├── deps.ts           #   技术栈检测（package.json）
│   ├── structure.ts      #   目录结构
│   ├── routes.ts         #   已有 API 发现
│   ├── models.ts         #   数据模型发现
│   └── openspec.ts       #   OpenSpec config / specs 读取
├── pipeline/             # Layer 1-3: LLM 驱动的标准化流水线
│   ├── types.ts          #   StandardizedPRD / Proposal 类型 + Zod schema
│   ├── llm.ts            #   LLM 客户端（OpenAI 兼容，支持任意模型）
│   ├── store.ts          #   持久化：读写 .prd-pipeline/{docId}/
│   ├── standardize.ts    #   Layer 1: AgentOutput → StandardizedPRD + rewritten-prd.md
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

```mermaid
flowchart TD
    A[原始文档<br/>md/pdf/xlsx/text/image] --> B[Layer 0: parse + scanner]
    B --> C[AgentOutput JSON<br/>+ CodebaseContext]
    C --> D[Layer 1: standardize<br/>LLM 业务重写]
    D --> E[.prd-pipeline/{docId}/<br/>1-standardize.json]
    D --> F[.prd-pipeline/{docId}/<br/>rewritten-prd.md 👈 AI 重写版]
    E --> G{人工确认?}
    F --> G
    G -->|✅ approved| H[Layer 2: proposal<br/>LLM 方案设计]
    G -->|❌ 修改后重跑| D
    H --> I[.prd-pipeline/{docId}/<br/>2-proposal.json]
    I --> J{人工确认?}
    J -->|✅ approved| K[Layer 3: generate<br/>LLM 生成文档]
    J -->|❌ 修改后重跑| H
    K --> L[openspec/changes/{docId}/<br/>proposal.md + design.md<br/>+ tasks.md + specs/]
    L --> M[CodeBuddy /opsx:apply]
```

## 环境变量

```bash
# .env
LLM_API_KEY=sk-xxx           # 必填。支持任意 OpenAI 兼容 API
LLM_BASE_URL=https://api.deepseek.com/v1  # DeepSeek / OpenAI / 自定义
LLM_MODEL=deepseek-chat      # deepseek-chat | gpt-4o | claude-3-5-sonnet | ...
```

切换模型只需改这 3 个环境变量，无需改代码。

## CLI 命令

```bash
rm -rf playgrounds/test-app/.prd-pipeline playgrounds/test-app/openspec/changes/prd

pnpm build && node --import tsx dist/main.js run prd --stdin --cwd playgrounds/test-app < playgrounds/test-app/docs/prd.md

# === 运行 ===
pnpm build
node --import tsx dist/main.js run <docId> --file ./prd.md --cwd .

# === 分步执行（中间可审查 JSON 输出）===
node --import tsx dist/main.js run <docId> 1 --file ... --cwd ...   # Layer 1 only
node --import tsx dist/main.js run <docId> 2 --file ... --cwd ...   # Layer 2 only
node --import tsx dist/main.js run <docId> 3 --file ... --cwd ...   # Layer 3 only

# === 只解析不调 LLM ===
node --import tsx dist/main.js parse <docId> --file ./prd.md

# === 查看产物 ===
node --import tsx dist/main.js layer <docId> <1|2|3>           # JSON 输出
node --import tsx dist/main.js status <docId>                  # 流水线状态
cat .prd-pipeline/<docId>/rewritten-prd.md                     # AI 重写版 PRD

# === 调试 ===
node --import tsx dist/main.js run <docId> --file ... --dry-run  # 只打印 prompt，不调 LLM
node --import tsx dist/main.js run <docId> --file ... --cwd ./playgrounds/test-app  # 指定项目目录
cat prd.md | node --import tsx dist/main.js run <docId> --stdin                     # 管道输入
```

## 输出文件

```
<项目目录>/
├── .prd-pipeline/<docId>/
│   ├── 1-standardize.json     # Layer 1 JSON（结构化 PRD）
│   ├── rewritten-prd.md       # Layer 1 Markdown（人可读，AI 重写版）
│   ├── 2-proposal.json        # Layer 2 JSON（OpenSpec 提案）
│   └── state.json             # 流水线状态
└── openspec/changes/<docId>/
    ├── proposal.md
    ├── design.md
    ├── tasks.md
    └── specs/<module>/spec.md
```

## 人工确认

每层输出后，审查生成的内容。满意则复制确认版本，程序检测到后跳过该层：

```bash
cp .prd-pipeline/<docId>/1-standardize.json \
   .prd-pipeline/<docId>/1-standardize.review.json
```

## 已支持的文档格式

| source | 解析方式 | 节点类型 |
|--------|----------|----------|
| `markdown` | unified + remark-parse | heading / paragraph / code / list / listItem / blockquote / table / link / mockup |
| `text` | 启发式标题识别 + 段落拆分 | heading / paragraph |
| `pdf` | pdf-parse v2 文本提取 | heading / paragraph |
| `xlsx` | SheetJS sheet → table 树 | heading / table / paragraph |
| `image` | VLM + OCR（可插拔提供者） | mockup |

## 切换 LLM 模型

```bash
# OpenAI GPT-4o
LLM_API_KEY=sk-xxx LLM_BASE_URL=https://api.openai.com/v1 LLM_MODEL=gpt-4o pnpm dev ...

# DeepSeek（默认）
LLM_API_KEY=sk-xxx LLM_BASE_URL=https://api.deepseek.com/v1 LLM_MODEL=deepseek-chat pnpm dev ...

# 自定义兼容 API
LLM_API_KEY=xxx LLM_BASE_URL=https://your-proxy.com/v1 LLM_MODEL=your-model pnpm dev ...
```

## VLM 图片分析

默认使用空实现（不调 VLM）。接入真实 VLM：

```typescript
import {setVlmProvider, OpenAICompatibleVisionProvider} from './vlm';
setVlmProvider(new OpenAICompatibleVisionProvider({
  apiKey: process.env.LLM_API_KEY,
  baseURL: process.env.LLM_BASE_URL,
  model: 'gpt-4o'  // 需要 vision 能力的模型
}));
```

## 技术栈

- **运行时**：Node.js ≥ 20
- **语言**：TypeScript（ESM）
- **文档解析**：unified + remark-parse / pdf-parse / SheetJS
- **LLM**：OpenAI 兼容 SDK（DeepSeek / OpenAI / Claude / 自定义）
- **校验**：Zod
- **日志**：Pino
- **代码规范**：Biome

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
