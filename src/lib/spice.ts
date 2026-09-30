import type { Category, MenuItem } from '../types/database';

// Schärfegrad einer Position (order_items.spice_level, siehe schema.sql): 1 = mild,
// 2 = scharf, 3 = sehr scharf, null = nicht scharf. Einstellbar nur in der aufklappbaren
// Bestellübersicht (Warenkorb, OrderScreen.tsx) und nur bei Hauptspeisen (Suppen, Warme
// Speisen, Ramen, Nudeln) — nicht bei Vorspeisen, BBQ, der Bar oder "Diverses".
export const SPICE_LEVELS = [1, 2, 3] as const;

export const SPICE_LABELS: Record<number, { de: string; zh: string }> = {
  1: { de: 'Mild', zh: '微辣' },
  2: { de: 'Scharf', zh: '辣' },
  3: { de: 'Sehr scharf', zh: '特辣' },
};

export function supportsSpiceLevel(item: MenuItem, category: Category): boolean {
  return (
    category.target_device === 'kitchen' &&
    category.kitchen_station === 'hauptspeise' &&
    !category.is_discount &&
    !item.is_custom_entry
  );
}

export function spiceEmojis(level: number | null | undefined): string {
  if (!level || !SPICE_LABELS[level]) return '';
  return '🌶️'.repeat(level);
}

// " · 🌶️🌶️ 辣" zum Anhängen an eine Gerichtszeile, sonst ''.
export function spiceSuffix(level: number | null | undefined, lang: 'de' | 'zh'): string {
  if (!level || !SPICE_LABELS[level]) return '';
  return ` · ${spiceEmojis(level)} ${SPICE_LABELS[level][lang]}`;
}
