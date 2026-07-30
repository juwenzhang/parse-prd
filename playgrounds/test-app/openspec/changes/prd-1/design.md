## 产品概述
在现有电商平台基础上，扩展直播带货能力，为主播提供直播管理、实时互动、站内快速下单与数据复盘工具，同时为平台管理员提供弹幕内容风控能力。新模块作为独立子系统，与已有的用户、订单体系无缝集成，支持直播场景下的高并发实时互动与交易闭环。

## 业务架构

### 核心业务流程
**主播侧流程：**
1.  主播创建/编辑直播间（POST/GET `/anchor-live-management`），配置直播标题、封面、预告时间、关联商品。
2.  直播开始后，实时推流，用户进入直播间，观看直播并发送弹幕互动（POST `/live-interaction`）。
3.  主播或助理在直播中上架商品（已在直播管理中绑定商品），用户点击“立即购买”后走直播专属下单通道（POST `/live-purchase`），快速生成关联订单。
4.  直播结束后，主播查看直播数据看板（GET `/live-analytics`），获取观看人数、互动量、订单转化等指标。

**用户侧流程：**
1.  浏览直播广场，进入某直播间（可复用直播间查询接口）。
2.  发送弹幕、点赞等互动（`live-interaction` API）。
3.  在直播间内一键购买（`live-purchase` API），自动使用默认地址、默认支付方式，下单后异步处理支付状态更新。
4.  可在订单中心查看直播订单（已复用现有订单体系，增加直播来源标识）。

**管理员侧流程：**
1.  登录后台，管理违禁词/过滤规则（`admin-danmaku-filter` API）。
2.  规则实时生效，用户弹幕内容经过风控过滤后才写入直播间消息流。
3.  可查看系统整体直播分析数据（`live-analytics` 后台版，可聚合全平台维度，未来扩展）。

### 模块关系
- **直播管理模块** (`anchor-live-management`)：负责直播间生命周期管理，创建/更新/查询直播间信息，关联主播(用户)、商品。
- **直播互动模块** (`live-interaction`)：处理实时弹幕、点赞等信令，调用弹幕风控服务做内容过滤，并将合规消息推送到前端（WebSocket 实时通道，API负责管理交互记录）。
- **直播购买模块** (`live-purchase`)：封装直播间下单逻辑，校验库存、生成待支付订单（复用现有 `Order` 模型，记录直播来源）、扣减库存。
- **直播分析模块** (`live-analytics`)：提供单场直播或聚合维度数据查询，数据来自异步埋点流水聚合。
- **弹幕过滤模块** (`admin-danmaku-filter`)：管理敏感词库，提供 CRUD 接口，供互动模块实时检测使用。

数据流向：
`用户互动` → `live-interaction` API → `弹幕风控服务`（读取过滤词）→ 合规消息写入时序库 + 广播WebSocket  
`下单` → `live-purchase` API → `库存服务`、`订单服务`（复用现有下单逻辑）→ 返回订单ID  
`分析查询` → `live-analytics` API → `分析数据库`（聚合数据）  
管理操作均为 RESTful CRUD。

## 技术方案

### 技术选型理由
项目现有技术栈为 TypeScript + Node.js，已采用 pino（日志）、zod（输入校验）、biomejs（代码规范）、husky/lint-staged（commit 钩子），且路由/服务/模型分层清晰。新模块严格延续此技术栈：
- **框架**：沿用现有 HTTP 框架（如 Express 或 Fastify），保持路由声明方式一致。
- **校验**：所有输入均使用 zod 定义 schema，类型自动推导，保障接口健壮性。
- **通信**：互动模块需高实时性，在现有 HTTP API 基础上，增加 WebSocket 服务（可复用 `ws` 库）用于弹幕推送，API 层主要负责弹幕内容上报和过滤。
- **数据存储**：直播核心数据（直播间、弹幕历史）使用 PostgreSQL（与现有订单/用户同库），分析数据采用 ClickHouse（或外置时序库）以支撑高吞吐写入和聚合查询（前期可降级为 PG 表，通过物化视图实现）。
- **缓存/消息**：弹幕过滤词缓存在 Redis 中，设置 TTL，避免每次读取 DB；直播间元数据可缓存提高查询性能。
- **日志与追踪**：继续使用 pino，统一日志格式，关键操作（下单、过滤命中）打印结构化日志。
- **API 文档**：按 OpenSpec 规范生成 OpenAPI 3.0 文档，与现有 spec 目录统一管理。

