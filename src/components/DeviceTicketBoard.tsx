import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useDeviceOrders, type GroupedOrder } from '../hooks/useDeviceOrders';
import { useNewOrderChime } from '../hooks/useNewOrderChime';
import type { TargetDevice } from '../types/database';
import type { ThemeColors } from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';
import { useThemedStyles } from '../theme/useThemedStyles';

type Tab = 'offen' | 'fertig';

// neu = noch nichts abgehakt, angefangen = teilweise fertig, fertig = alles abgehakt.
type OrderProgress = 'neu' | 'angefangen' | 'fertig';

function progressFor(order: GroupedOrder): OrderProgress {
  const doneCount = order.items.filter((item) => item.status === 'fertig').length;
  if (doneCount === 0) return 'neu';
  if (doneCount === order.items.length) return 'fertig';
  return 'angefangen';
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function cardBackgroundFor(colors: ThemeColors): Record<OrderProgress, object> {
  return {
    neu: { backgroundColor: colors.cardNeu },
    angefangen: { backgroundColor: colors.cardAngefangen },
    fertig: { backgroundColor: colors.cardFertig },
  };
}

// large: größere Karten/Schrift für Geräte, die aus Distanz gelesen werden
// müssen (z.B. iPad in der Küche, wo die Köche verteilt am Pass stehen).
export default function DeviceTicketBoard({
  targetDevice,
  large = false,
}: {
  targetDevice: TargetDevice;
  large?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const cardBackground = useMemo(() => cardBackgroundFor(colors), [colors]);
  const { orders, loading, error, setItemStatus } = useDeviceOrders(targetDevice);
  const [tab, setTab] = useState<Tab>('offen');
  // Standardmäßig an — Köche/Bar können den Ton per Glocken-Button stumm
  // schalten (z.B. während einer Pause). Zustand ist rein lokal (pro
  // Bildschirm/App-Start), keine Persistierung in v1.
  const [soundEnabled, setSoundEnabled] = useState(true);
  useNewOrderChime(orders, soundEnabled);

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
        <View style={styles.tabsRow}>
          <TouchableOpacity style={[styles.tab, tab === 'offen' && styles.tabActive]} onPress={() => setTab('offen')}>
            <Text style={[styles.tabText, tab === 'offen' && styles.tabTextActive]}>Offen ({open.length})</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tab, tab === 'fertig' && styles.tabActive]} onPress={() => setTab('fertig')}>
            <Text style={[styles.tabText, tab === 'fertig' && styles.tabTextActive]}>
              Vergangene Bestellungen ({done.length})
            </Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={[styles.bellButton, large && styles.bellButtonLarge]}
          onPress={() => setSoundEnabled((v) => !v)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={[styles.bellButtonText, large && styles.bellButtonTextLarge]}>
            {soundEnabled ? '🔔' : '🔕'}
          </Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={visibleOrders}
        keyExtractor={(order) => order.orderId}
        contentContainerStyle={[styles.listContent, large && styles.listContentLarge]}
        renderItem={({ item: order }) => (
          <View style={[styles.card, large && styles.cardLarge, cardBackground[progressFor(order)]]}>
            <View style={styles.cardHeader}>
              <Text style={[styles.tableLabel, large && styles.tableLabelLarge]}>Tisch {order.table.number}</Text>
              <Text style={[styles.timeLabel, large && styles.timeLabelLarge]}>{formatTime(order.createdAt)}</Text>
            </View>
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

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
    errorText: { color: colors.danger, padding: 16 },
    tabBar: {
      flexDirection: 'row',
      alignItems: 'center',
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    tabsRow: { flex: 1, flexDirection: 'row' },
    tab: { flex: 1, paddingVertical: 14, alignItems: 'center' },
    tabActive: { borderBottomWidth: 3, borderBottomColor: colors.text },
    tabText: { fontSize: 15, color: colors.textMuted },
    tabTextActive: { color: colors.text, fontWeight: '700' },
    bellButton: { paddingHorizontal: 14, paddingVertical: 10 },
    bellButtonLarge: { paddingHorizontal: 18, paddingVertical: 14 },
    bellButtonText: { fontSize: 22 },
    bellButtonTextLarge: { fontSize: 32 },
    listContent: { padding: 12, gap: 12 },
    listContentLarge: { gap: 16 },
    card: {
      borderRadius: 12,
      padding: 14,
      marginBottom: 12,
    },
    cardLarge: { padding: 20, borderRadius: 16 },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      marginBottom: 8,
      gap: 8,
    },
    tableLabel: { fontSize: 18, fontWeight: '700', color: colors.text },
    tableLabelLarge: { fontSize: 28 },
    timeLabel: { fontSize: 13, color: colors.textMuted, fontWeight: '600' },
    timeLabelLarge: { fontSize: 18 },
    itemRow: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border },
    itemRowLarge: { paddingVertical: 14 },
    itemHanzi: { fontSize: 18, fontWeight: '600', color: colors.text },
    itemHanziLarge: { fontSize: 28 },
    itemDe: { fontSize: 13, color: colors.textMuted },
    itemDeLarge: { fontSize: 19 },
    itemExtras: { fontSize: 12, color: colors.textSecondary, marginTop: 2, fontStyle: 'italic' },
    itemExtrasLarge: { fontSize: 17, marginTop: 4 },
    itemNote: { fontSize: 12, color: colors.warning, marginTop: 2, fontWeight: '700' },
    itemNoteLarge: { fontSize: 17, marginTop: 4 },
    itemDone: { textDecorationLine: 'line-through', color: colors.textFaint },
    emptyText: { textAlign: 'center', color: colors.textFaint, marginTop: 32 },
  });
