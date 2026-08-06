import { useMemo } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useDeviceOrders } from '../../hooks/useDeviceOrders';
import type { DeviceOrderItem } from '../../hooks/useDeviceOrders';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'TableDetail'>;

// Bestellübersicht für einen Tisch: fasst Küche + Bar zusammen (über evtl.
// mehrere Bestellungen/Nachbestellungen hinweg), live über dieselben
// Realtime-Subscriptions wie die Küchen-/Bar-Ansichten.
export default function TableDetailScreen({ route }: Props) {
  const { tableNumber } = route.params;
  const kitchen = useDeviceOrders('kitchen');
  const bar = useDeviceOrders('bar');

  const kitchenItems = useMemo(
    () => collectItemsForTable(kitchen.orders, tableNumber),
    [kitchen.orders, tableNumber]
  );
  const barItems = useMemo(() => collectItemsForTable(bar.orders, tableNumber), [bar.orders, tableNumber]);

  if (kitchen.loading || bar.loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  const loadError = kitchen.error ?? bar.error;
  if (loadError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Bestellung konnte nicht geladen werden: {loadError}</Text>
      </View>
    );
  }

  const totalItems = kitchenItems.length + barItems.length;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Tisch {tableNumber}</Text>

      {totalItems === 0 && <Text style={styles.emptyText}>Keine offenen Positionen für diesen Tisch.</Text>}

      {kitchenItems.length > 0 && <ItemSection title="Küche" items={kitchenItems} />}
      {barItems.length > 0 && <ItemSection title="Bar" items={barItems} />}
    </ScrollView>
  );
}

function collectItemsForTable(orders: { table: { number: number }; items: DeviceOrderItem[] }[], tableNumber: number) {
  return orders
    .filter((order) => order.table.number === tableNumber)
    .flatMap((order) => order.items)
    .sort((a, b) => a.menu_item.category.sort_order - b.menu_item.category.sort_order);
}

function ItemSection({ title, items }: { title: string; items: DeviceOrderItem[] }) {
  const open = items.filter((item) => item.status === 'offen');
  const done = items.filter((item) => item.status === 'fertig');

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>
        {title} — {done.length}/{items.length} fertig
      </Text>
      {open.map((item) => (
        <ItemRow key={item.id} item={item} />
      ))}
      {done.map((item) => (
        <ItemRow key={item.id} item={item} />
      ))}
    </View>
  );
}

function ItemRow({ item }: { item: DeviceOrderItem }) {
  const isDone = item.status === 'fertig';
  return (
    <View style={styles.itemRow}>
      <Text style={[styles.itemHanzi, isDone && styles.itemDone]}>
        {item.menu_item.item_code ? `${item.menu_item.item_code} · ` : ''}
        {item.menu_item.name_hanzi}
        {item.variant_hanzi ? ` · ${item.variant_hanzi}` : ''}
      </Text>
      <Text style={[styles.itemDe, isDone && styles.itemDone]}>
        {item.menu_item.name_de}
        {item.variant_de ? ` · ${item.variant_de}` : ''}
      </Text>
      {item.extras && item.extras.length > 0 && (
        <Text style={[styles.itemExtras, isDone && styles.itemDone]}>
          {item.extras.map((e) => `+${e.quantity} ${e.name_hanzi} (${e.name_de})`).join(', ')}
        </Text>
      )}
      {item.note && <Text style={[styles.itemNote, isDone && styles.itemDone]}>Notiz: {item.note}</Text>}
      <Text style={[styles.itemStatus, isDone ? styles.itemStatusDone : styles.itemStatusOpen]}>
        {isDone ? 'fertig' : 'offen'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { color: '#b91c1c', padding: 16 },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 16 },
  emptyText: { color: '#9ca3af', marginTop: 16 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#374151', marginBottom: 8 },
  itemRow: {
    backgroundColor: '#f9fafb',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  itemHanzi: { fontSize: 17, fontWeight: '600' },
  itemDe: { fontSize: 13, color: '#6b7280' },
  itemExtras: { fontSize: 12, color: '#374151', marginTop: 2, fontStyle: 'italic' },
  itemNote: { fontSize: 12, color: '#b45309', marginTop: 2, fontWeight: '700' },
  itemDone: { textDecorationLine: 'line-through', color: '#9ca3af' },
  itemStatus: { fontSize: 11, fontWeight: '700', marginTop: 4, textTransform: 'uppercase' },
  itemStatusOpen: { color: '#b45309' },
  itemStatusDone: { color: '#16a34a' },
});
