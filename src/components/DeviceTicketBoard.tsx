import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useDeviceOrders, type GroupedOrder } from '../hooks/useDeviceOrders';
import { useNewOrderChime } from '../hooks/useNewOrderChime';
import type { KitchenStation, OrderItemStatus, TargetDevice } from '../types/database';
import type { ThemeColors } from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';
import { useThemedStyles } from '../theme/useThemedStyles';

type Tab = 'offen' | 'fertig';
type BoardStyles = ReturnType<typeof createStyles>;

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

// Reduziert jede Bestellung auf die Positionen, die zu einer der übergebenen Küchen-
// Stationen gehören (categories.kitchen_station) — Bestellungen ohne passende Position
// fallen ganz raus. So zeigt jede Spalte der Zwei-Spalten-Ansicht nur ihre eigenen
// Karten (mit eigenem Fortschritt/Farbe), statt dass eine große Hauptspeise-Bestellung
// die Vorspeisen einer neu eingegangenen Bestellung unter sich begräbt.
function itemsForStations(orders: GroupedOrder[], stations: KitchenStation[]): GroupedOrder[] {
  return orders
    .map((order) => ({
      ...order,
      items: order.items.filter((item) =>
        stations.includes(item.menu_item.category.kitchen_station ?? 'hauptspeise')
      ),
    }))
    .filter((order) => order.items.length > 0);
}

function countOpenItems(orders: GroupedOrder[]): number {
  return orders.reduce((sum, order) => sum + order.items.filter((item) => item.status === 'offen').length, 0);
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

  // Die Vorspeise/Hauptspeise-Spaltenaufteilung ist nur für die Küche sinnvoll (die Bar
  // hat keine kitchen_station-Werte) und nur für den "Offen"-Tab — die "Fertig"-Historie
  // bleibt eine einfache Liste, da dort keine Eile mehr besteht.
  const showStationColumns = targetDevice === 'kitchen' && tab === 'offen';

  const { vorspeiseOrders, mainsOrders } = useMemo(() => {
    if (!showStationColumns) return { vorspeiseOrders: [] as GroupedOrder[], mainsOrders: [] as GroupedOrder[] };
    return {
      vorspeiseOrders: itemsForStations(open, ['vorspeise']),
      mainsOrders: itemsForStations(open, ['hauptspeise', 'barbecue']),
    };
  }, [open, showStationColumns]);

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

      {showStationColumns ? (
        <View style={styles.stationRow}>
          <View style={styles.stationColumn}>
            <StationHeader title="Vorspeise" openCount={countOpenItems(vorspeiseOrders)} large={large} styles={styles} />
            <TicketList
              orders={vorspeiseOrders}
              large={large}
              styles={styles}
              cardBackground={cardBackground}
              onToggleItem={setItemStatus}
              emptyText="Keine offenen Vorspeisen."
            />
          </View>
          <View style={styles.stationDivider} />
          <View style={styles.stationColumn}>
            <StationHeader
              title="Hauptspeise & Barbecue"
              openCount={countOpenItems(mainsOrders)}
              large={large}
              styles={styles}
            />
            <TicketList
              orders={mainsOrders}
              large={large}
              styles={styles}
              cardBackground={cardBackground}
              onToggleItem={setItemStatus}
              emptyText="Keine offenen Hauptspeisen."
            />
          </View>
        </View>
      ) : (
        <TicketList
          orders={visibleOrders}
          large={large}
          styles={styles}
          cardBackground={cardBackground}
          onToggleItem={setItemStatus}
          emptyText={tab === 'offen' ? 'Keine offenen Bestellungen.' : 'Noch keine erledigten Bestellungen.'}
        />
      )}
    </View>
  );
}

function StationHeader({
  title,
  openCount,
  large,
  styles,
}: {
  title: string;
  openCount: number;
  large: boolean;
  styles: BoardStyles;
}) {
  return (
    <View style={styles.stationHeader}>
      <Text style={[styles.stationHeaderText, large && styles.stationHeaderTextLarge]}>{title}</Text>
      <Text style={[styles.stationHeaderCount, large && styles.stationHeaderCountLarge]}>{openCount} offen</Text>
    </View>
  );
}

// Eine Spalte Bestellkarten — dieselbe Karten-Darstellung wird sowohl für die normale
// Einzel-Liste (Bar, Küchen-"Fertig"-Tab) als auch für jede der beiden Küchen-Stations-
// Spalten verwendet, damit Kartenlayout/-verhalten überall identisch bleiben.
function TicketList({
  orders,
  large,
  styles,
  cardBackground,
  onToggleItem,
  emptyText,
}: {
  orders: GroupedOrder[];
  large: boolean;
  styles: BoardStyles;
  cardBackground: Record<OrderProgress, object>;
  onToggleItem: (itemId: string, status: OrderItemStatus) => void;
  emptyText: string;
}) {
  return (
    <FlatList
      data={orders}
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
              onPress={() => onToggleItem(item.id, item.status === 'offen' ? 'fertig' : 'offen')}
            >
              {item.menu_item.name_hanzi ? (
                <>
                  <Text
                    style={[styles.itemHanzi, large && styles.itemHanziLarge, item.status === 'fertig' && styles.itemDone]}
                  >
                    {item.menu_item.item_code ? `${item.menu_item.item_code} · ` : ''}
                    {item.menu_item.name_hanzi}
                    {item.variant_hanzi ? ` · ${item.variant_hanzi}` : ''}
                  </Text>
                  <Text style={[styles.itemDe, large && styles.itemDeLarge, item.status === 'fertig' && styles.itemDone]}>
                    {item.menu_item.name_de}
                    {item.variant_de ? ` · ${item.variant_de}` : ''}
                  </Text>
                </>
              ) : (
                // Bar-Items haben kein Hanzi (an der Bar wird auf Deutsch gearbeitet) —
                // deutschen Namen dann in der großen/fetten Zeile zeigen statt einer leeren
                // Hanzi-Zeile über einem winzigen deutschen Namen darunter.
                <Text
                  style={[styles.itemHanzi, large && styles.itemHanziLarge, item.status === 'fertig' && styles.itemDone]}
                >
                  {item.menu_item.item_code ? `${item.menu_item.item_code} · ` : ''}
                  {item.menu_item.name_de}
                  {item.variant_de ? ` · ${item.variant_de}` : ''}
                </Text>
              )}
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
      ListEmptyComponent={<Text style={styles.emptyText}>{emptyText}</Text>}
    />
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
    // Zwei-Spalten-Ansicht für die Küche (Vorspeise | Hauptspeise+Barbecue), jede
    // Spalte unabhängig scrollbar, damit eine große Hauptspeise-Bestellung nicht mehr
    // die Vorspeisen einer neuen Bestellung von der Küche wegscrollt.
    stationRow: { flex: 1, flexDirection: 'row' },
    stationColumn: { flex: 1 },
    stationDivider: { width: 1, backgroundColor: colors.border },
    stationHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      paddingHorizontal: 12,
      paddingTop: 10,
    },
    stationHeaderText: { fontSize: 15, fontWeight: '700', color: colors.text },
    stationHeaderTextLarge: { fontSize: 20 },
    stationHeaderCount: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
    stationHeaderCountLarge: { fontSize: 16 },
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
