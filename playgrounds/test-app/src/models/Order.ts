export interface Order {
  id: string;
  userId: number;
  items: Array<{productId: string; quantity: number; price: number}>;
  totalAmount: number;
  status: 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled' | 'refunded';
  shippingAddress: string;
  paymentMethod: 'credit_card' | 'alipay' | 'wechat_pay';
  createdAt: Date;
  updatedAt: Date;
}

export interface RefundRequest {
  orderId: string;
  reason: string;
  amount?: number;
  type: 'full' | 'partial';
}
