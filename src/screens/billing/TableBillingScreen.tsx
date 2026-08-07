import { useMemo, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ActivityIndicator, FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useDeviceOrders } from '../../hooks/useDeviceOrders';
import type { DeviceOrderItem } from '../../hooks/useDeviceOrders';
import { supabase } from '../../lib/supabase';
import type { RootStackParamList } from '../../navigation/types';
import type { ThemeColors } from '../../theme/colors';
import { useThemedStyles } from '../../theme/useThemedStyles';

type Props = NativeStackScreenProps<RootStackParamList, 'TableBilling'>;

function formatPrice(amount: number) {
  return `${amount.toFixed(2).replace('.', ',')} €`;
}

// Preis einer einzelnen Position: Preis-Snapshot vom Bestellzeitpunkt
// (unit_price/extras[].price), mit Fallback auf den aktuellen menu_items.price
// für ältere Bestellungen, die vor Einführung des Snapshots angelegt wurden.
function itemTotal(item: DeviceOrderItem): number | null {
  const base = item.unit_price ?? item.menu_item.price ?? null;
  const extras = item.extras ?? [];
  const extrasSum = extras.reduce((sum, e) => sum + (e.price ?? 0) * e.quantity, 0);
  const hasAnyPrice = base !== null || extras.some((e) => e.price !== null && e.price !== undefined);
  if (!hasAnyPrice) return null;
  return (base ?? 0) + extrasSum;
}

