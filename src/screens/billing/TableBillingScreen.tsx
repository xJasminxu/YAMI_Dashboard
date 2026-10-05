import { useMemo, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useDeviceOrders } from '../../hooks/useDeviceOrders';
import type { DeviceOrderItem } from '../../hooks/useDeviceOrders';
import { formatDateTime } from '../../lib/datetime';
import { itemTotal, formatPrice } from '../../lib/pricing';
import { logActivity } from '../../lib/activityLog';
import DiscountDialog from '../../components/DiscountDialog';
import { useI18n } from '../../i18n/LanguageContext';
import { supabase } from '../../lib/supabase';
import type { RootStackParamList } from '../../navigation/types';
import type { PaymentMethod } from '../../types/database';
import type { ThemeColors } from '../../theme/colors';
import { useThemedStyles } from '../../theme/useThemedStyles';

type Props = NativeStackScreenProps<RootStackParamList, 'TableBilling'>;

// Bestellübersicht mit vorläufiger Abrechnung: Bedienung kann einzelne
// Positionen auswählen (z.B. für getrennte Rechnungen) und sieht die Summe
// live. Rein zur Orientierung — die verbindliche Rechnung druckt weiterhin
// das bestehende Kassensystem, hier wird nichts gebucht oder gespeichert.
export default function TableBillingScreen({ route, navigation }: Props) {
  const styles = useThemedStyles(createStyles);
  const { t } = useI18n();
  const { tableNumber, closed: showClosed = false, closedAt } = route.params;
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
  // 🏷️ Rabatt direkt auf diesen Tisch buchen (components/DiscountDialog.tsx).
  const [discountOpen, setDiscountOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  // Tisch wechseln/zusammenführen und einzelne Positionen verschieben leben seit Kurzem in
  // der Tischübersicht (TableOverviewScreen.tsx, 🔀/✂️-Buttons je Tischkarte), nicht mehr hier.
  // Position, die per X-Button/Wisch-Geste zum Entfernen vorgemerkt ist (siehe unten) —
  // anders als "Bezahlt" (rein lokaler UI-Zustand) ist das Entfernen ein echtes Delete
  // auf order_items und damit unwiderruflich, deshalb erst nach Bestätigung im Modal.
  const [removeItem, setRemoveItem] = useState<DeviceOrderItem | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  // Tisch-Notiz (tables.note, siehe schema.sql) — dieselbe Notiz, die auch in
  // TableOverviewScreen.tsx angezeigt/editiert wird, hier zusätzlich direkt in der
  // Bestellübersicht sichtbar/editierbar, damit die Bedienung nicht zurück zur
  // Tischübersicht muss, um sie zu lesen oder zu ändern.
  const [noteEditOpen, setNoteEditOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  // Bei showClosed muss zusätzlich exakt auf closedAt gematcht werden, nicht nur auf
  // "irgendein closed_at gesetzt" — sonst würden bei mehrfach am Tag besetzten Tischen alle
  // vergangenen Besetzungen zusammen angezeigt statt nur der aus der Tischübersicht
  // angetippten (siehe TableOverviewScreen.tsx / RootStackParamList['TableBilling']).
  const tableOrders = useMemo(
    () =>
      [...kitchen.orders, ...bar.orders].filter((order) => {
        if (order.table.number !== tableNumber) return false;
        return showClosed ? order.closedAt === closedAt : order.closedAt === null;
      }),
    [kitchen.orders, bar.orders, tableNumber, showClosed, closedAt]
  );
  // Für "Tisch abschließen" gebraucht — anders als die restliche Seite ist das
  // ein echter Schreibzugriff (update auf orders.closed_at).
  const tableId = tableOrders[0]?.table.id ?? null;
  const tableNote = tableOrders[0]?.table.note ?? null;

  // Offene Positionen zuerst, bereits bezahlte ans Ende — innerhalb beider Gruppen
  // weiterhin nach Kategorie sortiert.
  const items = useMemo(
    () =>
      tableOrders
        .flatMap((order) => order.items)
        .sort(
          (a, b) =>
            Number(a.paid_method !== null) - Number(b.paid_method !== null) ||
            a.menu_item.category.sort_order - b.menu_item.category.sort_order
        ),
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

    // Admin-Protokoll (lib/activityLog.ts): entfernte Position festhalten.
    const isDiscount = removeItem.menu_item.category.is_discount;
    logActivity({
      kind: 'item_deleted',
      tableNumber,
      summary: `${isDiscount ? 'Rabatt' : 'Position'} entfernt: ${removeItem.menu_item.item_code ? `${removeItem.menu_item.item_code} · ` : ''}${isDiscount ? removeItem.variant_de ?? 'Rabatt' : removeItem.menu_item.name_de}${!isDiscount && removeItem.variant_de ? ` · ${removeItem.variant_de}` : ''}`,
      amount: itemTotal(removeItem),
    });

    setRemoveItem(null);
  }

  function openNoteEditor() {
    setNoteError(null);
    setNoteText(tableNote ?? '');
    setNoteEditOpen(true);
  }

  function cancelNoteEdit() {
    setNoteEditOpen(false);
    setNoteError(null);
  }

  // Wie in TableOverviewScreen.tsx: schreibt direkt auf tables.note (leerer Text → null).
  // Läuft über dieselbe Realtime-Subscription auf "tables" (siehe useDeviceOrders), die
  // Tischübersicht sieht die Änderung also ebenfalls sofort.
  async function saveNote() {
    if (!tableId) return;

    setSavingNote(true);
    setNoteError(null);

    const trimmed = noteText.trim();
    const { error } = await supabase
      .from('tables')
      .update({ note: trimmed.length > 0 ? trimmed : null })
      .eq('id', tableId);

    setSavingNote(false);

    if (error) {
      setNoteError(error.message);
      return;
    }

    setNoteEditOpen(false);
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
        <Text style={styles.errorText}>{t('orderLoadError', { error: loadError })}</Text>
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
          {t('table', { n: tableNumber })}
          {showClosed && closedAt ? t('closedSuffix', { time: formatDateTime(closedAt) }) : ''}
        </Text>
        <View style={styles.headerRight}>
          <Text style={styles.grandTotal}>{t('grandTotal', { sum: formatPrice(grandTotal) })}</Text>
          {!showClosed && (
            <TouchableOpacity
              style={[styles.discountIconButton, items.length === 0 && styles.discountIconButtonDisabled]}
              onPress={() => setDiscountOpen(true)}
              disabled={items.length === 0}
              accessibilityLabel={t('addDiscount')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.discountIconText}>🏷️</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
      <TouchableOpacity style={styles.noteRow} onPress={openNoteEditor} disabled={!tableId}>
        {tableNote ? (
          <Text style={styles.noteText} numberOfLines={2}>
            📝 {tableNote}
          </Text>
        ) : (
          <Text style={styles.noteAddText}>{t('addNote')}</Text>
        )}
      </TouchableOpacity>
      {paidItems.length > 0 && (
        <View style={styles.paidSummaryRow}>
          <View>
            <Text style={styles.paidSummaryText}>{t('paidSum', { sum: formatPrice(paidTotal) })}</Text>
            <Text style={styles.paidSummarySplit}>
              {t('paidSplit', { card: formatPrice(cardTotal), cash: formatPrice(cashTotal) })}
            </Text>
          </View>
          <Text style={styles.openSummaryText}>{t('stillOpenSum', { sum: formatPrice(openTotal) })}</Text>
        </View>
      )}
      {/* Auswahl-Links und "Bezahlt" teilen sich eine Zeile, damit die Liste mehr Platz hat. */}
      <View style={styles.selectRow}>
        <TouchableOpacity onPress={selectAll}>
          <Text style={styles.selectAction}>{t('selectAll')}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={selectNone}>
          <Text style={styles.selectAction}>{t('selectNone')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.paidButton, selectedIds.size === 0 && styles.paidButtonDisabled]}
          onPress={requestMarkSelectedAsPaid}
          disabled={selectedIds.size === 0}
        >
          <Text style={styles.paidButtonText} numberOfLines={1}>
            {selectedIds.size > 0
              ? t('paidWithSelection', { n: selectedIds.size, sum: formatPrice(selectedTotal) })
              : t('paid')}
          </Text>
        </TouchableOpacity>
      </View>

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
                {item.note && <Text style={[styles.itemNote, paid && styles.itemDone]}>{t('note', { note: item.note })}</Text>}
                <Text style={[styles.itemTimestamp, paid && styles.itemDone]}>{formatDateTime(item.created_at)}</Text>
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
                  <Text style={styles.swipeRemoveActionText}>{t('remove')}</Text>
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
        ListEmptyComponent={<Text style={styles.emptyText}>{t('noItemsForTable')}</Text>}
        // Hinweistext scrollt mit der Liste mit, statt dauerhaft Platz im Footer zu belegen.
        ListFooterComponent={
          items.length > 0 ? <Text style={styles.footerDisclaimer}>{t('billingDisclaimer')}</Text> : null
        }
      />

      <View style={styles.footer}>
        {hasUnpriced && <Text style={styles.footerNote}>{t('unpricedNote')}</Text>}
        <View style={styles.footerRow}>
          <View style={styles.footerTotals}>
            <Text style={styles.footerLabel}>
              {t('stillOpenCount', { open: items.length - paidItems.length, total: items.length })}
            </Text>
            <Text style={styles.footerValue}>{formatPrice(openTotal)}</Text>
          </View>

          {!showClosed && (
            <TouchableOpacity
              style={[styles.closeTableButton, items.length === 0 && styles.closeTableButtonDisabled]}
              onPress={() => setCloseConfirmOpen(true)}
              disabled={items.length === 0}
            >
              <Text style={styles.closeTableButtonText}>{t('closeTable')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <Modal visible={paymentPromptOpen} transparent animationType="fade" onRequestClose={() => setPaymentPromptOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('paymentMethod')}</Text>
            <Text style={styles.modalBody}>
              {t('paymentSummary', { n: selectedIds.size, sum: formatPrice(selectedTotal) })}
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
                <Text style={styles.paymentMethodButtonText}>{t('card')}</Text>
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
                <Text style={styles.paymentMethodButtonText}>{t('cash')}</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => setPaymentPromptOpen(false)}
              disabled={savingPayment}
            >
              <Text style={styles.cancelButtonText}>{t('cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <DiscountDialog
        tableNumber={discountOpen ? tableNumber : null}
        tableTotal={grandTotal}
        onClose={() => setDiscountOpen(false)}
      />

      <Modal
        visible={closeConfirmOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setCloseConfirmOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('closeTableTitle', { n: tableNumber })}</Text>
            <Text style={styles.modalBody}>
              {t('closeTableBody')}
              {openTotal > 0
                ? t('closeTableUnpaid', { n: items.length - paidItems.length, sum: formatPrice(openTotal) })
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
                <Text style={styles.confirmButtonText}>{t('closeTableConfirm')}</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => setCloseConfirmOpen(false)}
              disabled={closing}
            >
              <Text style={styles.cancelButtonText}>{t('cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={removeItem !== null} transparent animationType="fade" onRequestClose={cancelRemoveItem}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('removeItemTitle')}</Text>
            <Text style={styles.modalBody}>
              {t('removeItemBody', {
                name: removeItem
                  ? `${removeItem.menu_item.name_hanzi ? `${removeItem.menu_item.name_hanzi} (${removeItem.menu_item.name_de})` : removeItem.menu_item.name_de}${removeItem.variant_de ? ` · ${removeItem.variant_de}` : ''}`
                  : '',
              })}
            </Text>
            {removeError && <Text style={styles.errorText}>{removeError}</Text>}
            <TouchableOpacity
              style={[styles.confirmButton, removing && styles.confirmButtonDisabled]}
              onPress={confirmRemoveItem}
              disabled={removing}
            >
              {removing ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmButtonText}>{t('confirmRemove')}</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelButton} onPress={cancelRemoveItem} disabled={removing}>
              <Text style={styles.cancelButtonText}>{t('cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={noteEditOpen} transparent animationType="fade" onRequestClose={cancelNoteEdit}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('tableNoteTitle', { n: tableNumber })}</Text>
            <TextInput
              style={styles.noteInput}
              value={noteText}
              onChangeText={setNoteText}
              placeholder={t('tableNotePlaceholder')}
              placeholderTextColor={styles.noteInputPlaceholder.color as string}
              multiline
              autoFocus
            />
            {noteError && <Text style={styles.errorText}>{noteError}</Text>}
            <TouchableOpacity
              style={[styles.paymentMethodButton, savingNote && styles.confirmButtonDisabled]}
              onPress={saveNote}
              disabled={savingNote}
            >
              {savingNote ? <ActivityIndicator color="#fff" /> : <Text style={styles.paymentMethodButtonText}>{t('save')}</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelButton} onPress={cancelNoteEdit} disabled={savingNote}>
              <Text style={styles.cancelButtonText}>{t('cancel')}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
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
      paddingTop: 12,
    },
    title: { fontSize: 22, fontWeight: '700', color: colors.text },
    headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    grandTotal: { fontSize: 16, fontWeight: '600', color: colors.textSecondary },
    // Kleiner 🏷️-Button oben rechts zum Buchen eines Rabatts (DiscountDialog).
    discountIconButton: {
      width: 34,
      height: 34,
      borderRadius: 17,
      borderWidth: 1.5,
      borderColor: colors.warning,
      alignItems: 'center',
      justifyContent: 'center',
    },
    discountIconButtonDisabled: { borderColor: colors.borderStrong, opacity: 0.5 },
    discountIconText: { fontSize: 16 },
    // Tisch-Notiz-Zeile (tables.note) direkt unter dem Titel — dieselbe Notiz wie in
    // TableOverviewScreen.tsx, hier zusätzlich antippbar zum Lesen/Editieren.
    noteRow: { paddingHorizontal: 16, paddingTop: 6 },
    noteText: { fontSize: 13, color: colors.textSecondary, fontStyle: 'italic' },
    noteAddText: { fontSize: 13, color: colors.primary, fontWeight: '600' },
    noteInput: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      padding: 12,
      minHeight: 80,
      fontSize: 15,
      color: colors.text,
      textAlignVertical: 'top',
      marginBottom: 16,
    },
    noteInputPlaceholder: { color: colors.textFaint },
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
      alignItems: 'center',
      gap: 16,
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    selectAction: { fontSize: 13, color: colors.primary, fontWeight: '600' },
    paidButton: {
      marginLeft: 'auto',
      flexShrink: 1,
      backgroundColor: '#16a34a',
      borderRadius: 10,
      paddingVertical: 8,
      paddingHorizontal: 14,
      alignItems: 'center',
    },
    paidButtonDisabled: { backgroundColor: colors.textFaint },
    paidButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
    listContent: { paddingHorizontal: 16, paddingBottom: 8 },
    itemRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 9,
      marginBottom: 6,
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
    itemTimestamp: { fontSize: 11, color: colors.textFaint, marginTop: 2 },
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
      marginBottom: 6,
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
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    footerNote: { fontSize: 12, color: colors.warning, marginBottom: 6 },
    // Offene Summe links, "Tisch abschließen" rechts in derselben Zeile.
    footerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 12,
    },
    footerTotals: { flexShrink: 1 },
    footerLabel: { fontSize: 14, fontWeight: '700', color: colors.text },
    footerValue: { fontSize: 20, fontWeight: '800', color: colors.text },
    footerDisclaimer: { fontSize: 11, color: colors.textFaint, marginTop: 4, lineHeight: 15 },
    closeTableButton: {
      borderWidth: 1.5,
      borderColor: colors.danger,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 14,
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
