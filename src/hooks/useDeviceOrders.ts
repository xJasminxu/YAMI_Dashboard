import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Category, MenuItem, OrderItem, RestaurantTable, TargetDevice } from '../types/database';

export interface DeviceOrderItem extends OrderItem {
  menu_item: MenuItem & { category: Category };
}

interface OrderItemRow extends OrderItem {
  order: { id: string; table_id: string; created_at: string; table: RestaurantTable };
  menu_item: MenuItem & { category: Category };
}

export interface GroupedOrder {
  orderId: string;
  table: RestaurantTable;
  createdAt: string;
  items: DeviceOrderItem[];
}

// Lädt offene + fertige order_items für ein Gerät (kitchen/bar), gruppiert nach
// Bestellung/Tisch und sortiert nach Kategorie-sort_order. Hält sich per
// Realtime-Subscription auf order_items aktuell (Refetch bei jeder Änderung —
// die Datenmenge ist klein genug, dass das kein Performance-Problem ist).
export function useDeviceOrders(targetDevice: TargetDevice) {
  const [orders, setOrders] = useState<GroupedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Mehrere Screens (Status, TableDetail, Tischübersicht, TableBilling, ...)
  // können denselben Hook gleichzeitig für dasselbe Gerät mounten. Jede
  // Instanz braucht einen eigenen Realtime-Channel-Namen, sonst wirft
  // Supabase "cannot add 'postgres_changes' callbacks ... after subscribe()",
  // weil zwei Channels mit identischem Topic-Namen gleichzeitig existieren.
  const instanceId = useRef(Math.random().toString(36).slice(2)).current;

  const fetchOrders = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from('order_items')
      .select(
        `
        id, order_id, menu_item_id, status, variant_hanzi, variant_de, extras, unit_price, note, created_at, done_at,
        order:orders!inner(id, table_id, created_at, table:tables(id, number)),
        menu_item:menu_items!inner(
          id, category_id, name_hanzi, name_de, item_code, active, price, created_at,
          category:categories!inner(id, name_hanzi, name_de, menu_group, target_device, sort_order, kitchen_station, created_at)
        )
        `
      )
      .eq('menu_item.category.target_device', targetDevice)
      .order('created_at', { ascending: true })
      .returns<OrderItemRow[]>();

    if (fetchError) {
      setError(fetchError.message);
      setLoading(false);
      return;
    }

    const byOrder = new Map<string, GroupedOrder>();
    for (const row of data ?? []) {
      const { order, ...item } = row;
      let group = byOrder.get(order.id);
      if (!group) {
        group = { orderId: order.id, table: order.table, createdAt: order.created_at, items: [] };
        byOrder.set(order.id, group);
      }
      group.items.push(item);
    }

    for (const group of byOrder.values()) {
      group.items.sort((a, b) => a.menu_item.category.sort_order - b.menu_item.category.sort_order);
    }

    setOrders(Array.from(byOrder.values()));
    setError(null);
    setLoading(false);
  }, [targetDevice]);

  useEffect(() => {
    setLoading(true);
    fetchOrders();

    const channel = supabase
      .channel(`order_items:${targetDevice}:${instanceId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => {
        fetchOrders();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [targetDevice, fetchOrders]);

  const setItemStatus = useCallback(async (itemId: string, status: 'offen' | 'fertig') => {
    await supabase
      .from('order_items')
      .update({ status, done_at: status === 'fertig' ? new Date().toISOString() : null })
      .eq('id', itemId);
  }, []);

  return { orders, loading, error, setItemStatus, refetch: fetchOrders };
}
