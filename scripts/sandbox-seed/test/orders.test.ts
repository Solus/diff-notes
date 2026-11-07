import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import { InventoryService, OutOfStockError } from '../src/inventory';
import { OrderService, OrderValidationError, PaymentGateway } from '../src/orders';
import { chunk, clamp, slugify } from '../src/utils';

class FakeGateway implements PaymentGateway {
  charges: number[] = [];
  refunds: string[] = [];
  failNext = 0;

  async charge(_customerId: string, amountCents: number) {
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error('gateway down');
    }
    this.charges.push(amountCents);
    return { transactionId: 'tx_' + this.charges.length };
  }

  async refund(transactionId: string) {
    this.refunds.push(transactionId);
  }
}

function setup() {
  const inventory = new InventoryService({ lowStockThreshold: 2 });
  inventory.addProduct({ sku: 'MUG', name: 'Mug', priceCents: 1200, stock: 10, tags: ['kitchen'] });
  inventory.addProduct({ sku: 'CAP', name: 'Cap', priceCents: 1800, stock: 3, tags: ['apparel'] });
  const gateway = new FakeGateway();
  return { inventory, gateway, orders: new OrderService(inventory, gateway) };
}

describe('OrderService', () => {
  let ctx: ReturnType<typeof setup>;

  beforeEach(() => {
    ctx = setup();
  });

  it('places an order and reserves stock', async () => {
    const order = await ctx.orders.placeOrder('c1', [{ sku: 'MUG', quantity: 2 }]);
    assert.equal(order.status, 'pending');
    assert.equal(order.totalCents, 2400);
    assert.equal(ctx.inventory.getProduct('MUG').reserved, 2);
  });

  it('rejects empty orders', async () => {
    await assert.rejects(ctx.orders.placeOrder('c1', []), OrderValidationError);
  });

  it('rejects orders that exceed stock and releases earlier lines', async () => {
    await assert.rejects(
      ctx.orders.placeOrder('c1', [
        { sku: 'MUG', quantity: 1 },
        { sku: 'CAP', quantity: 5 },
      ]),
      OrderValidationError,
    );
    assert.equal(ctx.inventory.getProduct('MUG').reserved, 0);
  });

  it('charges the customer when paying', async () => {
    const order = await ctx.orders.placeOrder('c1', [{ sku: 'CAP', quantity: 1 }]);
    const paid = await ctx.orders.pay(order.id);
    assert.equal(paid.status, 'paid');
    assert.deepEqual(ctx.gateway.charges, [1800]);
    assert.equal(ctx.inventory.getProduct('CAP').stock, 2);
  });

  it('retries a flaky gateway', async () => {
    ctx.gateway.failNext = 1;
    const order = await ctx.orders.placeOrder('c1', [{ sku: 'MUG', quantity: 1 }]);
    const paid = await ctx.orders.pay(order.id);
    assert.equal(paid.status, 'paid');
  });

  it('refunds and restocks when a paid order is cancelled', async () => {
    const order = await ctx.orders.placeOrder('c1', [{ sku: 'MUG', quantity: 3 }]);
    await ctx.orders.pay(order.id);
    await ctx.orders.cancel(order.id);
    assert.deepEqual(ctx.gateway.refunds, ['tx_1']);
    assert.equal(ctx.inventory.getProduct('MUG').stock, 10);
  });

  it('cannot ship an unpaid order', async () => {
    const order = await ctx.orders.placeOrder('c1', [{ sku: 'MUG', quantity: 1 }]);
    assert.throws(() => ctx.orders.ship(order.id), /Only paid orders/);
  });

  it('summarizes orders by status', async () => {
    await ctx.orders.placeOrder('c1', [{ sku: 'MUG', quantity: 1 }]);
    const second = await ctx.orders.placeOrder('c2', [{ sku: 'MUG', quantity: 2 }]);
    await ctx.orders.pay(second.id);
    const summary = ctx.orders.summarize();
    assert.equal(summary.pending.count, 1);
    assert.equal(summary.paid.count, 1);
    assert.equal(summary.paid.total, '€24.00');
  });
});

describe('InventoryService', () => {
  it('throws OutOfStockError when reserving too much', () => {
    const { inventory } = setup();
    assert.throws(() => inventory.reserve('CAP', 10), OutOfStockError);
  });

  it('filters by tag', () => {
    const { inventory } = setup();
    assert.deepEqual(
      inventory.listProducts({ tag: 'kitchen' }).map(p => p.sku),
      ['MUG'],
    );
  });
});

describe('utils', () => {
  it('chunks arrays', () => {
    assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  });

  it('clamps values', () => {
    assert.equal(clamp(15, 0, 10), 10);
    assert.equal(clamp(-1, 0, 10), 0);
  });

  it('slugifies names', () => {
    assert.equal(slugify('Café Latte  Mug!'), 'cafe-latte-mug');
  });
});
