import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Category, MenuItem } from '../types/database';

export interface CategoryWithItems extends Category {
  items: MenuItem[];
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
