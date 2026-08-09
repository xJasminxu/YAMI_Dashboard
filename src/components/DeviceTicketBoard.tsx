import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useDeviceOrders, type GroupedOrder } from '../hooks/useDeviceOrders';
import { useNewOrderChime } from '../hooks/useNewOrderChime';
import type { KitchenStation, OrderItemStatus, TargetDevice } from '../types/database';
import type { ThemeColors } from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';
import { useThemedStyles } from '../theme/useThemedStyles';

type Tab = 'offen' | 'fertig';
type BoardStyles = ReturnType<typeof createStyles>;

// Zeigt sich, wenn im "Offen"-Tab (Küche oder Bar) gerade nichts zu tun ist — links
// der Spruch, rechts das Bild, siehe EmptyBoardBanner unten.
const IMPATIENT_HONGBIN = require('../../assets/impatient_hongbin.png');

// Eigener Key pro Gerät (Küche/Bar), falls dasselbe Tablet doch mal die Rolle wechselt —
// die Stumm-Einstellung der Küche soll dann nicht ungefragt auch für die Bar gelten.
function soundEnabledStorageKey(targetDevice: TargetDevice) {
  return `yami:sound-enabled:${targetDevice}`;
}

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
  const { orders, loading, error, setItemStatus, setItemsStatus } = useDeviceOrders(targetDevice);
  const [tab, setTab] = useState<Tab>('offen');
  // Standardmäßig an — Küche/Bar können den Ton per Glocken-Button stumm schalten
  // (z.B. während einer Pause). Wird in AsyncStorage gemerkt, damit die Einstellung
  // erhalten bleibt, wenn die App in den Hintergrund/Task-Wechsel geht oder neu
  // startet, statt bei jedem Neu-Mounten wieder auf "an" zurückzuspringen.
  const [soundEnabled, setSoundEnabled] = useState(true);
  useNewOrderChime(orders, soundEnabled, targetDevice === 'kitchen');

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(soundEnabledStorageKey(targetDevice)).then((stored) => {
      if (!cancelled && stored !== null) setSoundEnabled(stored === '1');
    });
    return () => {
      cancelled = true;
    };
  }, [targetDevice]);

  function toggleSound() {
    setSoundEnabled((prev) => {
      const next = !prev;
      AsyncStorage.setItem(soundEnabledStorageKey(targetDevice), next ? '1' : '0');
      return next;
    });
  }

  // Hakt alle noch offenen Positionen einer Karte auf einmal ab (X-Button oder
  // Wisch-Geste, siehe TicketList) statt jedes Item einzeln antippen zu müssen — z.B.
  // wenn die Bedienung mündlich Bescheid gibt, dass ein Tisch storniert wurde, oder die
  // Küche eine ganze Bestellung im selben Moment fertigstellt. Bereits fertige Items in
  // der Karte werden nicht angefasst, damit ihr done_at-Zeitstempel nicht überschrieben
  // wird.
  function completeOrder(order: GroupedOrder) {
    const openItemIds = order.items.filter((item) => item.status === 'offen').map((item) => item.id);
    setItemsStatus(openItemIds, 'fertig');
  }

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
          onPress={toggleSound}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={[styles.bellButtonText, large && styles.bellButtonTextLarge]}>
            {soundEnabled ? '🔔' : '🔕'}
          </Text>
        </TouchableOpacity>
      </View>

      {tab === 'offen' && open.length === 0 ? (
        <EmptyBoardBanner large={large} styles={styles} />
      ) : showStationColumns ? (
        <View style={styles.stationRow}>
          <View style={styles.stationColumn}>
            <StationHeader title="Vorspeise" openCount={countOpenItems(vorspeiseOrders)} large={large} styles={styles} />
            <TicketList
              orders={vorspeiseOrders}
              large={large}
              styles={styles}
              cardBackground={cardBackground}
              onToggleItem={setItemStatus}
              onCompleteOrder={completeOrder}
              allowComplete
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
              onCompleteOrder={completeOrder}
              allowComplete
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
          onCompleteOrder={completeOrder}
          allowComplete={tab === 'offen'}
          emptyText={tab === 'offen' ? 'Keine offenen Bestellungen.' : 'Noch keine erledigten Bestellungen.'}
        />
      )}
    </View>
  );
}

