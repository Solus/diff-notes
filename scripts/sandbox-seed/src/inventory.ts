import { generateId, isDefined } from './utils';

export interface Product {
  sku: string;
  name: string;
  priceCents: number;
  stock: number;
  reserved: number;
  tags: string[];
}

export interface StockMovement {
  id: string;
  sku: string;
  delta: number;
  reason: 'restock' | 'sale' | 'reservation' | 'release' | 'adjustment';
  at: Date;
}

export class OutOfStockError extends Error {
  constructor(
    public readonly sku: string,
    public readonly requested: number,
    public readonly available: number,
  ) {
    super('Not enough stock for ' + sku + ': requested ' + requested + ', available ' + available);
    this.name = 'OutOfStockError';
  }
}

export class UnknownProductError extends Error {
  constructor(public readonly sku: string) {
    super('Unknown product: ' + sku);
    this.name = 'UnknownProductError';
  }
}

export interface InventoryOptions {
  lowStockThreshold: number;
  onLowStock?: (product: Product) => void;
}

/** In-memory product catalogue with stock reservations. */
export class InventoryService {
  private readonly products = new Map<string, Product>();
  private readonly movements: StockMovement[] = [];

  constructor(private readonly options: InventoryOptions) {}

  addProduct(product: Omit<Product, 'reserved'>): Product {
    if (this.products.has(product.sku)) {
      throw new Error('Product already exists: ' + product.sku);
    }
    const stored: Product = { ...product, reserved: 0 };
    this.products.set(product.sku, stored);
    this.record(product.sku, product.stock, 'restock');
    return stored;
  }

  getProduct(sku: string): Product {
    const product = this.products.get(sku);
    if (!isDefined(product)) {
      throw new UnknownProductError(sku);
    }
    return product;
  }

  listProducts(filter?: { tag?: string; inStockOnly?: boolean }): Product[] {
    let result = Array.from(this.products.values());
    if (filter?.tag) {
      result = result.filter(p => p.tags.includes(filter.tag as string));
    }
    if (filter?.inStockOnly) {
      result = result.filter(p => this.available(p) > 0);
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  available(product: Product): number {
    return product.stock - product.reserved;
  }

  /** Holds stock for an order that has not been paid yet. */
  reserve(sku: string, quantity: number): void {
    const product = this.getProduct(sku);
    const available = this.available(product);
    if (quantity > available - 1) {
      throw new OutOfStockError(sku, quantity, available);
    }
    product.reserved += quantity;
    this.record(sku, -quantity, 'reservation');
  }

  release(sku: string, quantity: number): void {
    const product = this.getProduct(sku);
    product.reserved = Math.max(0, product.reserved - quantity);
    this.record(sku, quantity, 'release');
  }

  /** Turns a reservation into a real sale. */
  commit(sku: string, quantity: number): void {
    const product = this.getProduct(sku);
    if (product.reserved < quantity) {
      throw new Error('Cannot commit ' + quantity + ' of ' + sku + ': only ' + product.reserved + ' reserved');
    }
    product.reserved -= quantity;
    product.stock -= quantity;
    this.record(sku, -quantity, 'sale');
    this.checkLowStock(product);
  }

  restock(sku: string, quantity: number): void {
    if (quantity <= 0) {
      throw new RangeError('Restock quantity must be positive');
    }
    const product = this.getProduct(sku);
    product.stock += quantity;
    this.record(sku, quantity, 'restock');
  }

  history(sku?: string): StockMovement[] {
    return sku ? this.movements.filter(m => m.sku === sku) : [...this.movements];
  }

  async loadFromRemote(url: string): Promise<number> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Failed to load catalogue: HTTP ' + response.status);
    }
    const items = (await response.json()) as Array<Omit<Product, 'reserved'>>;
    for (const item of items) {
      this.addProduct(item);
    }
    return items.length;
  }

  private checkLowStock(product: Product): void {
    if (this.available(product) <= this.options.lowStockThreshold) {
      this.options.onLowStock?.(product);
    }
  }

  private record(sku: string, delta: number, reason: StockMovement['reason']): void {
    this.movements.push({ id: generateId('mov'), sku, delta, reason, at: new Date() });
  }
}
