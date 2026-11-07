/** Small helpers shared by the inventory and order services. */

export function formatCurrency(cents: number, currency = 'EUR'): string {
  const amount = (cents / 100).toFixed(2);
  const symbols: Record<string, string> = { EUR: '€', USD: '$', GBP: '£' };
  const symbol = symbols[currency] ?? currency + ' ';
  return symbol + amount;
}

export function clamp(value: number, min: number, max: number): number {
  if (min > max) {
    throw new RangeError('min must not be greater than max');
  }
  return Math.min(Math.max(value, min), max);
}

export function roundTo(value: number, digits = 2): number {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) {
    throw new RangeError('chunk size must be positive');
  }
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

export function groupBy<T, K extends string>(items: readonly T[], key: (item: T) => K): Record<K, T[]> {
  const groups = {} as Record<K, T[]>;
  for (const item of items) {
    const k = key(item);
    (groups[k] ??= []).push(item);
  }
  return groups;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

let counter = 0;

/** Not cryptographically secure; good enough for demo identifiers. */
export function generateId(prefix: string): string {
  counter += 1;
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return prefix + '_' + stamp + rand + counter;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
  shouldRetry?: (error: unknown) => boolean;
}

/** Retries an async operation with exponential backoff. */
export async function retry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < options.attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (options.shouldRetry && !options.shouldRetry(error)) {
        break;
      }
      const delay = options.baseDelayMs * Math.pow(2, attempt);
      await sleep(delay);
    }
  }
  throw lastError;
}

export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

export function assertNever(value: never): never {
  throw new Error('Unexpected value: ' + JSON.stringify(value));
}

export function parseQuantity(input: string): number {
  const trimmed = input.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error('Quantity must be a whole number: "' + input + '"');
  }
  return parseInt(trimmed, 10);
}