// Ersetzt die Ticket-Liste komplett, solange im "Offen"-Tab nichts ansteht (statt nur
// eines schlichten ListEmptyComponent-Texts wie sonst) — ein kleiner Spaß für die Küche/
// Bar in ruhigen Momenten. Bei der Küche mit ihrer Zwei-Spalten-Ansicht gilt das für beide
// Spalten gleichzeitig (dieselbe `open`-Liste speist beide), deshalb einmal über dem
// ganzen Board statt einmal pro Spalte.
function EmptyBoardBanner({ large, styles }: { large: boolean; styles: BoardStyles }) {
  return (
    <View style={styles.emptyBanner}>
      <Text style={[styles.emptyBannerText, large && styles.emptyBannerTextLarge]}>
        啊呀怎么没事情干啊😔😔😔
      </Text>
      <Image
        source={IMPATIENT_HONGBIN}
        style={[styles.emptyBannerImage, large && styles.emptyBannerImageLarge]}
        resizeMode="contain"
      />
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
  onCompleteOrder,
  allowComplete = false,
  emptyText,
}: {
  orders: GroupedOrder[];
  large: boolean;
  styles: BoardStyles;
  cardBackground: Record<OrderProgress, object>;
  onToggleItem: (itemId: string, status: OrderItemStatus) => void;
  onCompleteOrder?: (order: GroupedOrder) => void;
  allowComplete?: boolean;
  emptyText: string;
}) {
  return (
    <FlatList
      data={orders}
      keyExtractor={(order) => order.orderId}
      contentContainerStyle={[styles.listContent, large && styles.listContentLarge]}
      renderItem={({ item: order }) => {
        const card = (
          <View style={[styles.card, large && styles.cardLarge, cardBackground[progressFor(order)]]}>
            <View style={styles.cardHeader}>
              <Text style={[styles.tableLabel, large && styles.tableLabelLarge]}>Tisch {order.table.number}</Text>
              <View style={styles.cardHeaderRight}>
                <Text style={[styles.timeLabel, large && styles.timeLabelLarge]}>{formatTime(order.createdAt)}</Text>
                {allowComplete && (
                  <TouchableOpacity
                    onPress={() => onCompleteOrder?.(order)}
                    style={[styles.cardCloseButton, large && styles.cardCloseButtonLarge]}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Text style={[styles.cardCloseButtonText, large && styles.cardCloseButtonTextLarge]}>×</Text>
                  </TouchableOpacity>
                )}
              </View>
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
        );

        if (!allowComplete) return card;

        // Wisch-Geste als zweiter Weg (neben dem X-Button oben), eine ganze Karte auf
        // einmal abzuhaken — z.B. wenn eine Hand gerade an Töpfen/Tellern beschäftigt
        // ist und ein Wisch schneller geht als gezielt den kleinen X-Button zu treffen.
        // renderRightActions zeigt das grüne Aktionsfeld, während nach links gewischt
        // wird (der Inhalt rutscht dabei nach links, das Feld erscheint von rechts).
        // onSwipeableOpen löst direkt beim vollständigen Öffnen aus, ohne dass zusätzlich
        // noch auf das Aktionsfeld getippt werden müsste — ein durchgezogener Wisch reicht.
        return (
          <Swipeable
            renderRightActions={() => (
              <View style={[styles.swipeCompleteAction, large && styles.swipeCompleteActionLarge]}>
                <Text style={[styles.swipeCompleteActionText, large && styles.swipeCompleteActionTextLarge]}>
                  ✓ Fertig
                </Text>
              </View>
            )}
            onSwipeableOpen={(direction) => {
              if (direction === 'right') onCompleteOrder?.(order);
            }}
            overshootRight={false}
            rightThreshold={40}
          >
            {card}
          </Swipeable>
        );
      }}
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
    // "Nichts zu tun"-Banner statt Ticket-Liste, siehe EmptyBoardBanner — Text links,
    // Bild rechts. Bild-Breite fix, Höhe über aspectRatio (Originalbild ist 1200×1600,
    // also Hochformat 3:4) statt fixer Höhe, damit es nicht verzerrt wird. overflow:
    // 'hidden' als Sicherheitsnetz — Views clippen in RN standardmäßig NICHT, ein zu
    // großes Bild würde sonst optisch (und für Touches!) über den Container hinaus in
    // die Tableiste darüber hineinragen, wie bei Breite 660 auf der Küche geschehen
    // (660 × 4/3 ≈ 880 hoch, mehr als der verfügbare Platz unter der Tableiste).
    emptyBanner: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 24,
      gap: 20,
      overflow: 'hidden',
    },
    emptyBannerText: {
      flex: 1,
      fontSize: 54,
      fontWeight: '600',
      color: colors.textMuted,
      textAlign: 'right',
    },
    emptyBannerTextLarge: { fontSize: 78 },
    emptyBannerImage: { width: 420, aspectRatio: 3 / 4 },
    emptyBannerImageLarge: { width: 280 },
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
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
      gap: 8,
    },
    tableLabel: { fontSize: 18, fontWeight: '700', color: colors.text },
    tableLabelLarge: { fontSize: 28 },
    cardHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    timeLabel: { fontSize: 13, color: colors.textMuted, fontWeight: '600' },
    timeLabelLarge: { fontSize: 18 },
    // X-Button zum Abhaken der ganzen Karte auf einmal (siehe TicketList) — bewusst als
    // dezenter Kreis statt eines auffälligen roten Buttons, damit er im hektischen
    // Küchenbetrieb nicht mit einem Fehler-/Löschen-Signal verwechselt wird; das eigentliche
    // "Fertig"-Signal kommt über die Kartenfarbe (siehe cardBackgroundFor), sobald alle
    // Items abgehakt sind.
    cardCloseButton: {
      width: 26,
      height: 26,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceAlt,
    },
    cardCloseButtonLarge: { width: 38, height: 38, borderRadius: 19 },
    cardCloseButtonText: { fontSize: 16, fontWeight: '700', color: colors.textSecondary, lineHeight: 18 },
    cardCloseButtonTextLarge: { fontSize: 22, lineHeight: 24 },
    // Grünes Aktionsfeld, das beim Wischen einer Karte nach links von rechts hereinrutscht
    // (siehe renderRightActions in TicketList) — dieselbe Breite muss nicht exakt zum
    // rightThreshold der Swipeable passen, das Feld ist nur die visuelle Rückmeldung.
    swipeCompleteAction: {
      width: 96,
      marginBottom: 12,
      borderRadius: 12,
      backgroundColor: '#16a34a',
      alignItems: 'center',
      justifyContent: 'center',
    },
    swipeCompleteActionLarge: { width: 130, borderRadius: 16 },
    swipeCompleteActionText: { color: '#fff', fontWeight: '700', fontSize: 14 },
    swipeCompleteActionTextLarge: { fontSize: 18 },
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
