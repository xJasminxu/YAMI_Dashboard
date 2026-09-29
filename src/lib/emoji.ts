import type { MenuGroup } from '../types/database';

// Rein dekorative Emojis für die Bestellaufnahme. Zuordnung über categories.name_de
// (kleingeschrieben, siehe seed.sql) — unbekannte/neue Kategorien bekommen einfach das
// Fallback-Emoji ihrer menu_group, es muss also nichts in der DB gepflegt werden.
const CATEGORY_EMOJIS: Record<string, string> = {
  kleinigkeiten: '🥟',
  suppen: '🍲',
  'fried chicken': '🍗',
  'warme speisen': '🍛',
  ramen: '🍜',
  nudeln: '🍝',
  'korean bbq': '🥩',
  'diverses essen': '🍽️',
  'alkoholfreie getränke': '🥤',
  bier: '🍺',
  cocktails: '🍸',
  spirituosen: '🥃',
  wein: '🍷',
  'kaffee/tee/matcha': '🍵',
  'diverses getränke': '🧃',
  'mochi eis': '🍡',
  eis: '🍨',
  eisschnee: '🍧',
};

export const MENU_GROUP_EMOJIS: Record<MenuGroup, string> = {
  essen: '🍜',
  getraenke: '🥤',
  nachspeisen: '🍨',
};

export function categoryEmoji(nameDe: string, group: MenuGroup): string {
  return CATEGORY_EMOJIS[nameDe.trim().toLowerCase()] ?? MENU_GROUP_EMOJIS[group];
}

// Kategorie-Namen stehen in der DB kleingeschrieben ("fried chicken") — für die Anzeige
// jedes Wort groß beginnen lassen ("Fried Chicken", "Kaffee/Tee/Matcha").
export function titleCase(text: string): string {
  return text
    .replace(/(^|[\s/])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase())
    .replace(/\bBbq\b/g, 'BBQ');
}
