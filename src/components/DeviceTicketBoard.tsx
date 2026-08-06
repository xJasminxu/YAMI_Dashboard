import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useDeviceOrders, type GroupedOrder } from '../hooks/useDeviceOrders';
import type { TargetDevice } from '../types/database';

type Tab = 'offen' | 'fertig';

// neu = noch nichts abgehakt, angefangen = teilweise fertig, fertig = alles abgehakt.
type OrderProgress = 'neu' | 'angefangen' | 'fertig';

function progressFor(order: GroupedOrder): OrderProgress {
  const doneCount = order.items.filter((item) => item.status === 'fertig').length;
  if (doneCount === 0) return 'neu';
  if (doneCount === order.items.length) return 'fertig';
  return 'angefangen';
}

const CARD_BACKGROUND: Record<OrderProgress, object> = {
  neu: { backgroundColor: '#dbeafe' }, // pastell blau
  angefangen: { backgroundColor: '#fde2ea' }, // pastell rosa
  fertig: { backgroundColor: '#dcfce7' }, // pastell grün
};

// large: größere Karten/Schrift für Geräte, die aus Distanz gelesen werden
// müssen (z.B. iPad in der Küche, wo die Köche verteilt am Pass stehen).
export default function DeviceTicketBoard({
  targetDevice,
  large = false,
}: {
  targetDevice: TargetDevice;
  large?: boolean;
}) {
  const { orders, loading, error, setItemStatus } = useDeviceOrders(targetDevice);
  const [tab, setTab] = useState<Tab>('offen');

  const { open, done } = useMemo(() => {
    const open = orders.filter((order) => order.items.some((item) => item.status === 'offen'));
    const done = orders.filter((order) => order.items.every((item) => item.status === 'fertig'));
    return { open, done };
  }, [orders]);

  const visibleOrders = tab === 'offen' ? open : done;

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Bestellungen konnten nicht geladen werden: {error}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.tabBar}>
        <TouchableOpacity style={[styles.tab, tab === 'offen' && styles.tabActive]} onPress={() => setTab('offen')}>
          <Text style={[styles.tabText, tab === 'offen' && styles.tabTextActive]}>Offen ({open.length})</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === 'fertig' && styles.tabActive]} onPress={() => setTab('fertig')}>
          <Text style={[styles.tabText, tab === 'fertig' && styles.tabTextActive]}>
            Vergangene Bestellungen ({done.length})
          </Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={visibleOrders}
        keyExtractor={(order) => order.orderId}
        contentContainerStyle={[styles.listContent, large && styles.listContentLarge]}
        renderItem={({ item: order }) => (
          <View style={[styles.card, large && styles.cardLarge, CARD_BACKGROUND[progressFor(order)]]}>
            <Text style={[styles.tableLabel, large && styles.tableLabelLarge]}>Tisch {order.table.number}</Text>
            {order.items.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={[styles.itemRow, large && styles.itemRowLarge]}
                onPress={() => setItemStatus(item.id, item.status === 'offen' ? 'fertig' : 'offen')}
              >
                <Text style={[styles.itemHanzi, large && styles.itemHanziLarge, item.status === 'fertig' && styles.itemDone]}>
                  {item.menu_item.item_code ? `${item.menu_item.item_code} · ` : ''}
                  {item.menu_item.name_hanzi}
                  {item.variant_hanzi ? ` · ${item.variant_hanzi}` : ''}
                </Text>
                <Text style={[styles.itemDe, large && styles.itemDeLarge, item.status === 'fertig' && styles.itemDone]}>
                  {item.menu_item.name_de}
                  {item.variant_de ? ` · ${item.variant_de}` : ''}
                </Text>
                {item.extras && item.extras.length > 0 && (
                  <Text
                    style={[styles.itemExtras, large && styles.itemExtrasLarge, item.status === 'fertig' && styles.itemDone]}
                  >
                    {item.extras.map((e) => `+${e.quantity} ${e.name_hanzi} (${e.name_de})`).join(', ')}
                  </Text>
                )}
                {item.note && (
                  <Text
                    style={[styles.itemNote, large && styles.itemNoteLarge, item.status === 'fertig' && styles.itemDone]}
                  >
                    Notiz: {item.note}
                  </Text>
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            {tab === 'offen' ? 'Keine offenen Bestellungen.' : 'Noch keine erledigten Bestellungen.'}
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { color: '#b91c1c', padding: 16 },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  tab: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  tabActive: { borderBottomWidth: 3, borderBottomColor: '#1f2937' },
  tabText: { fontSize: 15, color: '#6b7280' },
  tabTextActive: { color: '#1f2937', fontWeight: '700' },
  listContent: { padding: 12, gap: 12 },
  listContentLarge: { gap: 16 },
  card: {
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  cardLarge: { padding: 20, borderRadius: 16 },
  tableLabel: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  tableLabelLarge: { fontSize: 28, marginBottom: 12 },
  itemRow: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  itemRowLarge: { paddingVertical: 14 },
  itemHanzi: { fontSize: 18, fontWeight: '600' },
  itemHanziLarge: { fontSize: 70 },
  itemDe: { fontSize: 13, color: '#6b7280' },
  itemDeLarge: { fontSize: 19 },
  itemExtras: { fontSize: 12, color: '#374151', marginTop: 2, fontStyle: 'italic' },
  itemExtrasLarge: { fontSize: 17, marginTop: 4 },
  itemNote: { fontSize: 12, color: '#b45309', marginTop: 2, fontWeight: '700' },
  itemNoteLarge: { fontSize: 25, marginTop: 4 },
  itemDone: { textDecorationLine: 'line-through', color: '#9ca3af' },
  emptyText: { textAlign: 'center', color: '#9ca3af', marginTop: 32 },
});
