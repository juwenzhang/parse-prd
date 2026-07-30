## 产品概述
“晓通”统一通知中心，为平台用户提供多渠道通知接收、偏好控制与消息历史管理，并为运营人员提供通知模板可视化编辑、类型管理、发送频控与全生命周期运营能力。

## 业务架构
### 核心业务流程
1. **通知类型与模板创建**  
   运营人员在后台定义通知类型（如订单提醒、系统公告），并为每种类型设计通知模板（支持页面编辑器实时预览与保存）。
2. **用户偏好设置**  
   用户登录后可进入通知中心，按渠道（站内信、推送、邮件）和通知类型开关接收意愿，系统实时记录偏好。
3. **事件触发与频控**  
   业务系统（如订单、退款）产生通知事件时，调用通知服务；通知服务根据用户偏好、类型开关和发送频率限制（例如每小时最多3条）决定是否推送。
4. **消息推送与持久化**  
   通过站内信、App Push等渠道投递消息，同时将消息记录持久化到“用户通知中心”列表，支持已读未读状态。
5. **用户查看与交互**  
   用户在通知中心查看消息列表，点击跳转关联页面；可对单条消息执行标记已读、删除等操作。

### 模块关系
- **消息接收网关**：接收外部事件，进行合法性校验后委托给“通知编排服务”。
- **通知编排服务**：查询用户偏好、频控窗口、类型状态，决定是否发送；调用“渠道适配器”执行投递。
- **用户通知中心**：提供用户前端所需的消息列表、已读/未读、删除等接口。
- **运营后台**：管理通知类型、模板、全局频控参数；包含页面编辑器服务，用于模板的可视化设计。
- **模板与页面编辑器模块**：独立的页面存储与编辑器配置服务，支持模板页面的 CRUD 和实时预览。

## 技术方案
### 技术选型理由
- **服务端框架**：继续使用现有 Node.js + Express 风格路由（推断自现有 API 结构），保持团队一致性。
- **数据校验**：采用 Zod 定义所有输入/输出 schema，与现有 `CreateUserInput`、`Order` 等模型对齐。
- **日志**：使用 pino + pino-pretty 记录关键操作和异常。
- **频率限制**：基于 Redis 滑动窗口实现分布式频控，保证水平扩展时的准确性。
- **消息队列**：引入 BullMQ（基于 Redis）解耦事件接收与投递，提高吞吐和可靠性。
- **WebSocket**：利用 Socket.IO 向在线用户实时推送站内信新消息提醒。
- **页面编辑器**：前端使用 GrapesJS 等开源库，后端提供页面 JSON 存储接口，模板数据使用 MongoDB 文档存储。
- **开发规范**：继续采纳 pnpm 包管理，husky + lint-staged + biome 保证代码质量，commitlint 规范提交。

### 关键设计决策
1. **通知类型与模板分离**：类型定义业务属性（编码、名称、默认开关），模板定义展示内容（页面、数据占位符），便于同一类型多模板 A/B 测试。
2. **用户偏好存储于用户服务侧**：用户偏好通过 `GET/PUT /api/users/:id/notification-preferences` 管理，复用现有用户体系，不创建独立服务。
3. **频控采用分层设计**： 
   - 用户级频控：每用户每类型每渠道日/时上限。
   - 全局频控：每类型每日总量。
   - 参数存储于运营后台可配置。
4. **页面编辑器存储模型**：模板页面存为 JSON 结构（包含组件、样式、数据绑定），API `/api/pages` 管理模板页面，`/api/editor` 提供编辑器配置与保存能力。
5. **消息状态机**：消息生命周期：`pending` → `sent` → `delivered` / `read` / `deleted`，通过状态机严格控制流转。
6. **幂等处理**：事件采用唯一业务键（如 `order_id+event_type`），避免重复生成通知。

## 数据模型
### 核心实体
- **NotificationType（通知类型）**  
  字段：id, code（唯一），name，description，defaultChannels（array of enum: in_app, push, email），isActive，createdAt，updatedAt

- **NotificationTemplate（通知模板）**  
  字段：id, typeId (关联 NotificationType), channel, name, subject, pageId（关联页面编辑器模板），variablesSchema（JSON, 如 { orderId: string }），isDefault，status（draft/published），createdAt，updatedAt

- **UserNotificationPreference（用户偏好）** – 外挂于用户模块，仍在此列出结构  
  字段：userId, preferences: [{ typeCode, channel, enabled }]

- **NotificationMessage（用户消息记录）**  
  字段：id，userId，typeId，templateId，channel，title，content，payload（JSON, 如关联页面跳转参数），status（pending/sent/delivered/read/deleted）， businessKey（幂等键），readAt, sentAt，createdAt

- **Page（页面编辑器模板）**  
  字段：id, name，content（JSON, 页面组件树），css（text），variablesUsed（[]string），updatedAt，createdAt

- **RateLimitConfig（频控配置）**  
  字段：id，typeId (可选，为空表示全局)，channel，limit (number), window (enum: per_hour, per_day)，createdAt，updatedAt

### 实体关系
- NotificationType 1 ──── N NotificationTemplate  
- NotificationTemplate 1 ──── 1 Page (通过 pageId 关联)  
- NotificationMessage N ──── 1 NotificationType  
- NotificationMessage N ──── 1 User  
- RateLimitConfig N ──── 0..1 NotificationType  
- User 1 ──── N UserNotificationPreference（逻辑归属）

通过上述模型与架构设计，实现功能点 FR-1 至 FR-7 的完整覆盖，并与现有技术栈、代码规范无缝融合。