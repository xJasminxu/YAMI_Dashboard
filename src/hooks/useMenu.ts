import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Category, MenuItem } from '../types/database';

export interface CategoryWithItems extends Category {
  items: MenuItem[];
}

// Sortiert die Items einer Kategorie nach ihrem Item-Code in "natürlicher" Reihenfolge
// (R1, R2, ..., R10 statt lexikografisch R1, R10, R2, ...) statt sich auf die
// DB-Einfüge-Reihenfolge (created_at) zu verlassen — die spiegelt nur wider, wann ein
// Item zuletzt (neu) angelegt wurde, nicht die gewünschte Speisekarten-Reihenfolge (z.B.
// wenn ein Ramen-Item nachträglich bearbeitet oder ein Item erst später ergänzt wurde,
// stand es plötzlich nicht mehr an seiner R1..R6-Position). Items ohne Code (z.B.
// Getränke) behalten ihre bisherige (created_at-)Reihenfolge und landen hinter allen
// codierten Items derselben Kategorie.
function compareItemCode(a: MenuItem, b: MenuItem): number {
  if (!a.item_code && !b.item_code) return 0;
  if (!a.item_code) return 1;
  if (!b.item_code) return -1;

  const aMatch = a.item_code.match(/^([A-Za-z]*)(\d*)/);
  const bMatch = b.item_code.match(/^([A-Za-z]*)(\d*)/);
  const aLetters = aMatch?.[1] ?? '';
  const bLetters = bMatch?.[1] ?? '';
  if (aLetters !== bLetters) return aLetters.localeCompare(bLetters);

  const aNum = aMatch?.[2] ? parseInt(aMatch[2], 10) : NaN;
  const bNum = bMatch?.[2] ? parseInt(bMatch[2], 10) : NaN;
  if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) return aNum - bNum;

  return a.item_code.localeCompare(b.item_code);
}

// Lädt aktive Menü-Items gruppiert nach Kategorie, für die Bestellaufnahme.
// Statisch genug, um einmalig zu laden statt per Realtime-Subscription.
export function useMenu() {
  const [categories, setCategories] = useState<CategoryWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [categoriesRes, itemsRes] = await Promise.all([
        supabase.from('categories').select('*').order('sort_order', { ascending: true }),
        supabase.from('menu_items').select('*').eq('active', true).order('created_at', { ascending: true }),
      ]);

      if (cancelled) return;

      if (categoriesRes.error || itemsRes.error) {
        setError(categoriesRes.error?.message ?? itemsRes.error?.message ?? 'Unbekannter Fehler');
        setLoading(false);
        return;
      }

      const itemsByCategory = new Map<string, MenuItem[]>();
      for (const item of itemsRes.data as MenuItem[]) {
        const list = itemsByCategory.get(item.category_id) ?? [];
        list.push(item);
        itemsByCategory.set(item.category_id, list);
      }
      for (const list of itemsByCategory.values()) {
        list.sort(compareItemCode);
      }

      setCategories(
        (categoriesRes.data as Category[]).map((category) => ({
          ...category,
          items: itemsByCategory.get(category.id) ?? [],
        }))
      );
      setError(null);
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { categories, loading, error };
}
