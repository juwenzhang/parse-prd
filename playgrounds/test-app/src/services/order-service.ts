import type {Order, RefundRequest} from '../models/Order';

const orders = new Map<string, Order>();

export async function createOrder(
  input: Omit<Order, 'id' | 'status' | 'createdAt' | 'updatedAt'>
): Promise<Order> {
  const order: Order = {
    ...input,
    id: `ORD-${Date.now()}`,
    status: 'pending',
    createdAt: new Date(),
    updatedAt: new Date()
  };
  orders.set(order.id, order);
  return order;
}

export async function getOrder(id: string): Promise<Order | undefined> {
  return orders.get(id);
}

export async function processRefund(input: RefundRequest): Promise<Order> {
  const order = orders.get(input.orderId);
  if (!order) throw new Error('Order not found');
  order.status = 'refunded';
  order.updatedAt = new Date();
  return order;
}
