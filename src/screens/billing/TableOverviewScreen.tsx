import { useMemo } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useDeviceOrders } from '../../hooks/useDeviceOrders';
import { formatDateTime } from '../../lib/datetime';
import { itemTotal, formatPrice } from '../../lib/pricing';
import type { RootStackParamList } from '../../navigation/types';
import type { ThemeColors } from '../../theme/colors';
import { useThemedStyles } from '../../theme/useThemedStyles';

type Props = NativeStackScreenProps<RootStackParamList, 'TableOverview'>;
type OverviewStyles = ReturnType<typeof createStyles>;

interface TableRow {
  tableNumber: number;
  total: number;
  done: number;
  // Freitext-Notiz zum Tisch (tables.note, siehe schema.sql) — hier nur als Indikator
  // (📝-Icon neben der Tischnummer) verwendet, nicht editierbar. Bearbeitet wird die
  // Notiz ausschließlich in TableBillingScreen.tsx (Checkout-Ansicht).
  note: string | null;
  // Gesamtsumme über alle Positionen dieses Tisches (siehe itemTotal in lib/pricing.ts),
  // unabhängig vom Bezahlt-Status — dieselbe Rechnung wie "Gesamt" oben in
  // TableBillingScreen.tsx, hier direkt in der Übersicht, ohne erst reinklicken zu müssen.
  priceSum: number;
  // true, wenn mindestens eine Position dieses Tisches keinen hinterlegten Preis hat
  // (itemTotal() liefert dann null) — die fließt nicht in priceSum ein, die Summe ist
  // also ggf. unvollständig. Näheres dazu erst beim Reinklicken in TableBillingScreen.tsx.
  hasUnpriced: boolean;
  // Nur für "Vergangene Tische" gefüllt (siehe unten) — spätester closed_at-Wert unter
  // den orders dieses Tisches, falls durch mehrere "Tisch abschließen"-Läufe (Tisch
  // wieder neu bestellt, erneut abgeschlossen) mehrere Werte vorkämen. Für aktuell
  // offene Tische bleibt es null.
  closedAt: string | null;
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
      const row = byTable.get(order.table.number) ?? {
        tableNumber: order.table.number,
        total: 0,
        done: 0,
        note: order.table.note,
        priceSum: 0,
        hasUnpriced: false,
        closedAt: null,
      };
      row.total += order.items.length;
      row.done += order.items.filter((item) => item.status === 'fertig').length;
      for (const item of order.items) {
        const total = itemTotal(item);
        if (total === null) row.hasUnpriced = true;
        else row.priceSum += total;
      }
      // Spätesten closed_at-Wert behalten, falls ein Tisch mehrfach abgeschlossen wurde
      // (mehrere orders mit unterschiedlichem closed_at) — bestimmt unten die Sortierung.
      if (order.closedAt !== null && (row.closedAt === null || order.closedAt > row.closedAt)) {
        row.closedAt = order.closedAt;
      }
      byTable.set(order.table.number, row);
    }

    return {
      current: Array.from(currentByTable.values()).sort((a, b) => a.tableNumber - b.tableNumber),
      // Chronologisch nach Abschlusszeitpunkt statt nach Tischnummer — zuletzt
      // abgeschlossene Tische zuerst, das ist für Rückfragen/Nachkontrolle der
      // relevantere Fall als eine alphanumerische Tischsortierung.
      past: Array.from(pastByTable.values()).sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? '')),
    };
  }, [kitchen.orders, bar.orders]);

  // Umsatz: einfache Summe über ALLE Tische, die hier angezeigt werden — aktuelle wie
  // vergangene (current + past, siehe oben), unabhängig vom Bestelldatum. Deckt sich also
  // genau mit dem, was gerade unten in der Liste zu sehen ist (keine separate
  // Tages-Filterung mehr wie zuvor) — die einzige Grenze ist der Tagesabschluss
  // (RoleSelectScreen.tsx), der orders komplett löscht und damit auch diese Summe leert.
  const { totalRevenue, hasUnpricedRevenue } = useMemo(() => {
    const rows = [...current, ...past];
    return {
      totalRevenue: rows.reduce((sum, row) => sum + row.priceSum, 0),
      hasUnpricedRevenue: rows.some((row) => row.hasUnpriced),
    };
  }, [current, past]);

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
      <View style={styles.revenueCard}>
        <Text style={styles.revenueLabel}>Umsatz</Text>
        <Text style={styles.revenueValue}>{formatPrice(totalRevenue)}</Text>
        {hasUnpricedRevenue && (
          <Text style={styles.revenueNote}>Enthält Positionen ohne hinterlegten Preis (nicht mitgezählt).</Text>
        )}
      </View>
      {current.length === 0 && past.length === 0 && (
        <Text style={styles.emptyText}>Keine Bestellungen heute.</Text>
      )}
      {current.map((row) => (
        <TableCard
          key={row.tableNumber}
          row={row}
          styles={styles}
          onPress={() => navigation.navigate('TableBilling', { tableNumber: row.tableNumber })}
          onNewOrder={() => navigation.navigate('Order', { tableNumber: row.tableNumber })}
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
              onNewOrder={() => navigation.navigate('Order', { tableNumber: row.tableNumber })}
            />
          ))}
        </>
      )}
      {[...current, ...past].some((row) => row.hasUnpriced) && (
        <Text style={styles.footnote}>* enthält Positionen ohne hinterlegten Preis, nicht in der Summe enthalten.</Text>
      )}
    </ScrollView>
  );
}

