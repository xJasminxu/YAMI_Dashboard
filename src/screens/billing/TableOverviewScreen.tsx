import { useMemo, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useDeviceOrders } from '../../hooks/useDeviceOrders';
import { ADMIN_PIN } from '../../lib/adminPin';
import { formatDateTime } from '../../lib/datetime';
import { itemTotal, formatPrice } from '../../lib/pricing';
import { supabase } from '../../lib/supabase';
import type { RootStackParamList } from '../../navigation/types';
import type { ThemeColors } from '../../theme/colors';
import { useThemedStyles } from '../../theme/useThemedStyles';

type Props = NativeStackScreenProps<RootStackParamList, 'TableOverview'>;
type OverviewStyles = ReturnType<typeof createStyles>;

interface TableRow {
  tableNumber: number;
  // Für "Tisch löschen" gebraucht (siehe requestDeleteTable) — die tables-Zeile selbst
  // bleibt dabei erhalten, gelöscht werden nur die Bestellungen, die zu dieser Karte
  // gehören (siehe past unten).
  tableId: string;
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
  // Nur für "Vergangene Tische" gefüllt (siehe unten) — der closed_at-Wert, der diese
  // Karte als eigene Besetzung/Abschluss-Vorgang identifiziert (ein Tisch, der am selben
  // Tag mehrfach besetzt und abgeschlossen wird, erzeugt entsprechend mehrere TableRow-
  // Einträge mit unterschiedlichem closedAt, siehe pastByKey unten). Für aktuell offene
  // Tische bleibt es null.
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
    // Vergangene Tische werden NICHT mehr pro Tischnummer zusammengefasst, sondern pro
    // einzelnem Abschluss-Vorgang (Tischnummer + closed_at) — "Tisch abschließen" setzt
    // closed_at auf alle zu diesem Zeitpunkt offenen orders derselben Tischnummer in einem
    // einzigen Update (siehe TableBillingScreen.tsx handleCloseTable), sie tragen also
    // exakt denselben Zeitstempel und lassen sich darüber eindeutig einer Sitzung
    // zuordnen. Ohne diese Aufsplittung landeten z.B. drei verschiedene Besetzungen von
    // Tisch 3 an einem Tag in EINER Sammelkarte mit summierter Rechnung — nicht
    // nachvollziehbar, welche Bestellung zu welcher Besetzung gehörte.
    const pastByKey = new Map<string, TableRow>();

    for (const order of [...kitchen.orders, ...bar.orders]) {
      if (order.closedAt === null) {
        const row = currentByTable.get(order.table.number) ?? {
          tableNumber: order.table.number,
          tableId: order.table.id,
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
        currentByTable.set(order.table.number, row);
        continue;
      }

      const key = `${order.table.number}::${order.closedAt}`;
      const row = pastByKey.get(key) ?? {
        tableNumber: order.table.number,
        tableId: order.table.id,
        total: 0,
        done: 0,
        note: order.table.note,
        priceSum: 0,
        hasUnpriced: false,
        closedAt: order.closedAt,
      };
      row.total += order.items.length;
      row.done += order.items.filter((item) => item.status === 'fertig').length;
      for (const item of order.items) {
        const total = itemTotal(item);
        if (total === null) row.hasUnpriced = true;
        else row.priceSum += total;
      }
      pastByKey.set(key, row);
    }

    return {
      current: Array.from(currentByTable.values()).sort((a, b) => a.tableNumber - b.tableNumber),
      // Chronologisch nach Abschlusszeitpunkt statt nach Tischnummer — zuletzt
      // abgeschlossene Tische zuerst, das ist für Rückfragen/Nachkontrolle der
      // relevantere Fall als eine alphanumerische Tischsortierung.
      past: Array.from(pastByKey.values()).sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? '')),
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

  // Tisch löschen: PIN-geschützt (siehe lib/adminPin.ts), löscht aber nur die
  // Bestellungen, die zu genau dieser Karte gehören — nicht die tables-Zeile selbst (die
  // bleibt für zukünftige Bestellungen unter derselben Nummer erhalten). "past" legt fest,
  // ob die noch offenen (closed_at null) oder die zu genau diesem Abschluss-Zeitpunkt
  // gehörenden Bestellungen (closed_at === row.closedAt) gelöscht werden — je nachdem, aus
  // welcher Karte heraus gelöscht wurde. Bei "past" wird bewusst nur diese eine Sitzung
  // gelöscht, nicht alle Abschlüsse dieser Tischnummer.
  const [deleteTarget, setDeleteTarget] = useState<{ row: TableRow; past: boolean } | null>(null);
  const [deletePin, setDeletePin] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function requestDeleteTable(row: TableRow, past: boolean) {
    setDeleteTarget({ row, past });
    setDeletePin('');
    setDeleteError(null);
  }

  function cancelDeleteTable() {
    setDeleteTarget(null);
    setDeleteError(null);
  }

