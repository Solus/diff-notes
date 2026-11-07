import { InventoryService, OutOfStockError } from './inventory';
import { formatCurrency, generateId, groupBy, retry, roundTo } from './utils';

export type OrderStatus = 'pending' | 'paid' | 'shipped' | 'cancelled';

export interface OrderLine {
  sku: string;
  quantity: number;
  unitPriceCents: number;
}

export interface Order {
  id: string;
  customerId: string;
  lines: OrderLine[];
  status: OrderStatus;
  createdAt: Date;
  totalCents: number;
}

export interface PaymentGateway {
  charge(customerId: string, amountCents: number): Promise<{ transactionId: string }>;
  refund(transactionId: string): Promise<void>;
}

export class OrderValidationError extends Error {
  constructor(public readonly problems: string[]) {
    super('Invalid order: ' + problems.join('; '));
    this.name = 'OrderValidationError';
  }
}

export class OrderService {
  private readonly orders = new Map<string, Order>();
  private readonly transactions = new Map<string, string>();

  constructor(
    private readonly inventory: InventoryService,
    private readonly payments: PaymentGateway,
  ) {}

  async placeOrder(customerId: string, items: Array<{ sku: string; quantity: number }>): Promise<Order> {
    const lines: OrderLine[] = items.map(item => ({
      sku: item.sku,
      quantity: item.quantity,
      unitPriceCents: this.inventory.getProduct(item.sku).priceCents,
    }));
    validateOrder(customerId, lines);

    const reserved: OrderLine[] = [];
    try {
      for (const line of lines) {
        this.inventory.reserve(line.sku, line.quantity);
        reserved.push(line);
      }
    } catch (error) {
      for (const line of reserved) {
        this.inventory.release(line.sku, line.quantity);
      }
      if (error instanceof OutOfStockError) {
        throw new OrderValidationError([error.message]);
      }
      throw error;
    }

    const order: Order = {
      id: generateId('ord'),
      customerId,
      lines,
      status: 'pending',
      createdAt: new Date(),
      totalCents: calculateTotal(lines),
    };
    this.orders.set(order.id, order);
    return order;
  }

  async pay(orderId: string): Promise<Order> {
    const order = this.require(orderId);
    if (order.status !== 'pending') {
      throw new Error('Order ' + orderId + ' is ' + order.status + ', cannot pay');
    }
    try {
      const result = await retry(() => this.payments.charge(order.customerId, order.totalCents), {
        attempts: 3,
        baseDelayMs: 200,
        shouldRetry: error => !(error instanceof OrderValidationError),
      });
      this.transactions.set(order.id, result.transactionId);
    } catch (error) {
      await this.cancel(orderId);
      throw error;
    }
    for (const line of order.lines) {
      this.inventory.commit(line.sku, line.quantity);
    }
    order.status = 'paid';
    return order;
  }

  async cancel(orderId: string): Promise<Order> {
    const order = this.require(orderId);
    if (order.status === 'shipped') {
      throw new Error('Shipped orders cannot be cancelled');
    }
    if (order.status === 'cancelled') {
      return order;
    }
    const transactionId = this.transactions.get(orderId);
    if (order.status === 'paid' && transactionId) {
      await this.payments.refund(transactionId);
      for (const line of order.lines) {
        this.inventory.restock(line.sku, line.quantity);
      }
    } else {
      for (const line of order.lines) {
        this.inventory.release(line.sku, line.quantity);
      }
    }
    order.status = 'cancelled';
    return order;
  }

  ship(orderId: string): Order {
    const order = this.require(orderId);
    if (order.status !== 'paid') {
      throw new Error('Only paid orders can be shipped');
    }
    order.status = 'shipped';
    return order;
  }

  listOrders(customerId?: string): Order[] {
    const all = Array.from(this.orders.values());
    return customerId ? all.filter(o => o.customerId === customerId) : all;
  }

  summarize(): Record<OrderStatus, { count: number; total: string }> {
    const groups = groupBy(this.listOrders(), o => o.status);
    const summary = {} as Record<OrderStatus, { count: number; total: string }>;
    for (const status of ['pending', 'paid', 'shipped', 'cancelled'] as OrderStatus[]) {
      const orders = groups[status] ?? [];
      const cents = orders.reduce((sum, o) => sum + o.totalCents, 0);
      summary[status] = { count: orders.length, total: formatCurrency(cents) };
    }
    return summary;
  }

  private require(orderId: string): Order {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error('Unknown order: ' + orderId);
    }
    return order;
  }
}

export function calculateTotal(lines: OrderLine[]): number {
  const subtotal = lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
  return roundTo(subtotal, 0);
}

function validateOrder(customerId: string, lines: OrderLine[]): void {
  const problems: string[] = [];
  if (!customerId) {
    problems.push('customer id is required');
  }
  if (lines.length === 0) {
    problems.push('order has no lines');
  }
  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      problems.push('invalid quantity for ' + line.sku);
    }
    if (line.unitPriceCents < 0) {
      problems.push('negative price for ' + line.sku);
    }
  }
  if (problems.length > 0) {
    throw new OrderValidationError(problems);
  }
}