// Bestellübersicht mit vorläufiger Abrechnung: Bedienung kann einzelne
// Positionen auswählen (z.B. für getrennte Rechnungen) und sieht die Summe
// live. Rein zur Orientierung — die verbindliche Rechnung druckt weiterhin
// das bestehende Kassensystem, hier wird nichts gebucht oder gespeichert.
export default function TableBillingScreen({ route, navigation }: Props) {
  const styles = useThemedStyles(createStyles);
  const { tableNumber } = route.params;
  const kitchen = useDeviceOrders('kitchen');
  const bar = useDeviceOrders('bar');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Als bezahlt markierte Positionen — rein lokaler UI-Zustand für diesen
  // Bildschirmbesuch (wie die Auswahl selbst), nichts wird gebucht/gespeichert.
  // Grund für einen eigenen Screen-Reset statt Persistierung: sobald der Tisch
  // fertig abgerechnet ist, wird sowieso der Tagesabschluss gemacht bzw. die
  // Bestellung läuft aus den offenen Ansichten raus.
  const [paidIds, setPaidIds] = useState<Set<string>>(new Set());
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  const tableOrders = useMemo(
    () => [...kitchen.orders, ...bar.orders].filter((order) => order.table.number === tableNumber),
    [kitchen.orders, bar.orders, tableNumber]
  );
  // Für "Tisch abschließen" gebraucht — anders als die restliche Seite ist das
  // ein echter Schreibzugriff (delete auf orders, cascade auf order_items).
  const tableId = tableOrders[0]?.table.id ?? null;

  const items = useMemo(
    () => tableOrders.flatMap((order) => order.items).sort((a, b) => a.menu_item.category.sort_order - b.menu_item.category.sort_order),
    [tableOrders]
  );

  // Löscht alle Bestellungen dieses Tisches (order_items hängt per "on delete
  // cascade" dran) — anders als "Bezahlt" oben ist das keine reine Anzeige,
  // sondern schließt den Tisch wirklich ab: er verschwindet aus Küche/Bar/
  // Status/Tischübersicht und ist wieder frei für neue Gäste. Die verbindliche
  // Rechnung läuft weiterhin über die Kasse — das hier ist nur das Aufräumen
  // auf Seite der App.
  async function handleCloseTable() {
    if (!tableId) {
      setCloseConfirmOpen(false);
      return;
    }

    setClosing(true);
    setCloseError(null);

    const { error } = await supabase.from('orders').delete().eq('table_id', tableId);

    setClosing(false);

    if (error) {
      setCloseError(error.message);
      return;
    }

    setCloseConfirmOpen(false);
    navigation.goBack();
  }

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Bezahlte Positionen bleiben angetippt sichtbar, aber ausgegraut — nochmal
  // antippen macht die Bezahlung rückgängig (z.B. bei Vertippern), sonst wird
  // die normale Auswahl umgeschaltet.
  function handleItemPress(id: string) {
    if (paidIds.has(id)) {
      setPaidIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      return;
    }
    toggle(id);
  }

  function markSelectedAsPaid() {
    if (selectedIds.size === 0) return;
    setPaidIds((prev) => new Set([...prev, ...selectedIds]));
    setSelectedIds(new Set());
  }

  function selectAll() {
    setSelectedIds(new Set(items.filter((item) => !paidIds.has(item.id)).map((item) => item.id)));
  }

  function selectNone() {
    setSelectedIds(new Set());
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
        <Text style={styles.errorText}>Bestellung konnte nicht geladen werden: {loadError}</Text>
      </View>
    );
  }

  const grandTotal = items.reduce((sum, item) => sum + (itemTotal(item) ?? 0), 0);
  const paidTotal = items
    .filter((item) => paidIds.has(item.id))
    .reduce((sum, item) => sum + (itemTotal(item) ?? 0), 0);
  const openTotal = grandTotal - paidTotal;
  const selectedTotal = items
    .filter((item) => selectedIds.has(item.id))
    .reduce((sum, item) => sum + (itemTotal(item) ?? 0), 0);
  const hasUnpriced = items.some((item) => itemTotal(item) === null);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Tisch {tableNumber}</Text>
        <Text style={styles.grandTotal}>Gesamt: {formatPrice(grandTotal)}</Text>
      </View>
      {paidIds.size > 0 && (
        <View style={styles.paidSummaryRow}>
          <Text style={styles.paidSummaryText}>Bezahlt: {formatPrice(paidTotal)}</Text>
          <Text style={styles.openSummaryText}>Noch offen: {formatPrice(openTotal)}</Text>
        </View>
      )}
      <View style={styles.selectRow}>
        <TouchableOpacity onPress={selectAll}>
          <Text style={styles.selectAction}>Alle auswählen</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={selectNone}>
          <Text style={styles.selectAction}>Auswahl aufheben</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[styles.paidButton, selectedIds.size === 0 && styles.paidButtonDisabled]}
        onPress={markSelectedAsPaid}
        disabled={selectedIds.size === 0}
      >
        <Text style={styles.paidButtonText}>
          Bezahlt{selectedIds.size > 0 ? ` (${selectedIds.size} · ${formatPrice(selectedTotal)})` : ''}
        </Text>
      </TouchableOpacity>

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const selected = selectedIds.has(item.id);
          const paid = paidIds.has(item.id);
          const total = itemTotal(item);
          const isDone = item.status === 'fertig';
          return (
            <TouchableOpacity
              style={[styles.itemRow, selected && styles.itemRowSelected, paid && styles.itemRowPaid]}
              onPress={() => handleItemPress(item.id)}
            >
              {paid ? (
                <View style={styles.paidBadge}>
                  <Text style={styles.paidBadgeText}>✓</Text>
                </View>
              ) : (
                <View style={[styles.checkbox, selected && styles.checkboxChecked]}>
                  {selected && <Text style={styles.checkboxMark}>✓</Text>}
                </View>
              )}
              <View style={styles.itemTextWrap}>
                <Text style={[styles.itemHanzi, (isDone || paid) && styles.itemDone]}>
                  {item.menu_item.item_code ? `${item.menu_item.item_code} · ` : ''}
                  {item.menu_item.name_hanzi}
                  {item.variant_hanzi ? ` · ${item.variant_hanzi}` : ''}
                </Text>
                <Text style={[styles.itemDe, (isDone || paid) && styles.itemDone]}>
                  {item.menu_item.name_de}
                  {item.variant_de ? ` · ${item.variant_de}` : ''}
                </Text>
                {item.extras && item.extras.length > 0 && (
                  <Text style={[styles.itemExtras, paid && styles.itemDone]}>
                    {item.extras.map((e) => `+${e.quantity} ${e.name_hanzi} (${e.name_de})`).join(', ')}
                  </Text>
                )}
                {item.note && <Text style={[styles.itemNote, paid && styles.itemDone]}>Notiz: {item.note}</Text>}
              </View>
              <Text style={[styles.itemPrice, paid && styles.itemDone]}>{total !== null ? formatPrice(total) : '–'}</Text>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={<Text style={styles.emptyText}>Keine Positionen für diesen Tisch.</Text>}
      />

      <View style={styles.footer}>
        {hasUnpriced && <Text style={styles.footerNote}>Enthält Positionen ohne hinterlegten Preis.</Text>}
        <View style={styles.footerRow}>
          <Text style={styles.footerLabel}>
            Noch offen ({items.length - paidIds.size}/{items.length})
          </Text>
          <Text style={styles.footerValue}>{formatPrice(openTotal)}</Text>
        </View>
        <Text style={styles.footerDisclaimer}>
          Vorläufige Berechnung zur Orientierung, z.B. für getrennte Rechnungen — gebucht wird nichts. Die
          verbindliche Rechnung druckt weiterhin die Kasse.
        </Text>

        <TouchableOpacity
          style={[styles.closeTableButton, items.length === 0 && styles.closeTableButtonDisabled]}
          onPress={() => setCloseConfirmOpen(true)}
          disabled={items.length === 0}
        >
          <Text style={styles.closeTableButtonText}>Tisch abschließen</Text>
        </TouchableOpacity>
      </View>

      <Modal
        visible={closeConfirmOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setCloseConfirmOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Tisch {tableNumber} abschließen?</Text>
            <Text style={styles.modalBody}>
              Löscht alle Bestellungen dieses Tisches unwiderruflich (Küche, Bar, Status, Tischübersicht). Der
              Tisch ist danach wieder frei für neue Gäste. Speisekarte und übrige Tische bleiben unangetastet.
              {openTotal > 0
                ? ` Achtung: noch ${items.length - paidIds.size} Position(en) im Wert von ${formatPrice(openTotal)} sind nicht als bezahlt markiert.`
                : ''}
            </Text>
            {closeError && <Text style={styles.errorText}>{closeError}</Text>}
            <TouchableOpacity
              style={[styles.confirmButton, closing && styles.confirmButtonDisabled]}
              onPress={handleCloseTable}
              disabled={closing}
            >
              {closing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.confirmButtonText}>Ja, Tisch abschließen</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => setCloseConfirmOpen(false)}
              disabled={closing}
            >
              <Text style={styles.cancelButtonText}>Abbrechen</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
    errorText: { color: colors.danger, padding: 16 },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingTop: 16,
    },
    title: { fontSize: 22, fontWeight: '700', color: colors.text },
    grandTotal: { fontSize: 16, fontWeight: '600', color: colors.textSecondary },
    paidSummaryRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 8,
    },
    paidSummaryText: { fontSize: 13, fontWeight: '600', color: colors.success },
    openSummaryText: { fontSize: 13, fontWeight: '600', color: colors.warning },
    selectRow: {
      flexDirection: 'row',
      gap: 16,
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    selectAction: { fontSize: 13, color: colors.primary, fontWeight: '600' },
    paidButton: {
      marginHorizontal: 16,
      marginBottom: 12,
      backgroundColor: '#16a34a',
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: 'center',
    },
    paidButtonDisabled: { backgroundColor: colors.textFaint },
    paidButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
    listContent: { paddingHorizontal: 16, paddingBottom: 8 },
    itemRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: 10,
      padding: 12,
      marginBottom: 8,
    },
    itemRowSelected: { backgroundColor: colors.successSurface },
    itemRowPaid: { backgroundColor: colors.surfaceAlt, opacity: 0.6 },
    checkbox: {
      width: 24,
      height: 24,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: colors.textFaint,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    checkboxChecked: { backgroundColor: '#16a34a', borderColor: '#15803d' },
    checkboxMark: { color: '#fff', fontSize: 15, fontWeight: '700' },
    paidBadge: {
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: colors.textFaint,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    paidBadgeText: { color: '#fff', fontSize: 14, fontWeight: '700' },
    itemTextWrap: { flex: 1, paddingRight: 8 },
    itemHanzi: { fontSize: 16, fontWeight: '600', color: colors.text },
    itemDe: { fontSize: 12, color: colors.textMuted },
    itemExtras: { fontSize: 12, color: colors.textSecondary, marginTop: 2, fontStyle: 'italic' },
    itemNote: { fontSize: 12, color: colors.warning, marginTop: 2, fontWeight: '700' },
    itemDone: { color: colors.textFaint },
    itemPrice: { fontSize: 15, fontWeight: '700', color: colors.text },
    emptyText: { textAlign: 'center', color: colors.textFaint, marginTop: 32 },
    footer: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
      padding: 16,
    },
    footerNote: { fontSize: 12, color: colors.warning, marginBottom: 6 },
    footerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    footerLabel: { fontSize: 16, fontWeight: '700', color: colors.text },
    footerValue: { fontSize: 20, fontWeight: '800', color: colors.text },
    footerDisclaimer: { fontSize: 11, color: colors.textFaint, marginTop: 8, lineHeight: 15 },
    closeTableButton: {
      marginTop: 14,
      borderWidth: 1.5,
      borderColor: colors.danger,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: 'center',
    },
    closeTableButtonDisabled: { borderColor: colors.borderStrong },
    closeTableButtonText: { color: colors.danger, fontSize: 15, fontWeight: '700' },
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
