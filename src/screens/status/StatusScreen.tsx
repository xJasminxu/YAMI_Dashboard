import { useMemo } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
    errorText: { color: colors.danger, padding: 16 },
    listContent: { padding: 12 },
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
