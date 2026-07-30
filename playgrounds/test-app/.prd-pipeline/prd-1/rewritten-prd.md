# Untitled
> AI 重写版本 · 1.0

## 背景
运营多次催促，竞品已成熟，当前图文详情页转化率低，需建设直播带货系统，通过主播实时演示提升转化率。同时大促期间流量波动大，曾因10万并发导致服务器崩溃，需支持高并发直播。

## 用户故事
- **US1** 作为主播，我想要通过手机或电脑快速开播，设置直播信息并完成倒计时准备，以便提高效率
- **US2** 作为观众，我想要在直播间发送弹幕与主播互动，以便提高效率
- **US3** 作为观众，我想要点击商品卡后在直播间浮层内选择规格并下单购买，以便提高效率
- **US4** 作为主播，我想要讲解商品时将其卡片高亮，并可查看实时销售数据，以便提高效率

## 领域实体
### 直播间
| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 直播间唯一标识 |
| title | string | 直播标题 |
| coverUrl | string | 封面图链接 |
| anchorId | string | 主播用户ID |
| status | enum | 直播状态：未开始/直播中/已结束 |
| onlineCount | number | 当前在线人数 |
| startTime | datetime | 直播开始时间 |

### 商品
| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 商品ID |
| name | string | 商品名称 |
| price | number | 售价 |
| stock | number | 当前库存 |
| skus | array | 可选的SKU列表，如颜色、尺码等 |

### 弹幕
| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 弹幕ID |
| content | string | 文本内容 |
| senderId | string | 发送者用户ID |
| sendTime | datetime | 发送时间 |
| isPinned | boolean | 是否被主播置顶 |

### 订单
| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 订单ID |
| userId | string | 下单用户ID |
| productId | string | 购买商品ID |
| sku | string | 选择的SKU |
| quantity | number | 购买数量 |
| amount | number | 实付金额 |
| couponId | string | 使用的优惠券ID |
| status | enum | 订单状态：待支付/已支付/已取消 |

### 主播
| 字段 | 类型 | 说明 |
|------|------|------|
| userId | string | 对应系统用户ID |
| nickname | string | 主播昵称 |
| followerCount | number | 粉丝数 |

## 技术约束
- 前端必须使用React框架
- 后端基于现有Node.js/TypeScript技术栈，可使用pino日志、zod校验
- 视频流采用RTMP推流协议，端到端延迟控制在3秒以内
- 系统需支持10万以上同时在线，大促期间可弹性扩容
- 实时消息推送（弹幕、数据）使用WebSocket，不得使用轮询
- 热点数据（直播状态、在线人数等）使用Redis缓存，减轻数据库压力
- 弹幕服务需实现限流和敏感词过滤，政治类敏感词直接拦截

## 术语表
- **RTMP**：Real-Time Messaging Protocol，实时消息传输协议，常用于直播推流
- **推流**：将采集的视频信号通过网络传输到服务器的过程
- **弹幕**：一种实时评论形式，以滚动字幕的方式出现在视频画面上
- **SKU**：Stock Keeping Unit，库存量单位，指商品的具体规格（如颜色、尺码）
- **WebSocket**：基于TCP的全双工通信协议，用于实现实时推送
- **高并发**：系统在短时间内处理大量同时涌入的请求
- **浮层**：覆盖在当前页面上方的弹出层，通常用于电商快速购买
