import { useMemo } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useDeviceOrders } from '../../hooks/useDeviceOrders';
import type { DeviceOrderItem } from '../../hooks/useDeviceOrders';
import type { RootStackParamList } from '../../navigation/types';
import type { ThemeColors } from '../../theme/colors';
import { useThemedStyles } from '../../theme/useThemedStyles';

type Props = NativeStackScreenProps<RootStackParamList, 'Status'>;

interface TableRow {
  tableNumber: number;
  total: number;
  done: number;
  openItems: DeviceOrderItem[];
}

interface RecentlyDoneEntry {
  id: string;
  tableNumber: number;
  doneAt: string;
  item: DeviceOrderItem;
}

const RECENTLY_DONE_LIMIT = 20;

// Extrahiert die zuletzt fertiggestellten Items aus einem Satz Bestellungen (Küche
// ODER Bar, siehe getrennte Aufrufe unten) — Küche und Bar werden getrennt gehalten
// statt in einem gemeinsamen Streifen gemischt, da sonst z.B. eine ruhige Küchenphase
// den Streifen komplett mit Getränken füllen und umgekehrt Essen aus dem Blick
// verdrängen konnte.
function buildRecentlyDone(orders: { table: { number: number }; items: DeviceOrderItem[] }[]): RecentlyDoneEntry[] {
  const entries: RecentlyDoneEntry[] = [];

  for (const order of orders) {
    for (const item of order.items) {
      if (item.status === 'fertig' && item.done_at) {
        entries.push({ id: item.id, tableNumber: order.table.number, doneAt: item.done_at, item });
      }
    }
  }

  return entries
    .sort((a, b) => new Date(b.doneAt).getTime() - new Date(a.doneAt).getTime())
    .slice(0, RECENTLY_DONE_LIMIT);
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

// Hanzi ist primär für die Küche — Getränke/Nachspeisen haben keins (siehe
// OrderScreen.tsx/DeviceTicketBoard.tsx), dann reicht der deutsche Name allein.
function dishLabel(item: DeviceOrderItem): string {
  const { name_hanzi, name_de, item_code } = item.menu_item;
  const code = item_code ? `${item_code} · ` : '';
  return name_hanzi ? `${code}${name_hanzi} (${name_de})` : `${code}${name_de}`;
}

// Übersicht aller offenen Tische mit Fortschritt, gespeist aus denselben
// Realtime-Daten wie Küche/Bar (kombiniert über beide Geräte, pro Tisch statt
// pro einzelner Bestellung — ein Tisch kann mehrere offene Bestellungen haben).
export default function StatusScreen({ navigation }: Props) {
  const styles = useThemedStyles(createStyles);
  const kitchen = useDeviceOrders('kitchen');
  const bar = useDeviceOrders('bar');

  const rows = useMemo(() => {
    const byTable = new Map<number, TableRow>();

    for (const order of [...kitchen.orders, ...bar.orders]) {
      const row = byTable.get(order.table.number) ?? {
        tableNumber: order.table.number,
        total: 0,
        done: 0,
        openItems: [],
      };
      row.total += order.items.length;
      row.done += order.items.filter((item) => item.status === 'fertig').length;
      row.openItems.push(...order.items.filter((item) => item.status === 'offen'));
      byTable.set(order.table.number, row);
    }

    return Array.from(byTable.values())
      .filter((row) => row.done < row.total)
      .sort((a, b) => a.tableNumber - b.tableNumber);
  }, [kitchen.orders, bar.orders]);

  const recentlyDoneKitchen = useMemo(() => buildRecentlyDone(kitchen.orders), [kitchen.orders]);
  const recentlyDoneBar = useMemo(() => buildRecentlyDone(bar.orders), [bar.orders]);

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
        <Text style={styles.errorText}>Status konnte nicht geladen werden: {loadError}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <RecentlyDoneStrip title="Zuletzt zubereitet (Küche)" entries={recentlyDoneKitchen} styles={styles} />
      <RecentlyDoneStrip title="Zuletzt zubereitet (Bar)" entries={recentlyDoneBar} styles={styles} />
      <FlatList
        data={rows}
        keyExtractor={(row) => String(row.tableNumber)}
        contentContainerStyle={styles.listContent}
        renderItem={({ item: row }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => navigation.navigate('TableDetail', { tableNumber: row.tableNumber })}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.tableLabel}>Tisch {row.tableNumber}</Text>
              <Text style={styles.progressText}>
                {row.done}/{row.total} fertig
              </Text>
            </View>
            <Text style={styles.openLabel}>Noch offen:</Text>
            {row.openItems.map((item) => (
              <Text key={item.id} style={styles.openItemText}>
                • {item.menu_item.name_hanzi} ({item.menu_item.name_de})
                {item.variant_de ? ` · ${item.variant_de}` : ''}
              </Text>
            ))}
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>Keine offenen Tische.</Text>}
      />
    </View>
  );
}

function RecentlyDoneStrip({
  title,
  entries,
  styles,
}: {
  title: string;
  entries: RecentlyDoneEntry[];
  styles: StatusStyles;
}) {
  if (entries.length === 0) return null;

  return (
    <View style={styles.recentBar}>
      <Text style={styles.recentBarTitle}>{title}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recentBarContent}>
        {entries.map((entry) => (
          <View key={entry.id} style={styles.recentChip}>
            <Text style={styles.recentChipDish}>{dishLabel(entry.item)}</Text>
            <Text style={styles.recentChipMeta}>
              Tisch {entry.tableNumber} · {formatTime(entry.doneAt)}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

type StatusStyles = ReturnType<typeof createStyles>;

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
    errorText: { color: colors.danger, padding: 16 },
    listContent: { padding: 12 },
    recentBar: {
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      paddingTop: 10,
      paddingBottom: 12,
    },
    recentBarTitle: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      paddingHorizontal: 16,
      marginBottom: 8,
    },
    recentBarContent: { paddingHorizontal: 12, gap: 8 },
    recentChip: {
      backgroundColor: colors.successSurface,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 8,
      maxWidth: 240,
    },
    recentChipDish: { fontSize: 14, fontWeight: '700', color: colors.text },
    recentChipMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
    },
    cardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 8,
    },
    tableLabel: { fontSize: 18, fontWeight: '700', color: colors.text },
    progressText: { fontSize: 16, color: colors.textSecondary },
    openLabel: { fontSize: 12, fontWeight: '700', color: colors.warning, marginBottom: 2 },
    openItemText: { fontSize: 14, color: colors.textSecondary },
    emptyText: { textAlign: 'center', color: colors.textFaint, marginTop: 32 },
  });
