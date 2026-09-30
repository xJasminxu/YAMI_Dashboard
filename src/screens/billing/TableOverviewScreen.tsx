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
import { useDeviceOrders, type DeviceOrderItem } from '../../hooks/useDeviceOrders';
import { ADMIN_PIN } from '../../lib/adminPin';
import { formatDateTime } from '../../lib/datetime';
import { itemTotal, formatPrice } from '../../lib/pricing';
import { logActivity } from '../../lib/activityLog';
import DiscountDialog from '../../components/DiscountDialog';
import { Feather } from '@expo/vector-icons';
import { useI18n } from '../../i18n/LanguageContext';
import { supabase } from '../../lib/supabase';
import type { RootStackParamList } from '../../navigation/types';
import type { ThemeColors } from '../../theme/colors';
import { useThemedStyles } from '../../theme/useThemedStyles';
import { useTheme } from '../../theme/ThemeContext';

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
  const { t } = useI18n();
  const { colors } = useTheme();
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

  // Alle Positionen der aktuell offenen Tische, je Tischnummer — für den "Positionen
  // verschieben"-Dialog (✂️, siehe MoveItemsDialog), der die Auswahl direkt hier in der
  // Übersicht anbietet statt erst in der Abrechnung (TableBillingScreen.tsx).
  const openItemsByTable = useMemo(() => {
    const map = new Map<number, DeviceOrderItem[]>();
    for (const order of [...kitchen.orders, ...bar.orders]) {
      if (order.closedAt !== null) continue;
      const list = map.get(order.table.number) ?? [];
      list.push(...order.items);
      map.set(order.table.number, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.menu_item.category.sort_order - b.menu_item.category.sort_order);
    }
    return map;
  }, [kitchen.orders, bar.orders]);

  // Tab: aktuelle (offene) Tische oder "Vergangene Tische" (per "Tisch abschließen"
  // geschlossen). Der Tagesumsatz hat seit Kurzem einen eigenen Menüpunkt (RevenueScreen.tsx)
  // statt oben in dieser Übersicht zu stehen.
  const [tab, setTab] = useState<'aktuell' | 'vergangen'>('aktuell');

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
      setDeleteError(t('wrongPin'));
      return;
    }

    setDeleting(true);
    setDeleteError(null);

    // Für das Admin-Protokoll (lib/activityLog.ts): welche Positionen mit dieser Karte
    // gelöscht werden — vorher einsammeln, danach sind sie weg.
    const target = deleteTarget;
    const deletedItems = [...kitchen.orders, ...bar.orders]
      .filter(
        (order) =>
          order.table.id === target.row.tableId &&
          (target.past ? order.closedAt === target.row.closedAt : order.closedAt === null)
      )
      .flatMap((order) => order.items);

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

    logActivity({
      kind: 'table_deleted',
      tableNumber: target.row.tableNumber,
      summary: `Tisch ${target.row.tableNumber} gelöscht (${deletedItems.length} ${deletedItems.length === 1 ? 'Position' : 'Positionen'}${target.past ? ', bereits abgeschlossen' : ''})`,
      amount: target.row.priceSum,
      details: deletedItems.map((item) => ({
        name: `${item.menu_item.item_code ? `${item.menu_item.item_code} · ` : ''}${item.menu_item.name_de}${item.variant_de ? ` · ${item.variant_de}` : ''}`,
        price: itemTotal(item),
      })),
    });

    setDeleteTarget(null);
    setDeletePin('');
  }

  // 🔀 "Tisch wechseln / zusammenführen" und ✂️ "Positionen verschieben" — beide leben
  // hier in der Übersicht (vorher unten in TableBillingScreen.tsx), weil man dafür ohnehin
  // mehrere Tische gleichzeitig im Blick braucht. Beide nutzen denselben Zielauswahl-Dialog
  // (TargetTablePicker): offene Tische als antippbare Kacheln + freie Nummerneingabe.
  // 🏷️ Rabatt direkt auf einen offenen Tisch buchen (components/DiscountDialog.tsx).
  const [discountRow, setDiscountRow] = useState<TableRow | null>(null);
  const [moveTableSource, setMoveTableSource] = useState<TableRow | null>(null);
  const [moveItemsSource, setMoveItemsSource] = useState<TableRow | null>(null);
  const [moveItemIds, setMoveItemIds] = useState<Set<string>>(new Set());
  const [moveTargetText, setMoveTargetText] = useState('');
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);

  function openMoveTable(row: TableRow) {
    setMoveTargetText('');
    setMoveError(null);
    setMoveTableSource(row);
  }

  function openMoveItems(row: TableRow) {
    setMoveTargetText('');
    setMoveError(null);
    setMoveItemIds(new Set());
    setMoveItemsSource(row);
  }

  function closeMoveDialogs() {
    if (moving) return;
    setMoveTableSource(null);
    setMoveItemsSource(null);
    setMoveError(null);
  }

  function toggleMoveItem(id: string) {
    setMoveItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Gleiche tables-Upsert-Logik wie beim Absenden einer Bestellung (OrderScreen.tsx
  // submitOrder), damit eine noch nie benutzte Zielnummer automatisch angelegt wird.
  async function upsertTargetTable(targetNumber: number): Promise<string | null> {
    const { data, error } = await supabase
      .from('tables')
      .upsert({ number: targetNumber }, { onConflict: 'number' })
      .select()
      .single();
    if (error || !data) {
      setMoveError(error?.message ?? t('tableCreateError'));
      return null;
    }
    return data.id as string;
  }

  function parseTarget(source: TableRow): number | null {
    const targetNumber = parseInt(moveTargetText, 10);
    if (!targetNumber || targetNumber === source.tableNumber) {
      setMoveError(t('invalidTargetTable'));
      return null;
    }
    return targetNumber;
  }

  // Verschiebt ALLE offenen Bestellungen des Tisches (orders.table_id) auf die Zielnummer.
  // Hat das Ziel schon laufende Bestellungen, landen beide unter derselben table_id und
  // werden so automatisch zu einer gemeinsamen Rechnung zusammengeführt — "umziehen" und
  // "zusammenführen" sind derselbe Mechanismus, nur mit/ohne Kollision.
  async function confirmMoveTable() {
    if (!moveTableSource) return;
    const targetNumber = parseTarget(moveTableSource);
    if (targetNumber === null) return;

    setMoving(true);
    setMoveError(null);
    const targetTableId = await upsertTargetTable(targetNumber);
    if (!targetTableId) {
      setMoving(false);
      return;
    }

    const { error } = await supabase
      .from('orders')
      .update({ table_id: targetTableId })
      .eq('table_id', moveTableSource.tableId)
      .is('closed_at', null);

    setMoving(false);
    if (error) {
      setMoveError(error.message);
      return;
    }
    setMoveTableSource(null);
  }

  // Hängt nur die ausgewählten Positionen (order_items.order_id) auf die offene Bestellung
  // des Zieltisches um — bzw. auf eine neu angelegte, falls dort noch keine läuft. Der Rest
  // des Ursprungstisches bleibt unverändert stehen.
  async function confirmMoveItems() {
    if (!moveItemsSource || moveItemIds.size === 0) return;
    const targetNumber = parseTarget(moveItemsSource);
    if (targetNumber === null) return;

    setMoving(true);
    setMoveError(null);
    const targetTableId = await upsertTargetTable(targetNumber);
    if (!targetTableId) {
      setMoving(false);
      return;
    }

    const { data: existingOrder, error: findError } = await supabase
      .from('orders')
      .select('id')
      .eq('table_id', targetTableId)
      .is('closed_at', null)
      .limit(1)
      .maybeSingle();
    if (findError) {
      setMoving(false);
      setMoveError(findError.message);
      return;
    }

    let targetOrderId = existingOrder?.id as string | undefined;
    if (!targetOrderId) {
      const { data: newOrder, error: createError } = await supabase
        .from('orders')
        .insert({ table_id: targetTableId })
        .select('id')
        .single();
      if (createError || !newOrder) {
        setMoving(false);
        setMoveError(createError?.message ?? t('orderCreateError'));
        return;
      }
      targetOrderId = newOrder.id;
    }

    const { error } = await supabase
      .from('order_items')
      .update({ order_id: targetOrderId })
      .in('id', Array.from(moveItemIds));

    setMoving(false);
    if (error) {
      setMoveError(error.message);
      return;
    }
    setMoveItemIds(new Set());
    setMoveItemsSource(null);
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
        <Text style={styles.errorText}>{t('overviewLoadError', { error: loadError })}</Text>
      </View>
    );
  }

  return (
    <>
      <View style={styles.container}>
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tab, tab === 'aktuell' && styles.tabActive]}
            onPress={() => setTab('aktuell')}
          >
            <Text style={[styles.tabText, tab === 'aktuell' && styles.tabTextActive]}>{t('tabCurrent', { n: current.length })}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, tab === 'vergangen' && styles.tabActive]}
            onPress={() => setTab('vergangen')}
          >
            <Text style={[styles.tabText, tab === 'vergangen' && styles.tabTextActive]}>
              {t('tabPast', { n: past.length })}
            </Text>
          </TouchableOpacity>
        </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.listContent}>
        {tab === 'aktuell' ? (
          <>
            {/* Belegte Tische auf einen Blick (anstelle des früheren Umsatz-Kastens): eine
                Kachel je offenem Tisch, Farbe nach Küchen-/Bar-Fortschritt — grün = alles
                raus, orange = noch etwas offen. Antippen öffnet direkt die Abrechnung. */}
            <View style={styles.occupiedCard}>
              <Text style={styles.occupiedTitle}>
                {current.length === 0
                  ? t('noTablesOccupied')
                  : current.length === 1
                    ? t('oneTableOccupied')
                    : t('tablesOccupied', { n: current.length })}
              </Text>
              {current.length > 0 && (
                <View style={styles.occupiedGrid}>
                  {current.map((row) => {
                    const allDone = row.total > 0 && row.done === row.total;
                    return (
                      <TouchableOpacity
                        key={row.tableNumber}
                        style={[styles.occupiedTile, allDone ? styles.occupiedTileDone : styles.occupiedTileOpen]}
                        onPress={() => navigation.navigate('TableBilling', { tableNumber: row.tableNumber })}
                        accessibilityLabel={t('tileA11y', { n: row.tableNumber, done: row.done, total: row.total })}
                      >
                        <Text style={styles.occupiedTileNumber}>{row.tableNumber}</Text>
                        <Text style={styles.occupiedTileMeta}>
                          {row.done}/{row.total}
                        </Text>
                        {row.note && (
                          <Feather name="file-text" size={11} color={colors.textMuted} style={styles.occupiedTileNote} />
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>
            {current.map((row) => (
              <TableCard
                key={row.tableNumber}
                row={row}
                styles={styles}
                onPress={() => navigation.navigate('TableBilling', { tableNumber: row.tableNumber })}
                onNewOrder={() => navigation.navigate('Order', { tableNumber: row.tableNumber })}
                onMoveTable={() => openMoveTable(row)}
                onMoveItems={() => openMoveItems(row)}
                onDiscount={() => setDiscountRow(row)}
                onDelete={() => requestDeleteTable(row, false)}
              />
            ))}
            {current.some((row) => row.hasUnpriced) && (
              <Text style={styles.footnote}>{t('unpricedFootnote')}</Text>
            )}
          </>
        ) : (
          <>
            {past.length === 0 && <Text style={styles.emptyText}>{t('noPastTables')}</Text>}
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
            {past.some((row) => row.hasUnpriced) && (
              <Text style={styles.footnote}>{t('unpricedFootnote')}</Text>
            )}
          </>
        )}
      </ScrollView>
      </View>

      <DiscountDialog
        tableNumber={discountRow?.tableNumber ?? null}
        tableTotal={discountRow?.priceSum ?? null}
        onClose={() => setDiscountRow(null)}
      />

      <Modal visible={moveTableSource !== null} transparent animationType="fade" onRequestClose={closeMoveDialogs}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalCard}>
            <Feather name="shuffle" size={28} color={colors.textMuted} style={styles.modalIcon} />
            <Text style={styles.modalTitle}>{t('moveTableTitle', { n: moveTableSource?.tableNumber ?? '' })}</Text>
            <Text style={styles.modalBody}>{t('moveTableBody')}</Text>
            {moveTableSource && (
              <TargetTablePicker
                sourceNumber={moveTableSource.tableNumber}
                openTables={current}
                value={moveTargetText}
                onChange={setMoveTargetText}
                styles={styles}
              />
            )}
            {moveError && <Text style={styles.modalErrorText}>{moveError}</Text>}
            <TouchableOpacity
              style={[styles.primaryButton, (moving || !moveTargetText) && styles.primaryButtonDisabled]}
              onPress={confirmMoveTable}
              disabled={moving || !moveTargetText}
            >
              {moving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {moveTargetText && current.some((r) => r.tableNumber === parseInt(moveTargetText, 10))
                    ? t('mergeWith', { n: moveTargetText })
                    : moveTargetText
                      ? t('moveTo', { n: moveTargetText })
                      : t('chooseTargetTable')}
                </Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelButton} onPress={closeMoveDialogs} disabled={moving}>
              <Text style={styles.cancelButtonText}>{t('cancel')}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={moveItemsSource !== null} transparent animationType="fade" onRequestClose={closeMoveDialogs}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.modalCard, styles.modalCardTall]}>
            <Feather name="scissors" size={28} color={colors.textMuted} style={styles.modalIcon} />
            <Text style={styles.modalTitle}>{t('moveItemsTitle', { n: moveItemsSource?.tableNumber ?? '' })}</Text>
            <Text style={styles.modalStep}>{t('stepPickItems')}</Text>
            <ScrollView style={styles.moveItemsList}>
              {(moveItemsSource ? openItemsByTable.get(moveItemsSource.tableNumber) ?? [] : []).map((item) => {
                const selected = moveItemIds.has(item.id);
                const total = itemTotal(item);
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.moveItemRow, selected && styles.moveItemRowSelected]}
                    onPress={() => toggleMoveItem(item.id)}
                  >
                    <View style={[styles.checkbox, selected && styles.checkboxChecked]}>
                      {selected && <Text style={styles.checkboxMark}>✓</Text>}
                    </View>
                    <View style={styles.moveItemText}>
                      <Text style={styles.moveItemName} numberOfLines={1}>
                        {item.menu_item.item_code ? `${item.menu_item.item_code} · ` : ''}
                        {item.menu_item.name_hanzi ?? item.menu_item.name_de}
                        {item.variant_hanzi ? ` · ${item.variant_hanzi}` : ''}
                      </Text>
                      {item.menu_item.name_hanzi && (
                        <Text style={styles.moveItemSub} numberOfLines={1}>
                          {item.menu_item.name_de}
                          {item.variant_de ? ` · ${item.variant_de}` : ''}
                        </Text>
                      )}
                    </View>
                    <Text style={styles.moveItemPrice}>{total !== null ? formatPrice(total) : '–'}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <Text style={styles.modalStep}>{t('stepPickTarget')}</Text>
            {moveItemsSource && (
              <TargetTablePicker
                sourceNumber={moveItemsSource.tableNumber}
                openTables={current}
                value={moveTargetText}
                onChange={setMoveTargetText}
                styles={styles}
              />
            )}
            {moveError && <Text style={styles.modalErrorText}>{moveError}</Text>}
            <TouchableOpacity
              style={[
                styles.primaryButton,
                (moving || !moveTargetText || moveItemIds.size === 0) && styles.primaryButtonDisabled,
              ]}
              onPress={confirmMoveItems}
              disabled={moving || !moveTargetText || moveItemIds.size === 0}
            >
              {moving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {moveItemIds.size === 0
                    ? t('pickItems')
                    : !moveTargetText
                      ? t('selectedPickTarget', { n: moveItemIds.size })
                      : t('moveItemsTo', { n: moveItemIds.size, table: moveTargetText })}
                </Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelButton} onPress={closeMoveDialogs} disabled={moving}>
              <Text style={styles.cancelButtonText}>{t('cancel')}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={deleteTarget !== null} transparent animationType="fade" onRequestClose={cancelDeleteTable}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalCard}>
            <Feather name="trash-2" size={28} color={colors.danger} style={styles.modalIcon} />
            <Text style={styles.modalTitle}>{t('deleteTableTitle', { n: deleteTarget?.row.tableNumber ?? '' })}</Text>
            <Text style={styles.modalBody}>
              {deleteTarget?.past ? t('deleteTableBodyPast') : t('deleteTableBodyOpen')}
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
              {deleting ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmButtonText}>{t('confirmDelete')}</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelButton} onPress={cancelDeleteTable} disabled={deleting}>
              <Text style={styles.cancelButtonText}>{t('cancel')}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

// Zielauswahl für 🔀/✂️: alle aktuell offenen Tische (außer dem Quelltisch) als große
// Kacheln zum Antippen — ein belegter Tisch bedeutet "zusammenführen" (🔗) — plus ein
// Nummernfeld für einen noch freien Tisch.
function TargetTablePicker({
  sourceNumber,
  openTables,
  value,
  onChange,
  styles,
}: {
  sourceNumber: number;
  openTables: TableRow[];
  value: string;
  onChange: (value: string) => void;
  styles: OverviewStyles;
}) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const others = openTables.filter((row) => row.tableNumber !== sourceNumber);
  return (
    <View style={styles.targetPicker}>
      {others.length > 0 && (
        <View style={styles.targetChips}>
          {others.map((row) => {
            const active = value === String(row.tableNumber);
            return (
              <TouchableOpacity
                key={row.tableNumber}
                style={[styles.targetChip, active && styles.targetChipActive]}
                onPress={() => onChange(String(row.tableNumber))}
              >
                <View style={styles.targetChipInner}>
                  <Feather name="link" size={14} color={active ? colors.accent : colors.textMuted} />
                  <Text style={[styles.targetChipText, active && styles.targetChipTextActive]}>{row.tableNumber}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
      <TextInput
        style={styles.targetInput}
        value={value}
        onChangeText={(text) => onChange(text.replace(/[^0-9]/g, ''))}
        placeholder={t('otherTableNumber')}
        placeholderTextColor={styles.pinInputPlaceholder.color as string}
        keyboardType="number-pad"
        maxLength={3}
      />
    </View>
  );
}

type FeatherName = React.ComponentProps<typeof Feather>['name'];

// Runder Icon-Button der Tischkarte — dezentes Feather-Linien-Icon (früher Emojis, die
// wirkten zu bunt/unruhig) statt Text, Beschriftung nur für Screenreader.
function IconButton({
  icon,
  label,
  onPress,
  danger = false,
  styles,
}: {
  icon: FeatherName;
  label: string;
  onPress: () => void;
  danger?: boolean;
  styles: OverviewStyles;
}) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      style={[styles.iconButton, danger && styles.iconButtonDanger]}
      onPress={onPress}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Feather name={icon} size={20} color={danger ? colors.danger : colors.textSecondary} />
    </TouchableOpacity>
  );
}

function TableCard({
  row,
  past = false,
  onPress,
  onNewOrder,
  onMoveTable,
  onMoveItems,
  onDiscount,
  onDelete,
  styles,
}: {
  row: TableRow;
  past?: boolean;
  onPress: () => void;
  // Öffnet die Bestellaufnahme mit dieser Tischnummer vorausgefüllt (siehe
  // RootStackParamList['Order']), statt erst zurück ins Hauptmenü zu müssen.
  onNewOrder: () => void;
  // 🔀 / ✂️ — nur für aktuell offene Tische (nicht "Vergangene Tische").
  onMoveTable?: () => void;
  onMoveItems?: () => void;
  // 🏷️ Rabatt auf diesen Tisch — ebenfalls nur für offene Tische.
  onDiscount?: () => void;
  // Öffnet den PIN-Dialog zum Löschen der Bestellungen dieser Karte (siehe
  // requestDeleteTable) — nur die Bestellungen, nicht die Tischnummer selbst.
  onDelete: () => void;
  styles: OverviewStyles;
}) {
  const { t } = useI18n();
  const { colors } = useTheme();
  return (
    <View style={[styles.card, past && styles.cardPast]}>
      <TouchableOpacity style={styles.cardMain} onPress={onPress}>
        <View style={styles.cardLeft}>
          <View style={styles.tableLabelRow}>
            <Text style={styles.tableLabel}>{t('table', { n: row.tableNumber })}</Text>
            {/* Reiner Hinweis, dass eine Notiz existiert — bearbeitet wird sie ausschließlich
                in TableBillingScreen.tsx (Checkout). */}
            {row.note && <Feather name="file-text" size={14} color={colors.textMuted} />}
          </View>
          {past && row.closedAt && (
            <Text style={styles.closedAtText}>{t('closedAt', { time: formatDateTime(row.closedAt) })}</Text>
          )}
          <View style={styles.progressRow}>
            {row.total > 0 && row.done === row.total ? (
              <Feather name="check-circle" size={13} color={colors.success} />
            ) : (
              <Feather name="clock" size={13} color={colors.textMuted} />
            )}
            <Text style={styles.progressText}>{t('doneOfTotal', { done: row.done, total: row.total })}</Text>
          </View>
        </View>
        <View style={styles.cardRight}>
          <Text style={styles.cardSumText}>
            {formatPrice(row.priceSum)}
            {row.hasUnpriced ? '*' : ''}
          </Text>
          <Text style={styles.openBillHint}>{t('openBill')}</Text>
        </View>
      </TouchableOpacity>
      <View style={styles.cardActions}>
        <IconButton icon="plus" label={t('a11yNewOrder')} onPress={onNewOrder} styles={styles} />
        {onMoveTable && (
          <IconButton icon="shuffle" label={t('a11yMoveTable')} onPress={onMoveTable} styles={styles} />
        )}
        {onMoveItems && (
          <IconButton icon="scissors" label={t('a11yMoveItems')} onPress={onMoveItems} styles={styles} />
        )}
        {onDiscount && <IconButton icon="tag" label={t('a11yDiscount')} onPress={onDiscount} styles={styles} />}
        <View style={styles.cardActionsSpacer} />
        <IconButton icon="trash-2" label={t('a11yDeleteTable')} onPress={onDelete} danger styles={styles} />
      </View>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
    errorText: { color: colors.danger, padding: 16 },
    listContent: { padding: 12 },
    scroll: { flex: 1 },
    tabBar: {
      flexDirection: 'row',
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.surface,
    },
    tab: { flex: 1, paddingVertical: 14, alignItems: 'center' },
    tabActive: { borderBottomWidth: 3, borderBottomColor: colors.accent },
    tabText: { fontSize: 15, fontWeight: '600', color: colors.textMuted },
    tabTextActive: { color: colors.text, fontWeight: '800' },
    // "X Tische belegt"-Übersicht oben im Aktuell-Tab (ersetzt den früheren Umsatz-Kasten).
    occupiedCard: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: 16,
      padding: 14,
      marginBottom: 16,
    },
    occupiedTitle: { fontSize: 15, fontWeight: '800', color: colors.text, marginBottom: 10, textAlign: 'center' },
    occupiedGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
    occupiedTile: {
      width: 68,
      paddingVertical: 8,
      borderRadius: 12,
      alignItems: 'center',
      borderWidth: 2,
    },
    occupiedTileOpen: { backgroundColor: colors.surface, borderColor: colors.warning },
    occupiedTileDone: { backgroundColor: colors.successSurface, borderColor: colors.success },
    occupiedTileNumber: { fontSize: 22, fontWeight: '800', color: colors.text },
    occupiedTileMeta: { fontSize: 11, fontWeight: '700', color: colors.textSecondary, marginTop: 2 },
    occupiedTileNote: { position: 'absolute', top: 2, right: 4, fontSize: 11 },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
      marginBottom: 12,
    },
    cardMain: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    // Icon-Leiste unten auf jeder Tischkarte (➕ 🔀 ✂️ 🏷️ … 🗑️), siehe IconButton.
    cardActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginTop: 12,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    cardActionsSpacer: { flex: 1 },
    iconButton: {
      width: 46,
      height: 46,
      borderRadius: 14,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconButtonDanger: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
    openBillHint: { fontSize: 12, color: colors.accent, fontWeight: '700', marginTop: 4 },
    cardPast: { opacity: 0.6 },
    cardLeft: { flex: 1, paddingRight: 12 },
    tableLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    tableLabel: { fontSize: 18, fontWeight: '700', color: colors.text },
    closedAtText: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
    cardRight: { alignItems: 'flex-end' },
    cardSumText: { fontSize: 18, fontWeight: '700', color: colors.text },
    progressRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
    progressText: { fontSize: 13, color: colors.textSecondary },
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
    modalIcon: { alignSelf: 'center', marginBottom: 8 },
    modalCardTall: { maxHeight: '90%' },
    modalStep: { fontSize: 13, fontWeight: '800', color: colors.textMuted, marginTop: 4, marginBottom: 8 },
    moveItemsList: { maxHeight: 260, marginBottom: 12 },
    moveItemRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      padding: 10,
      borderRadius: 10,
      marginBottom: 6,
      backgroundColor: colors.surfaceAlt,
    },
    moveItemRowSelected: { backgroundColor: colors.accentSurface },
    moveItemText: { flex: 1 },
    moveItemName: { fontSize: 15, fontWeight: '600', color: colors.text },
    moveItemSub: { fontSize: 12, color: colors.textMuted },
    moveItemPrice: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
    checkbox: {
      width: 24,
      height: 24,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: colors.textFaint,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxChecked: { backgroundColor: colors.accent, borderColor: colors.accent },
    checkboxMark: { color: '#fff', fontSize: 15, fontWeight: '700' },
    targetPicker: { marginBottom: 12 },
    targetChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
    targetChip: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 12,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1.5,
      borderColor: 'transparent',
    },
    targetChipActive: { backgroundColor: colors.accentSurface, borderColor: colors.accent },
    targetChipText: { fontSize: 16, fontWeight: '700', color: colors.text },
    targetChipTextActive: { color: colors.accent },
    targetChipInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    targetInput: {
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 16,
      color: colors.text,
      textAlign: 'center',
    },
    primaryButton: {
      backgroundColor: colors.accent,
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 12,
      alignItems: 'center',
      marginBottom: 6,
    },
    primaryButtonDisabled: { backgroundColor: colors.textFaint },
    primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center' },
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
