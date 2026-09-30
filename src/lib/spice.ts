import type { Category, MenuItem } from '../types/database';

// Schärfegrad einer Position (order_items.spice_level, siehe schema.sql): 1-3 Chilis,
// null/0 = nicht scharf. Wählbar nur bei Hauptspeisen (Suppen, Warme Speisen, Ramen,
// Nudeln) — nicht bei Vorspeisen, BBQ, der Bar oder "Diverses"-Freitextposten.
export const MAX_SPICE_LEVEL = 3;

export function supportsSpiceLevel(item: MenuItem, category: Category): boolean {
  return (
    category.target_device === 'kitchen' &&
    category.kitchen_station === 'hauptspeise' &&
    !category.is_discount &&
    !item.is_custom_entry
  );
}

// "🌶️🌶️" — leerer String bei nicht scharf, damit Aufrufer einfach anhängen können.
export function spiceEmojis(level: number | null | undefined): string {
  if (!level || level <= 0) return '';
  return '🌶️'.repeat(Math.min(level, MAX_SPICE_LEVEL));
}

// " · 🌶️🌶️" zum Anhängen an eine Gerichtszeile, sonst ''.
export function spiceSuffix(level: number | null | undefined): string {
  const emojis = spiceEmojis(level);
  return emojis ? ` · ${emojis}` : '';
}
