/** Old price helpers kept around from the v1 shop. Nothing imports this any more. */

const TAX_RATE = 0.21;

export function priceWithTax(net: number): number {
  return Math.round(net * (1 + TAX_RATE) * 100) / 100;
}

export function priceWithoutTax(gross: number): number {
  return Math.round((gross / (1 + TAX_RATE)) * 100) / 100;
}

export function bulkDiscount(quantity: number): number {
  if (quantity >= 100) {
    return 0.15;
  }
  if (quantity >= 50) {
    return 0.1;
  }
  if (quantity >= 10) {
    return 0.05;
  }
  return 0;
}

export function legacyTotal(unitPrice: number, quantity: number): number {
  const gross = priceWithTax(unitPrice) * quantity;
  const discount = bulkDiscount(quantity);
  return Math.round(gross * (1 - discount) * 100) / 100;
}

// TODO: remove once the old admin page is gone.
export function describeLegacyPrice(unitPrice: number, quantity: number): string {
  return quantity + ' x ' + unitPrice.toFixed(2) + ' = ' + legacyTotal(unitPrice, quantity).toFixed(2);
}
