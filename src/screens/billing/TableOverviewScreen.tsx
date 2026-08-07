import { useMemo } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useDeviceOrders } from '../../hooks/useDeviceOrders';
import type { RootStackParamList } from '../../navigation/types';
import type { ThemeColors } from '../../theme/colors';
import { useThemedStyles } from '../../theme/useThemedStyles';

type Props = NativeStackScreenProps<RootStackParamList, 'TableOverview'>;

interface TableRow {
  tableNumber: number;
  total: number;
  done: number;
}

// Übersicht ALLER Tische mit Bestellungen von heute — anders als der
// Status-Tab (der nur noch offene Tische zeigt) bleibt ein Tisch hier auch
// sichtbar, sobald Küche/Bar bereits fertig sind, weil dann erst abgerechnet
// wird. Dient als Einstieg für die vorläufige Abrechnung pro Tisch.
export default function TableOverviewScreen({ navigation }: Props) {
  const styles = useThemedStyles(createStyles);
  const kitchen = useDeviceOrders('kitchen');
  const bar = useDeviceOrders('bar');

  const rows = useMemo(() => {
    const byTable = new Map<number, TableRow>();

    for (const order of [...kitchen.orders, ...bar.orders]) {
      const row = byTable.get(order.table.number) ?? { tableNumber: order.table.number, total: 0, done: 0 };
      row.total += order.items.length;
      row.done += order.items.filter((item) => item.status === 'fertig').length;
      byTable.set(order.table.number, row);
    }

    return Array.from(byTable.values()).sort((a, b) => a.tableNumber - b.tableNumber);
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
        <Text style={styles.errorText}>Tischübersicht konnte nicht geladen werden: {loadError}</Text>
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
            onPress={() => navigation.navigate('TableBilling', { tableNumber: row.tableNumber })}
          >
            <Text style={styles.tableLabel}>Tisch {row.tableNumber}</Text>
            <Text style={styles.progressText}>
              {row.done}/{row.total} fertig
            </Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>Keine Bestellungen heute.</Text>}
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
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    tableLabel: { fontSize: 18, fontWeight: '700', color: colors.text },
    progressText: { fontSize: 16, color: colors.textSecondary },
    emptyText: { textAlign: 'center', color: colors.textFaint, marginTop: 32 },
  });
