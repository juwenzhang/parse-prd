# Untitled Proposal

## Summary
构建统一的消息通知中心，实现站内信通知的创建、推送、已读标记、偏好设置以及运营后台管理，支持实时推送、模板化发送和基础统计，确保消息持久化与用户体验，为后续多渠道扩展奠定基础。

## Modules
- **用户通知中心**: 
- **运营通知管理**: 

## API Endpoints
- `GET /api/pages` — 查询用户通知中心
- `POST /api/pages` — 创建用户通知中心
- `GET /api/editor` — 查询运营通知管理
- `POST /api/editor` — 创建运营通知管理

## Data Models
- **Notification**: 存储每一条发送给用户的通知记录，包含内容、类型、状态及时间信息。 (id, userId, type, title, content, isRead, createdAt)
- **NotificationTemplate**: 预定义的通知内容模板，包含可替换的变量占位符，供运营人员快速创建通知。 (id, name, type, titleTemplate, contentTemplate, variables, status)
- **UserNotificationSetting**: 用户个人通知偏好，控制各类通知的接收开关（系统通知强制开启）。 (userId, systemNotification, promotionNotification, reminderNotification)
- **NotificationDeliveryRecord**: 记录每条通知的送达、打开和点击行为，用于统计。 (id, notificationId, userId, deliveredAt, openedAt, clickedAt)

## Risks
- 需求理解偏差：PRD中部分功能细节不够明确，需与业务方进一步确认
- 用户体验风险：大促高并发场景下的系统稳定性需提前压测验证

## Estimated Effort
M

## Open Questions
无