### 关键设计决策
1.  **弹幕过滤实时化**  
    `admin-danmaku-filter` 添加/删除过滤词时，同步更新 Redis 缓存，并发布 Redis Pub/Sub 通知各互动服务节点刷新本地缓存。这样保证弹幕过滤在毫秒级完成，且不依赖数据库查询。

2.  **直播购买与订单系统解耦**  
    `live-purchase` 接口内部调用现有的订单创建服务（如 `OrderService.createOrder()`），额外传入 `source: 'live'` 及 `liveRoomId`。订单表新增 `source` 和 `live_room_id` 字段（若非空时增加索引），避免破坏原有下单逻辑。支付流程复用现有 `POST /:id/...` 等接口。

3.  **分析数据异步化**  
    直播间观看、互动、下单等事件，通过事件总线（可基于 Redis Streams 或轻量级消息队列）写入埋点流水，再由分析服务消费写入分析库。避免高并发直播读写互相影响。

4.  **主播管理权限**  
    直播间管理 API 需校验用户是否为主播（可在 User 模型中增加 `role` 字段，或使用角色表），接口中间件做角色鉴权（已有登录体系可复用 JWT 解析）。

5.  **数据库表扩展原则**  
    不修改现有表的核心列，仅做向前兼容的扩展（如订单表增加 `source`, `live_room_id`），避免影响已有功能。

## 数据模型

### 核心实体
1.  **LiveRoom (直播间)**
    - id: uuid
    - anchorId: UUID (关联 User)
    - title: string
    - coverUrl: string
    - startTime: timestamp
    - endTime: timestamp
    - status: enum (scheduled / live / ended / archived)
    - productIds: UUID[] (关联直播商品，如商品ID列表，可新建关联表)
    - createdAt, updatedAt

2.  **DanmakuRule (弹幕过滤规则)**
    - id: serial
    - keyword: string (敏感词)
    - ruleType: enum (exact / regex)
    - isActive: boolean
    - createdBy: UUID (管理员用户)
    - createdAt, updatedAt

3.  **LiveInteraction (互动记录，用于回放与分析，实时消息不存全量需设计)**
    - id: uuid
    - liveRoomId: UUID
    - userId: UUID (可空，游客)
    - contentType: enum (danmaku / like / gift ...)
    - content: string
    - createdAt: timestamp

4.  **LiveOrder (直播订单，实际扩展自 Order)**
    - 复用现有 Order 表，扩展字段：
    - source: enum (mall / live)  — 原表可能默认为 mall
    - liveRoomId: UUID (nullable)

5.  **LiveAnalyticsSnapshot (直播间维度的分析快照，按场次聚合)**
    - liveRoomId: UUID
    - totalViews: int
    - peakOnline: int
    - totalDanmaku: int
    - totalOrders: int
    - gmv: decimal
    - calculatedAt: timestamp (最近一次聚合时间)

### 实体关系
- **User** 1 —— N **LiveRoom**  (一个主播可有多个直播间)
- **LiveRoom** 1 —— N **LiveInteraction**
- **LiveRoom** 1 —— 0..N **Order** (直播渠道下单)
- **DanmakuRule** 独立实体，全局生效，不与直播间直接关联。
- **LiveAnalyticsSnapshot** 1 —— 1 **LiveRoom** (按场次唯一聚合记录)

**图例简要：**
```
User (主播) --< LiveRoom >-- LiveInteraction
LiveRoom --< Order (通过 liveRoomId)
DanmakuRule (独立)
LiveAnalyticsSnapshot -- LiveRoom
```

**数据库扩展策略：**
- 新建 `live_rooms`, `danmaku_rules`, `live_interactions`, `live_analytics_snapshots` 表。
- `orders` 表执行轻量 `ALTER` 增加上述两列，保持向后兼容。
- 所有新表使用与现有库一致的命名规范（snake_case），索引按查询模式建立：`live_rooms (anchor_id, status)`, `live_interactions (live_room_id, created_at)`, `orders (live_room_id)`。

---

该设计严格基于现有代码约束和产品接口列表，保证新模块独立且能快速集成，不影响已有业务稳定性。