  async function confirmDeleteTable() {
    if (!deleteTarget) return;

    if (deletePin !== ADMIN_PIN) {
      setDeleteError('Falsche PIN.');
      return;
    }

    setDeleting(true);
    setDeleteError(null);

    // orders hat "on delete cascade" auf order_items — löscht beides in einem Schritt.
    let query = supabase.from('orders').delete().eq('table_id', deleteTarget.row.tableId);
    query = deleteTarget.past
      ? query.eq('closed_at', deleteTarget.row.closedAt as string)
      : query.is('closed_at', null);
    const { error } = await query;

    setDeleting(false);

    if (error) {
      setDeleteError(error.message);
      return;
    }

    setDeleteTarget(null);
    setDeletePin('');
  }

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
    <>
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
            onDelete={() => requestDeleteTable(row, false)}
          />
        ))}
        {past.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Vergangene Tische</Text>
            {past.map((row) => (
              <TableCard
                key={`${row.tableNumber}::${row.closedAt}`}
                row={row}
                styles={styles}
                past
                onPress={() =>
                  navigation.navigate('TableBilling', {
                    tableNumber: row.tableNumber,
                    closed: true,
                    closedAt: row.closedAt ?? undefined,
                  })
                }
                onNewOrder={() => navigation.navigate('Order', { tableNumber: row.tableNumber })}
                onDelete={() => requestDeleteTable(row, true)}
              />
            ))}
          </>
        )}
        {[...current, ...past].some((row) => row.hasUnpriced) && (
          <Text style={styles.footnote}>* enthält Positionen ohne hinterlegten Preis, nicht in der Summe enthalten.</Text>
        )}
      </ScrollView>

      <Modal visible={deleteTarget !== null} transparent animationType="fade" onRequestClose={cancelDeleteTable}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Tisch {deleteTarget?.row.tableNumber} löschen?</Text>
            <Text style={styles.modalBody}>
              Löscht {deleteTarget?.past ? 'die abgeschlossene Bestellung' : 'alle offenen Bestellungen'} dieses
              Tisches unwiderruflich — nicht rückgängig zu machen. Der Tisch selbst bleibt erhalten und ist für
              neue Bestellungen weiter nutzbar.
            </Text>
            <TextInput
              style={styles.pinInput}
              value={deletePin}
              onChangeText={setDeletePin}
              placeholder="PIN"
              placeholderTextColor={styles.pinInputPlaceholder.color as string}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={4}
              autoFocus
            />
            {deleteError && <Text style={styles.modalErrorText}>{deleteError}</Text>}
            <TouchableOpacity
              style={[styles.confirmButton, (deleting || !deletePin) && styles.confirmButtonDisabled]}
              onPress={confirmDeleteTable}
              disabled={deleting || !deletePin}
            >
              {deleting ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmButtonText}>Ja, löschen</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelButton} onPress={cancelDeleteTable} disabled={deleting}>
              <Text style={styles.cancelButtonText}>Abbrechen</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

function TableCard({
  row,
  past = false,
  onPress,
  onNewOrder,
  onDelete,
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
  // Öffnet den PIN-Dialog zum Löschen der Bestellungen dieser Karte (siehe
  // requestDeleteTable) — nur die Bestellungen, nicht die Tischnummer selbst.
  onDelete: () => void;
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
      <TouchableOpacity
        style={styles.deleteTableButton}
        onPress={onDelete}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Text style={styles.deleteTableButtonText}>🗑</Text>
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
    // 🗑-Button für "Tisch löschen" (siehe requestDeleteTable) — löscht nur die
    // Bestellungen dieser Karte (PIN-geschützt, siehe lib/adminPin.ts), nicht die
    // Tischnummer selbst.
    deleteTableButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    deleteTableButtonText: { fontSize: 16 },
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
    // "Tisch löschen"-Dialog (siehe requestDeleteTable) — dieselbe Optik wie der
    // Tagesabschluss-PIN-Dialog in RoleSelectScreen.tsx.
    modalOverlay: {
      flex: 1,
      backgroundColor: colors.overlay,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    modalCard: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      padding: 20,
      width: '100%',
      maxWidth: 380,
    },
    modalTitle: { fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 10, color: colors.text },
    modalBody: {
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: 'center',
      marginBottom: 20,
      lineHeight: 20,
    },
    modalErrorText: { color: colors.danger, textAlign: 'center', marginBottom: 12 },
    pinInput: {
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 12,
      fontSize: 16,
      color: colors.text,
      textAlign: 'center',
    },
    pinInputPlaceholder: { color: colors.textFaint },
    confirmButton: {
      backgroundColor: '#b91c1c',
      borderRadius: 10,
      paddingVertical: 14,
      alignItems: 'center',
      marginBottom: 10,
    },
    confirmButtonDisabled: { backgroundColor: '#f3a3a3' },
    confirmButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
    cancelButton: { paddingVertical: 10, alignItems: 'center' },
    cancelButtonText: { fontSize: 15, color: colors.textMuted },
  });
