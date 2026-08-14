import { useMemo, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ActivityIndicator, FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useDeviceOrders } from '../../hooks/useDeviceOrders';
import type { DeviceOrderItem } from '../../hooks/useDeviceOrders';
import { supabase } from '../../lib/supabase';
import type { RootStackParamList } from '../../navigation/types';
import type { PaymentMethod } from '../../types/database';
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
  const { tableNumber, closed: showClosed = false } = route.params;
  // includeClosed:true, damit derselbe Hook sowohl den aktuellen Tisch (closedAt===null)
  // als auch einen aus "Vergangene Tische" aufgerufenen, bereits geschlossenen Tisch
  // (closedAt gesetzt) laden kann — welcher von beiden gemeint ist, entscheidet
  // showClosed unten beim Filtern von tableOrders.
  const kitchen = useDeviceOrders('kitchen', { includeClosed: true });
  const bar = useDeviceOrders('bar', { includeClosed: true });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Öffnet sich beim Antippen von "Bezahlt", um vor dem Markieren die Zahlungsart der
  // Auswahl abzufragen (siehe requestMarkSelectedAsPaid/confirmPayment). Die Markierung
  // selbst landet auf order_items.paid_method (siehe schema.sql) statt in einem rein
  // lokalen Screen-Zustand, damit sie auch nach "Tisch abschließen" beim Nachschlagen
  // unter "Vergangene Tische" noch sichtbar ist.
  const [paymentPromptOpen, setPaymentPromptOpen] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  // Position, die per X-Button/Wisch-Geste zum Entfernen vorgemerkt ist (siehe unten) —
  // anders als "Bezahlt" (rein lokaler UI-Zustand) ist das Entfernen ein echtes Delete
  // auf order_items und damit unwiderruflich, deshalb erst nach Bestätigung im Modal.
  const [removeItem, setRemoveItem] = useState<DeviceOrderItem | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const tableOrders = useMemo(
    () =>
      [...kitchen.orders, ...bar.orders].filter(
        (order) => order.table.number === tableNumber && (order.closedAt !== null) === showClosed
      ),
    [kitchen.orders, bar.orders, tableNumber, showClosed]
  );
  // Für "Tisch abschließen" gebraucht — anders als die restliche Seite ist das
  // ein echter Schreibzugriff (update auf orders.closed_at).
  const tableId = tableOrders[0]?.table.id ?? null;

  const items = useMemo(
    () => tableOrders.flatMap((order) => order.items).sort((a, b) => a.menu_item.category.sort_order - b.menu_item.category.sort_order),
    [tableOrders]
  );

  // Markiert alle noch offenen (nicht bereits geschlossenen) Bestellungen dieses Tisches
  // als abgeschlossen (orders.closed_at) statt sie zu löschen — anders als "Bezahlt" oben
  // ist das keine reine Anzeige, sondern schließt den Tisch wirklich ab: er verschwindet
  // aus Küche/Bar/Status/der aktuellen Tischübersicht und ist wieder frei für neue Gäste,
  // bleibt aber unter "Vergangene Tische" nachschlagbar. Die verbindliche Rechnung läuft
  // weiterhin über die Kasse — das hier räumt nur die App-Ansicht auf. Echt gelöscht wird
  // eine Bestellung erst beim Tagesabschluss (RoleSelectScreen.tsx).
  async function handleCloseTable() {
    if (!tableId) {
      setCloseConfirmOpen(false);
      return;
    }

    setClosing(true);
    setCloseError(null);

    const { error } = await supabase
      .from('orders')
      .update({ closed_at: new Date().toISOString() })
      .eq('table_id', tableId)
      .is('closed_at', null);

    setClosing(false);

    if (error) {
      setCloseError(error.message);
      return;
    }

    setCloseConfirmOpen(false);
    navigation.goBack();
  }

  // X-Button oder Wisch-Geste (siehe FlatList unten) merken nur die Position vor —
  // öffnet das Bestätigungs-Modal, statt sofort zu löschen. Anders als das Abhaken in
  // Küche/Bar (dort jederzeit rückgängig per erneutem Antippen) ist ein gelöschtes
  // order_item unwiderruflich weg, deshalb hier ein expliziter Bestätigungsschritt statt
  // eines sofort auslösenden Wischs.
  function requestRemoveItem(item: DeviceOrderItem) {
    setRemoveError(null);
    setRemoveItem(item);
  }

  function cancelRemoveItem() {
    setRemoveItem(null);
    setRemoveError(null);
  }

  // Löscht die Position wirklich aus order_items — für falsch bestellte Positionen oder
  // Einladungen aufs Haus. Wirkt sich auch auf Küche/Bar aus (order_items ist dieselbe
  // Tabelle, siehe useDeviceOrders-Realtime-Subscription): eine noch offene Position
  // verschwindet dort ebenfalls sofort aus dem Ticket.
  async function confirmRemoveItem() {
    if (!removeItem) return;

    setRemoving(true);
    setRemoveError(null);

    const { error } = await supabase.from('order_items').delete().eq('id', removeItem.id);

    setRemoving(false);

    if (error) {
      setRemoveError(error.message);
      return;
    }

    setRemoveItem(null);
  }

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Bezahlte Positionen bleiben angetippt sichtbar, aber ausgegraut — nochmal antippen
  // macht die Bezahlung rückgängig (z.B. bei Vertippern), sonst wird die normale Auswahl
  // umgeschaltet. Fire-and-forget wie setItemStatus in useDeviceOrders (Realtime-
  // Subscription auf order_items holt das Ergebnis ohnehin gleich nach).
  function handleItemPress(id: string, paidMethod: PaymentMethod | null) {
    if (paidMethod !== null) {
      supabase.from('order_items').update({ paid_method: null }).eq('id', id);
      return;
    }
    toggle(id);
  }

  function requestMarkSelectedAsPaid() {
    if (selectedIds.size === 0) return;
    setPaymentError(null);
    setPaymentPromptOpen(true);
  }

  async function confirmPayment(method: PaymentMethod) {
    setSavingPayment(true);
    setPaymentError(null);

    const { error } = await supabase
      .from('order_items')
      .update({ paid_method: method })
      .in('id', Array.from(selectedIds));

    setSavingPayment(false);

    if (error) {
      setPaymentError(error.message);
      return;
    }

    setSelectedIds(new Set());
    setPaymentPromptOpen(false);
  }

  function selectAll() {
    setSelectedIds(new Set(items.filter((item) => item.paid_method === null).map((item) => item.id)));
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
  const paidItems = items.filter((item) => item.paid_method !== null);
  const paidTotal = paidItems.reduce((sum, item) => sum + (itemTotal(item) ?? 0), 0);
  const cardTotal = items
    .filter((item) => item.paid_method === 'karte')
    .reduce((sum, item) => sum + (itemTotal(item) ?? 0), 0);
  const cashTotal = items
    .filter((item) => item.paid_method === 'bargeld')
    .reduce((sum, item) => sum + (itemTotal(item) ?? 0), 0);
  const openTotal = grandTotal - paidTotal;
  const selectedTotal = items
    .filter((item) => selectedIds.has(item.id))
    .reduce((sum, item) => sum + (itemTotal(item) ?? 0), 0);
  const hasUnpriced = items.some((item) => itemTotal(item) === null);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>
          Tisch {tableNumber}
          {showClosed ? ' (abgeschlossen)' : ''}
        </Text>
        <Text style={styles.grandTotal}>Gesamt: {formatPrice(grandTotal)}</Text>
      </View>
      {paidItems.length > 0 && (
        <View style={styles.paidSummaryRow}>
          <View>
            <Text style={styles.paidSummaryText}>Bezahlt: {formatPrice(paidTotal)}</Text>
            <Text style={styles.paidSummarySplit}>
              Karte {formatPrice(cardTotal)} · Bargeld {formatPrice(cashTotal)}
            </Text>
          </View>
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
        onPress={requestMarkSelectedAsPaid}
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
          const paidMethod = item.paid_method;
          const paid = paidMethod !== null;
          const total = itemTotal(item);
          const isDone = item.status === 'fertig';
          const row = (
            <TouchableOpacity
              style={[styles.itemRow, selected && styles.itemRowSelected, paid && styles.itemRowPaid]}
              onPress={() => handleItemPress(item.id, paidMethod)}
            >
              {paid ? (
                <View style={styles.paidBadge}>
                  <Text style={styles.paidBadgeText}>{paidMethod === 'karte' ? 'K' : 'B'}</Text>
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
              <TouchableOpacity
                onPress={() => requestRemoveItem(item)}
                style={styles.itemRemoveButton}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.itemRemoveButtonText}>×</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          );

          // Wisch-Geste als zweiter Weg (neben dem X-Button oben), eine falsch bestellte
          // oder aufs Haus gehende Position loszuwerden — siehe DeviceTicketBoard für
          // dieselbe Geste beim Abhaken ganzer Bestellungen. Anders als dort öffnet das
          // Swipe hier nur die Bestätigung (statt sofort zu löschen), weil ein gelöschtes
          // order_item — anders als ein Fertig/Offen-Toggle — nicht rückgängig zu machen ist.
          return (
            <Swipeable
              renderRightActions={() => (
                <TouchableOpacity style={styles.swipeRemoveAction} onPress={() => requestRemoveItem(item)}>
                  <Text style={styles.swipeRemoveActionText}>🗑 Entfernen</Text>
                </TouchableOpacity>
              )}
              onSwipeableOpen={(direction) => {
                if (direction === 'right') requestRemoveItem(item);
              }}
              overshootRight={false}
              rightThreshold={40}
            >
              {row}
            </Swipeable>
          );
        }}
        ListEmptyComponent={<Text style={styles.emptyText}>Keine Positionen für diesen Tisch.</Text>}
      />

      <View style={styles.footer}>
        {hasUnpriced && <Text style={styles.footerNote}>Enthält Positionen ohne hinterlegten Preis.</Text>}
        <View style={styles.footerRow}>
          <Text style={styles.footerLabel}>
            Noch offen ({items.length - paidItems.length}/{items.length})
          </Text>
          <Text style={styles.footerValue}>{formatPrice(openTotal)}</Text>
        </View>
        <Text style={styles.footerDisclaimer}>
          Vorläufige Berechnung zur Orientierung, z.B. für getrennte Rechnungen — gebucht wird nichts. Die
          verbindliche Rechnung druckt weiterhin die Kasse.
        </Text>

        {!showClosed && (
          <TouchableOpacity
            style={[styles.closeTableButton, items.length === 0 && styles.closeTableButtonDisabled]}
            onPress={() => setCloseConfirmOpen(true)}
            disabled={items.length === 0}
          >
            <Text style={styles.closeTableButtonText}>Tisch abschließen</Text>
          </TouchableOpacity>
        )}
      </View>

      <Modal visible={paymentPromptOpen} transparent animationType="fade" onRequestClose={() => setPaymentPromptOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Zahlungsart</Text>
            <Text style={styles.modalBody}>
              {selectedIds.size} Position(en) · {formatPrice(selectedTotal)}
            </Text>
            {paymentError && <Text style={styles.errorText}>{paymentError}</Text>}
            <TouchableOpacity
              style={[styles.paymentMethodButton, savingPayment && styles.confirmButtonDisabled]}
              onPress={() => confirmPayment('karte')}
              disabled={savingPayment}
            >
              {savingPayment ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.paymentMethodButtonText}>Karte</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.paymentMethodButton, savingPayment && styles.confirmButtonDisabled]}
              onPress={() => confirmPayment('bargeld')}
              disabled={savingPayment}
            >
              {savingPayment ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.paymentMethodButtonText}>Bargeld</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => setPaymentPromptOpen(false)}
              disabled={savingPayment}
            >
              <Text style={styles.cancelButtonText}>Abbrechen</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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
              Nimmt diesen Tisch aus Küche, Bar, Status und der aktuellen Tischübersicht raus und macht ihn wieder
              frei für neue Gäste. Die Bestellung wird dabei nicht gelöscht, sondern bleibt unter "Vergangene
              Tische" nachschlagbar, bis der Tagesabschluss gemacht wird.
              {openTotal > 0
                ? ` Achtung: noch ${items.length - paidItems.length} Position(en) im Wert von ${formatPrice(openTotal)} sind nicht als bezahlt markiert.`
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

      <Modal visible={removeItem !== null} transparent animationType="fade" onRequestClose={cancelRemoveItem}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Position entfernen?</Text>
            <Text style={styles.modalBody}>
              {removeItem?.menu_item.name_hanzi} ({removeItem?.menu_item.name_de}
              {removeItem?.variant_de ? ` · ${removeItem.variant_de}` : ''}) wird unwiderruflich aus der Bestellung
              gelöscht — auch aus Küche/Bar, falls dort noch offen. Für falsch bestellte Positionen oder Einladungen
              aufs Haus.
            </Text>
            {removeError && <Text style={styles.errorText}>{removeError}</Text>}
            <TouchableOpacity
              style={[styles.confirmButton, removing && styles.confirmButtonDisabled]}
              onPress={confirmRemoveItem}
              disabled={removing}
            >
              {removing ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmButtonText}>Ja, entfernen</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelButton} onPress={cancelRemoveItem} disabled={removing}>
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
      alignItems: 'flex-start',
      paddingHorizontal: 16,
      paddingTop: 8,
    },
    paidSummaryText: { fontSize: 13, fontWeight: '600', color: colors.success },
    paidSummarySplit: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
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
    // X-Button zum Entfernen einer einzelnen Position (siehe requestRemoveItem) — bewusst
    // dezent statt eines auffälligen roten Buttons, das eigentliche "das ist eine
    // Löschaktion"-Signal kommt über das Bestätigungs-Modal.
    itemRemoveButton: {
      width: 26,
      height: 26,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 8,
      backgroundColor: colors.surfaceAlt,
    },
    itemRemoveButtonText: { fontSize: 16, fontWeight: '700', color: colors.textSecondary, lineHeight: 18 },
    // Rotes Aktionsfeld, das beim Wischen einer Position nach links von rechts
    // hereinrutscht (siehe renderRightActions oben) — marginBottom identisch zu
    // itemRow, damit das Feld nicht in den Abstand zur nächsten Position hineinragt.
    swipeRemoveAction: {
      width: 110,
      marginBottom: 8,
      borderRadius: 10,
      backgroundColor: colors.danger,
      alignItems: 'center',
      justifyContent: 'center',
    },
    swipeRemoveActionText: { color: '#fff', fontWeight: '700', fontSize: 13 },
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
    paymentMethodButton: {
      backgroundColor: '#16a34a',
      borderRadius: 10,
      paddingVertical: 14,
      alignItems: 'center',
      marginBottom: 10,
    },
    paymentMethodButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  });