function TableCard({
  row,
  past = false,
  onPress,
  onNewOrder,
  styles,
}: {
  row: TableRow;
  past?: boolean;
  onPress: () => void;
  // Öffnet die Bestellaufnahme mit dieser Tischnummer vorausgefüllt (siehe
  // RootStackParamList['Order']), statt erst zurück ins Hauptmenü zu müssen — z.B. um bei
  // einem bereits abgeschlossenen ("Vergangene Tische") Tisch eine neue Runde für frische
  // Gäste aufzunehmen, ohne die Nummer erneut einzutippen.
  onNewOrder: () => void;
  styles: OverviewStyles;
}) {
  return (
    <View style={[styles.card, past && styles.cardPast]}>
      <TouchableOpacity style={styles.cardMain} onPress={onPress}>
        <View style={styles.cardLeft}>
          <View style={styles.tableLabelRow}>
            <Text style={styles.tableLabel}>Tisch {row.tableNumber}</Text>
            {/* Reiner Hinweis, dass eine Notiz existiert — bearbeitet wird sie ausschließlich
                in TableBillingScreen.tsx (Checkout), damit hier nichts extra angetippt werden
                muss, um sie zu sehen. */}
            {row.note && <Text style={styles.noteIndicator}>📝</Text>}
          </View>
          {past && row.closedAt && (
            <Text style={styles.closedAtText}>Abgeschlossen: {formatDateTime(row.closedAt)}</Text>
          )}
        </View>
        <View style={styles.cardRight}>
          <Text style={styles.cardSumText}>
            {formatPrice(row.priceSum)}
            {row.hasUnpriced ? '*' : ''}
          </Text>
          <Text style={styles.progressText}>
            {row.done}/{row.total} fertig
          </Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.newOrderButton}
        onPress={onNewOrder}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Text style={styles.newOrderButtonText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
    errorText: { color: colors.danger, padding: 16 },
    listContent: { padding: 12 },
    revenueCard: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: 12,
      padding: 16,
      marginBottom: 16,
      alignItems: 'center',
    },
    revenueLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    revenueValue: { fontSize: 32, fontWeight: '800', color: colors.text, marginTop: 4 },
    revenueNote: { fontSize: 12, color: colors.warning, marginTop: 6, textAlign: 'center' },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    cardMain: {
      flex: 1,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    // "+"-Button für "Neue Bestellung" (siehe onNewOrder) — eigener Tap-Bereich neben dem
    // Kartenkörper, damit er nicht mit dem Antippen der Karte selbst (öffnet die
    // Abrechnung) kollidiert.
    newOrderButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    newOrderButtonText: { fontSize: 20, fontWeight: '700', color: colors.primary, lineHeight: 22 },
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
    cardLeft: { flex: 1, paddingRight: 12 },
    tableLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    tableLabel: { fontSize: 18, fontWeight: '700', color: colors.text },
    noteIndicator: { fontSize: 14 },
    closedAtText: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
    cardRight: { alignItems: 'flex-end' },
    cardSumText: { fontSize: 18, fontWeight: '700', color: colors.text },
    progressText: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
    emptyText: { textAlign: 'center', color: colors.textFaint, marginTop: 32 },
    footnote: { fontSize: 11, color: colors.textFaint, marginTop: 4, textAlign: 'center' },
  });
