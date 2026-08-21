import type { DeviceOrderItem } from '../hooks/useDeviceOrders';

// Gemeinsam genutzt von TableBillingScreen.tsx (vorläufige Abrechnung pro Tisch) und
// TableOverviewScreen.tsx (Tagesumsatz über alle Tische) — vorher gab es zwei identische
// Kopien dieser Funktionen, nur in TableBillingScreen.tsx.

// Preis einer einzelnen Position: Preis-Snapshot vom Bestellzeitpunkt
// (unit_price/extras[].price), mit Fallback auf den aktuellen menu_items.price
// für ältere Bestellungen, die vor Einführung des Snapshots angelegt wurden.
// Funktioniert unverändert für Rabatt-Positionen (is_discount-Kategorie, siehe
// schema.sql): deren unit_price ist negativ und wird hier einfach mitaddiert, ohne
// Sonderfall — reduziert Tisch-Summe wie Tagesumsatz gleichermaßen korrekt.
export function itemTotal(item: DeviceOrderItem): number | null {
  const base = item.unit_price ?? item.menu_item.price ?? null;
  const extras = item.extras ?? [];
  const extrasSum = extras.reduce((sum, e) => sum + (e.price ?? 0) * e.quantity, 0);
  const hasAnyPrice = base !== null || extras.some((e) => e.price !== null && e.price !== undefined);
  if (!hasAnyPrice) return null;
  return (base ?? 0) + extrasSum;
}

export function formatPrice(amount: number): string {
  return `${amount.toFixed(2).replace('.', ',')} €`;
}
