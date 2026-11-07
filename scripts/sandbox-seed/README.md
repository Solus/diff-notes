# Shopkeeper

A tiny order-management backend: an inventory service, an order service with
payments, and a Python script that turns an orders export into a sales report.

## Overview

The TypeScript side lives in `src/`:

- `inventory.ts` keeps the product catalogue and handles stock reservations.
- `orders.ts` places, pays, cancels and ships orders.
- `utils.ts` has small shared helpers (money formatting, retry, grouping).

The reporting script lives in `scripts/report.py` and only needs the Python
standard library.

## Getting started

1. Install Node 20 or newer.
2. Install dependencies with `npm install`.
3. Run the tests with `npm test`.

```sh
npm install
npm test
```

## Configuration

Settings live in `config/app.json`. The most useful ones:

| Key | Meaning | Default |
| --- | --- | --- |
| `inventory.lowStockThreshold` | Warn when available stock drops to this level | 2 |
| `inventory.reservationTtlMinutes` | How long unpaid orders hold stock | 30 |
| `payments.retries` | Charge attempts before giving up | 3 |
| `reports.defaultTop` | Products shown in the report | 5 |

## Placing an order

```ts
const inventory = new InventoryService({ lowStockThreshold: 2 });
const orders = new OrderService(inventory, gateway);

const order = await orders.placeOrder('customer-1', [{ sku: 'MUG', quantity: 2 }]);
await orders.pay(order.id);
```

Stock is reserved when the order is placed and committed when it is paid.
Cancelling a pending order releases the reservation; cancelling a paid order
refunds the customer and puts the items back in stock.

## Reports

```sh
python scripts/report.py exports/orders.csv --top 10 --format markdown
```

The CSV needs these columns: `order_id`, `customer_id`, `sku`, `quantity`,
`unit_price`, `status`, `created_at`. Rows that cannot be parsed are skipped and
listed on stderr.

## Project layout

```
config/    application settings
scripts/   reporting tools
src/       services and helpers
test/      unit tests
```

## Roadmap

- Coupons and gift wrap (behind feature flags)
- Waitlist for out-of-stock products
- Paginated order listing

## License

MIT
