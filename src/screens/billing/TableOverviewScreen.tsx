import { useMemo } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useDeviceOrders } from '../../hooks/useDeviceOrders';
import type { RootStackParamList } from '../../navigation/types';
import type { ThemeColors } from '../../theme/colors';
import { useThemedStyles } from '../../theme/useThemedStyles';

type Props = NativeStackScreenProps<RootStackParamList, 'TableOverview'>;
type OverviewStyles = ReturnType<typeof createStyles>;

interface TableRow {
  tableNumber: number;
  total: number;
  done: number;
}

// Übersicht ALLER Tische mit Bestellungen von heute — anders als der Status-Tab (der nur
// noch offene Tische zeigt) bleibt ein Tisch hier auch sichtbar, sobald Küche/Bar bereits
// fertig sind, weil dann erst abgerechnet wird. Dient als Einstieg für die vorläufige
// Abrechnung pro Tisch. "Vergangene Tische" sind bereits per "Tisch abschließen"
// geschlossene Bestellungen (orders.closed_at gesetzt) — nicht gelöscht, nur aus der
// aktiven Küche/Bar/Status-Ansicht raus, damit man bei Rückfragen noch reinschauen kann.
// includeClosed:true holt beide Gruppen über denselben Hook.
export default function TableOverviewScreen({ navigation }: Props) {
  const styles = useThemedStyles(createStyles);
  const kitchen = useDeviceOrders('kitchen', { includeClosed: true });
  const bar = useDeviceOrders('bar', { includeClosed: true });

  const { current, past } = useMemo(() => {
    const currentByTable = new Map<number, TableRow>();
    const pastByTable = new Map<number, TableRow>();

    for (const order of [...kitchen.orders, ...bar.orders]) {
      const byTable = order.closedAt === null ? currentByTable : pastByTable;
      const row = byTable.get(order.table.number) ?? { tableNumber: order.table.number, total: 0, done: 0 };
      row.total += order.items.length;
      row.done += order.items.filter((item) => item.status === 'fertig').length;
      byTable.set(order.table.number, row);
    }

    return {
      current: Array.from(currentByTable.values()).sort((a, b) => a.tableNumber - b.tableNumber),
      past: Array.from(pastByTable.values()).sort((a, b) => a.tableNumber - b.tableNumber),
    };
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
    <ScrollView style={styles.container} contentContainerStyle={styles.listContent}>
      {current.length === 0 && past.length === 0 && (
        <Text style={styles.emptyText}>Keine Bestellungen heute.</Text>
      )}
      {current.map((row) => (
        <TableCard
          key={row.tableNumber}
          row={row}
          styles={styles}
          onPress={() => navigation.navigate('TableBilling', { tableNumber: row.tableNumber })}
        />
      ))}
      {past.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Vergangene Tische</Text>
          {past.map((row) => (
            <TableCard
              key={row.tableNumber}
              row={row}
              styles={styles}
              past
              onPress={() => navigation.navigate('TableBilling', { tableNumber: row.tableNumber, closed: true })}
            />
          ))}
        </>
      )}
    </ScrollView>
  );
}

function TableCard({
  row,
  past = false,
  onPress,
  styles,
}: {
  row: TableRow;
  past?: boolean;
  onPress: () => void;
  styles: OverviewStyles;
}) {
  return (
    <TouchableOpacity style={[styles.card, past && styles.cardPast]} onPress={onPress}>
      <Text style={styles.tableLabel}>Tisch {row.tableNumber}</Text>
      <Text style={styles.progressText}>
        {row.done}/{row.total} fertig
      </Text>
    </TouchableOpacity>
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
    cardPast: { opacity: 0.6 },
    sectionTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginTop: 8,
      marginBottom: 12,
    },
    tableLabel: { fontSize: 18, fontWeight: '700', color: colors.text },
    progressText: { fontSize: 16, color: colors.textSecondary },
    emptyText: { textAlign: 'center', color: colors.textFaint, marginTop: 32 },
  });
