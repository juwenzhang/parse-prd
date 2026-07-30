# 订单系统
> AI 重写版本 · 1.0

## 背景
当前系统缺少完整的订单管理能力，用户反馈下单后无法查看订单状态，退款流程不透明、效率低，客服压力大。

## 非功能需求
- **NFR-1** [performance] 高可用：大促期间订单接口响应时间<500ms，并发支持≥10,000 QPS。
- **NFR-2** [performance] 数据一致性：库存扣减与订单生成必须原子化，避免超卖。
- **NFR-3** [performance] 可追溯：所有退款操作需记录完整日志，包含操作人、时间、金额、状态变更。
- **NFR-4** [performance] 数据保留：线上订单数据保留2年，归档数据可离线查询。

## 用户故事
- **US-01** 作为购物用户，我想要在选择多件商品后，能一次性填写多个收货地址并生成一张订单，以便提高效率
- **US-02** 作为普通买家，我想要能实时知道订单当前处于什么状态，以便提高效率
- **US-03** 作为未支付用户，我想要订单在30分钟内未支付时自动取消，释放占用的库存，以便提高效率
- **US-04** 作为下单用户，我想要在商家发货前可以随时取消订单，并立刻收到退款，以便提高效率
- **US-05** 作为已收货用户，我想要对不满意的商品申请退款，并能看到退款进度，以便提高效率
- **US-06** 作为收货用户，我想要只退订单中的部分商品，且金额能自动计算，以便提高效率
- **US-07** 作为已签收用户，我想要对购买的商品发布评价，帮助其他买家参考，以便提高效率
- **US-08** 作为运营专员，我想要在后台审核大额退款申请，确保退款合理，以便提高效率

## 领域实体
### Order
| 字段 | 类型 | 说明 |
|------|------|------|
| orderId | string | 订单唯一标识 |
| userId | string | 下单用户ID |
| status | enum | 订单状态：PENDING_PAYMENT, PAID, SHIPPED, IN_TRANSIT, SIGNED, CANCELLED, REFUNDING, REFUNDED |
| totalAmount | number | 订单总金额（含优惠） |
| createdAt | datetime | 订单创建时间 |
| cancelDeadline | datetime | 未支付订单自动取消截止时间 |

### OrderItem
| 字段 | 类型 | 说明 |
|------|------|------|
| itemId | string | 订单项唯一标识 |
| orderId | string | 所属订单ID |
| productId | string | 商品ID |
| quantity | number | 购买数量 |
| price | number | 购买单价 |
| addressId | string | 收货地址ID |

### RefundRequest
| 字段 | 类型 | 说明 |
|------|------|------|
| refundId | string | 退款申请唯一标识 |
| orderId | string | 关联订单ID |
| userId | string | 申请用户ID |
| amount | number | 退款金额 |
| reason | string | 退款原因 |
| status | enum | 退款状态：PENDING, APPROVED, REJECTED, PROCESSING, COMPLETED |
| createdAt | datetime | 申请时间 |

### Review
| 字段 | 类型 | 说明 |
|------|------|------|
| reviewId | string | 评价唯一标识 |
| orderId | string | 关联订单ID |
| userId | string | 评价用户ID |
| rating | number | 评分（1-5） |
| content | string | 文字评价内容 |
| status | enum | 审核状态：PENDING, APPROVED, REJECTED |
| createdAt | datetime | 评价时间 |

## 技术约束
- 后端使用 Node.js，数据库 PostgreSQL，缓存 Redis，消息队列 Kafka 用于状态变更通知，前端使用 React。
- 不得修改现有用户登录注册及用户管理模块代码。
- 支付需对接微信支付、支付宝以及信用卡渠道，退款必须原路返回。
- 订单数据保留2年，之后归档至冷存储。
- 未支付订单30分钟后自动取消。
- 订单状态更新采用前端轮询，暂不使用推送。
- 退款金额≤500元自动处理，>500元需人工审核。
- 系统需支持大促期间高并发，不可出现超卖。

## 术语表
- **超卖**：实际售出商品数量超过库存数量，导致无法履约。
- **原路返回**：退款通过原支付通道（微信/支付宝/信用卡）返回到用户账户。
- **待付款**：订单已生成但用户尚未完成支付的初始状态。
- **运输中**：商品已由物流承运商揽收并进入转运流程。
- **部分退款**：对订单中部分商品进行退款操作，而非整单退款。
- **订单取消**：在商家发货前，用户主动终止订单的行为。
