import { useMemo } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useDeviceOrders } from '../../hooks/useDeviceOrders';
import type { DeviceOrderItem } from '../../hooks/useDeviceOrders';
import type { RootStackParamList } from '../../navigation/types';
import type { ThemeColors } from '../../theme/colors';
import { useThemedStyles } from '../../theme/useThemedStyles';

type Props = NativeStackScreenProps<RootStackParamList, 'TableDetail'>;
type TableDetailStyles = ReturnType<typeof createStyles>;

// Bestellübersicht für einen Tisch: fasst Küche + Bar zusammen (über evtl.
// mehrere Bestellungen/Nachbestellungen hinweg), live über dieselben
// Realtime-Subscriptions wie die Küchen-/Bar-Ansichten.
export default function TableDetailScreen({ route }: Props) {
  const styles = useThemedStyles(createStyles);
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

      {kitchenItems.length > 0 && <ItemSection title="Küche" items={kitchenItems} styles={styles} />}
      {barItems.length > 0 && <ItemSection title="Bar" items={barItems} styles={styles} />}
    </ScrollView>
  );
}

function collectItemsForTable(orders: { table: { number: number }; items: DeviceOrderItem[] }[], tableNumber: number) {
  return orders
    .filter((order) => order.table.number === tableNumber)
    .flatMap((order) => order.items)
    .sort((a, b) => a.menu_item.category.sort_order - b.menu_item.category.sort_order);
}

function ItemSection({
  title,
  items,
  styles,
}: {
  title: string;
  items: DeviceOrderItem[];
  styles: TableDetailStyles;
}) {
  const open = items.filter((item) => item.status === 'offen');
  const done = items.filter((item) => item.status === 'fertig');

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>
        {title} — {done.length}/{items.length} fertig
      </Text>
      {open.map((item) => (
        <ItemRow key={item.id} item={item} styles={styles} />
      ))}
      {done.map((item) => (
        <ItemRow key={item.id} item={item} styles={styles} />
      ))}
    </View>
  );
}

function ItemRow({ item, styles }: { item: DeviceOrderItem; styles: TableDetailStyles }) {
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

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16 },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
    errorText: { color: colors.danger, padding: 16 },
    title: { fontSize: 24, fontWeight: '700', marginBottom: 16, color: colors.text },
    emptyText: { color: colors.textFaint, marginTop: 16 },
    section: { marginBottom: 24 },
    sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.textSecondary, marginBottom: 8 },
    itemRow: {
      backgroundColor: colors.surface,
      borderRadius: 10,
      padding: 12,
      marginBottom: 8,
    },
    itemHanzi: { fontSize: 17, fontWeight: '600', color: colors.text },
    itemDe: { fontSize: 13, color: colors.textMuted },
    itemExtras: { fontSize: 12, color: colors.textSecondary, marginTop: 2, fontStyle: 'italic' },
    itemNote: { fontSize: 12, color: colors.warning, marginTop: 2, fontWeight: '700' },
    itemDone: { textDecorationLine: 'line-through', color: colors.textFaint },
    itemStatus: { fontSize: 11, fontWeight: '700', marginTop: 4, textTransform: 'uppercase' },
    itemStatusOpen: { color: colors.warning },
    itemStatusDone: { color: colors.success },
  });
