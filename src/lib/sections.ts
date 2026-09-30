import type { DeviceOrderItem } from '../hooks/useDeviceOrders';
import type { Language } from '../i18n/LanguageContext';

// Gemeinsame Aufteilung für Status-Ansicht und Tisch-Detail (StatusScreen.tsx,
// TableDetailScreen.tsx): Küche nach Station (categories.kitchen_station, wie in
// DeviceTicketBoard.tsx), Bar nach menu_group. Reihenfolge = Reihenfolge im Service.
export type Section = 'vorspeise' | 'hauptspeise' | 'barbecue' | 'getraenke' | 'nachspeisen';

export const SECTIONS: Section[] = ['vorspeise', 'hauptspeise', 'barbecue', 'getraenke', 'nachspeisen'];

export const SECTION_META: Record<Section, { icon: string; label: string; hanzi: string }> = {
  vorspeise: { icon: '🥟', label: 'Vorspeise', hanzi: '小吃' },
  hauptspeise: { icon: '🍜', label: 'Hauptspeise', hanzi: '主食' },
  barbecue: { icon: '🥩', label: 'BBQ', hanzi: '烤肉' },
  getraenke: { icon: '🍹', label: 'Getränke', hanzi: '饮料' },
  nachspeisen: { icon: '🍨', label: 'Nachspeisen', hanzi: '甜点' },
};

// Bereichsname in der gewählten Sprache — Getränke/Nachspeisen gehören zur Bar und
// bleiben immer Deutsch.
export function sectionLabel(section: Section, lang: Language): string {
  if (lang === 'zh' && section !== 'getraenke' && section !== 'nachspeisen') return SECTION_META[section].hanzi;
  return SECTION_META[section].label;
}

export function sectionFor(item: DeviceOrderItem): Section {
  const category = item.menu_item.category;
  if (category.target_device === 'bar') {
    return category.menu_group === 'nachspeisen' ? 'nachspeisen' : 'getraenke';
  }
  // Fehlende kitchen_station → Hauptspeise, wie in DeviceTicketBoard.tsx.
  return category.kitchen_station ?? 'hauptspeise';
}

// Gleiche Portionen zusammenfassen ("3× Gyoza") — gleiches Gericht, Variante, Extras und
// Notiz (analog groupItems in DeviceTicketBoard.tsx, dort zusätzlich nach Status).
export interface ItemGroup {
  key: string;
  item: DeviceOrderItem;
  count: number;
}

export function groupItems(items: DeviceOrderItem[]): ItemGroup[] {
  const groups = new Map<string, ItemGroup>();
  for (const item of items) {
    const extrasKey = (item.extras ?? [])
      .map((e) => `${e.name_de}x${e.quantity}`)
      .sort()
      .join('|');
    const key = [item.menu_item.id, item.variant_de ?? '', extrasKey, item.note ?? '', item.status].join('::');
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, { key, item, count: 1 });
  }
  return Array.from(groups.values());
}

// "R1 · 豚骨拉面 · Rind" bzw. bei Bar-Items ohne Hanzi der deutsche Name.
export function dishLabel(item: DeviceOrderItem): string {
  const { name_hanzi, name_de, item_code } = item.menu_item;
  const code = item_code ? `${item_code} · ` : '';
  const variant = item.variant_hanzi ?? item.variant_de;
  return `${code}${name_hanzi ?? name_de}${variant ? ` · ${variant}` : ''}`;
}

export function minutesSince(iso: string, now: number): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
}
