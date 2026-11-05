import { useEffect, useMemo, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useDeviceOrders } from '../../hooks/useDeviceOrders';
import type { DeviceOrderItem } from '../../hooks/useDeviceOrders';
import type { RootStackParamList } from '../../navigation/types';
import {
  dishLabel,
  groupItems,
  minutesSince,
  SECTION_META,
  SECTIONS,
  sectionFor,
  sectionLabel,
  type Section,
} from '../../lib/sections';
import type { ThemeColors } from '../../theme/colors';
import { useThemedStyles } from '../../theme/useThemedStyles';
import { useI18n } from '../../i18n/LanguageContext';

type Props = NativeStackScreenProps<RootStackParamList, 'Status'>;
type StatusStyles = ReturnType<typeof createStyles>;
type SortMode = 'wait' | 'table';

interface TableRow {
  tableNumber: number;
  total: number;
  done: number;
  // Noch offene Positionen je Bereich (Vorspeise/Hauptspeise/BBQ/Getränke/Nachspeisen).
  open: Record<Section, DeviceOrderItem[]>;
  openCount: number;
  // Bestellzeit der ältesten noch offenen Position → Wartezeit des Tisches.
  oldestOpenAt: string;
}

interface ReadyEntry {
  id: string;
  tableNumber: number;
  doneAt: string;
  item: DeviceOrderItem;
}

// "Abholbereit": zuletzt in der Küche fertig gewordene Gerichte (die Bar-Variante dieses
// Streifens wurde bewusst entfernt — Getränke holt die Bar-Kraft selbst bzw. sie sind
// sofort am Tresen, der Streifen war dort nur Rauschen).
const READY_LIMIT = 15;
// Nach dieser Zeit fällt ein Gericht aus dem Abholbereit-Streifen — dann ist es längst
// serviert und würde nur noch vom aktuell Fertigen ablenken.
const READY_MAX_AGE_MIN = 30;
// Ab wann ein wartender Tisch farblich hervorgehoben wird.
const WAIT_WARN_MIN = 20;
const WAIT_ALERT_MIN = 30;

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function emptySections(): Record<Section, DeviceOrderItem[]> {
  return { vorspeise: [], hauptspeise: [], barbecue: [], getraenke: [], nachspeisen: [] };
}

// Status für Bedienungen: alle Tische mit noch offenen Positionen, je Tisch aufgeteilt nach
// Bereich (Vorspeise / Hauptspeise / BBQ / Getränke / Nachspeisen), mit Mengen ("2× …"),
// Wartezeit seit der ältesten offenen Position und Fortschrittsbalken. Oben ein
// Abholbereit-Streifen der zuletzt fertig gewordenen Küchen-Gerichte und Filter-Kacheln, um
// z.B. nur Tische mit offenen Vorspeisen zu sehen. Gespeist aus denselben Realtime-Daten
// wie Küche/Bar.
export default function StatusScreen({ navigation }: Props) {
  const styles = useThemedStyles(createStyles);
  const { lang, t } = useI18n();
  const kitchen = useDeviceOrders('kitchen');
  const bar = useDeviceOrders('bar');
  const [filter, setFilter] = useState<Section | 'all'>('all');
  const [sortMode, setSortMode] = useState<SortMode>('wait');

  // Minütlich neu rendern, damit Wartezeiten/"vor X min" mitlaufen, auch ohne neue Daten.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const rows = useMemo(() => {
    const byTable = new Map<number, TableRow>();

    for (const order of [...kitchen.orders, ...bar.orders]) {
      for (const item of order.items) {
        // Rabatte sind nichts, worauf ein Tisch wartet.
        if (item.menu_item.category.is_discount) continue;
        const row = byTable.get(order.table.number) ?? {
          tableNumber: order.table.number,
          total: 0,
          done: 0,
          open: emptySections(),
          openCount: 0,
          oldestOpenAt: '',
        };
        row.total += 1;
        if (item.status === 'fertig') {
          row.done += 1;
        } else {
          row.open[sectionFor(item)].push(item);
          row.openCount += 1;
          if (!row.oldestOpenAt || item.created_at < row.oldestOpenAt) row.oldestOpenAt = item.created_at;
        }
        byTable.set(order.table.number, row);
      }
    }

    return Array.from(byTable.values()).filter((row) => row.openCount > 0);
  }, [kitchen.orders, bar.orders]);

  const sectionTotals = useMemo(() => {
    const totals = { vorspeise: 0, hauptspeise: 0, barbecue: 0, getraenke: 0, nachspeisen: 0 } as Record<Section, number>;
    for (const row of rows) for (const section of SECTIONS) totals[section] += row.open[section].length;
    return totals;
  }, [rows]);

  const visibleRows = useMemo(() => {
    const filtered = filter === 'all' ? rows : rows.filter((row) => row.open[filter].length > 0);
    return [...filtered].sort((a, b) =>
      sortMode === 'table' ? a.tableNumber - b.tableNumber : a.oldestOpenAt.localeCompare(b.oldestOpenAt)
    );
  }, [rows, filter, sortMode]);

  const ready = useMemo(() => {
    const entries: ReadyEntry[] = [];
    for (const order of kitchen.orders) {
      for (const item of order.items) {
        if (item.status !== 'fertig' || !item.done_at || item.menu_item.category.is_discount) continue;
        if (minutesSince(item.done_at, now) > READY_MAX_AGE_MIN) continue;
        entries.push({ id: item.id, tableNumber: order.table.number, doneAt: item.done_at, item });
      }
    }
    return entries.sort((a, b) => b.doneAt.localeCompare(a.doneAt)).slice(0, READY_LIMIT);
  }, [kitchen.orders, now]);

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
        <Text style={styles.errorText}>{t('statusLoadError', { error: loadError })}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {ready.length > 0 && (
        <View style={styles.readyBar}>
          <Text style={styles.readyTitle}>{t('readyTitle')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.readyContent}>
            {ready.map((entry) => (
              <View key={entry.id} style={styles.readyChip}>
                <Text style={styles.readyTable}>🪑 {entry.tableNumber}</Text>
                <View style={styles.readyTextWrap}>
                  <Text style={styles.readyDish} numberOfLines={1}>
                    {dishLabel(entry.item)}
                  </Text>
                  <Text style={styles.readyMeta}>
                    {formatTime(entry.doneAt)} · {t('minutesAgo', { n: minutesSince(entry.doneAt, now) })}
                  </Text>
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {/* Filter: alle offenen Tische oder nur die mit offenen Positionen eines Bereichs —
            die Zahl zeigt, wie viele Portionen in diesem Bereich insgesamt noch offen sind. */}
        <View style={styles.filterRow}>
          <FilterChip
            label={t('filterAll', { n: rows.length })}
            active={filter === 'all'}
            onPress={() => setFilter('all')}
            styles={styles}
          />
          {SECTIONS.map((section) => (
            <FilterChip
              key={section}
              label={`${SECTION_META[section].icon} ${sectionTotals[section]}`}
              accessibilityLabel={t('sectionOpenCount', { section: sectionLabel(section, lang), n: sectionTotals[section] })}
              active={filter === section}
              dim={sectionTotals[section] === 0}
              onPress={() => setFilter(filter === section ? 'all' : section)}
              styles={styles}
            />
          ))}
        </View>

        <View style={styles.sortRow}>
          <Text style={styles.sortLabel}>
            {visibleRows.length === 1 ? t('tableOpen') : t('tablesOpen', { n: visibleRows.length })}
            {filter !== 'all' ? ` · ${sectionLabel(filter, lang)}` : ''}
          </Text>
          <TouchableOpacity
            style={styles.sortToggle}
            onPress={() => setSortMode(sortMode === 'wait' ? 'table' : 'wait')}
          >
            <Text style={styles.sortToggleText}>
              {sortMode === 'wait' ? t('sortWait') : t('sortTable')}
            </Text>
          </TouchableOpacity>
        </View>

        {visibleRows.length === 0 && (
          <Text style={styles.emptyText}>
            {filter === 'all' ? t('noOpenTables') : t('nothingOpenIn', { section: sectionLabel(filter, lang) })}
          </Text>
        )}

        {visibleRows.map((row) => {
          const waited = minutesSince(row.oldestOpenAt, now);
          const waitStyle =
            waited >= WAIT_ALERT_MIN ? styles.waitAlert : waited >= WAIT_WARN_MIN ? styles.waitWarn : styles.waitOk;
          const sections = SECTIONS.filter((section) => row.open[section].length > 0);
          return (
            <TouchableOpacity
              key={row.tableNumber}
              style={styles.card}
              onPress={() => navigation.navigate('TableDetail', { tableNumber: row.tableNumber })}
              activeOpacity={0.8}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.tableLabel}>🪑 {t('table', { n: row.tableNumber })}</Text>
                <View style={[styles.waitPill, waitStyle]}>
                  <Text style={styles.waitText}>⏱️ {t('minutes', { n: waited })}</Text>
                </View>
              </View>
              <View style={styles.progressRow}>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${(row.done / row.total) * 100}%` }]} />
                </View>
                <Text style={styles.progressText}>
                  {t('doneOfTotal', { done: row.done, total: row.total })}
                </Text>
              </View>

              {sections.map((section) => (
                <View
                  key={section}
                  style={[styles.section, filter !== 'all' && filter !== section && styles.sectionDimmed]}
                >
                  <Text style={styles.sectionTitle}>
                    {SECTION_META[section].icon} {sectionLabel(section, lang)}
                    <Text style={styles.sectionCount}>{t('openCount', { n: row.open[section].length })}</Text>
                  </Text>
                  {groupItems(row.open[section]).map(({ key, item, count }) => (
                    <View key={key} style={styles.itemLine}>
                      <Text style={[styles.itemQty, count > 1 && styles.itemQtyMulti]}>{count}×</Text>
                      <View style={styles.itemTextWrap}>
                        <Text style={styles.itemName}>{dishLabel(item)}</Text>
                        {item.menu_item.name_hanzi && <Text style={styles.itemSub}>{item.menu_item.name_de}</Text>}
                        {item.extras && item.extras.length > 0 && (
                          <Text style={styles.itemExtras}>
                            ➕ {item.extras.map((e) => `${e.quantity} ${e.name_de}`).join(', ')}
                          </Text>
                        )}
                        {item.note && <Text style={styles.itemNote}>💬 {item.note}</Text>}
                      </View>
                    </View>
                  ))}
                </View>
              ))}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

function FilterChip({
  label,
  accessibilityLabel,
  active,
  dim = false,
  onPress,
  styles,
}: {
  label: string;
  accessibilityLabel?: string;
  active: boolean;
  dim?: boolean;
  onPress: () => void;
  styles: StatusStyles;
}) {
  return (
    <TouchableOpacity
      style={[styles.filterChip, active && styles.filterChipActive, dim && !active && styles.filterChipDim]}
      onPress={onPress}
      accessibilityLabel={accessibilityLabel ?? label}
    >
      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
    errorText: { color: colors.danger, padding: 16 },
    scroll: { flex: 1 },
    content: { padding: 12, width: '100%', maxWidth: 900, alignSelf: 'center', paddingBottom: 32 },
    // Abholbereit-Streifen
    readyBar: {
      backgroundColor: colors.successSurface,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      paddingTop: 10,
      paddingBottom: 12,
    },
    readyTitle: { fontSize: 13, fontWeight: '800', color: colors.text, paddingHorizontal: 16, marginBottom: 8 },
    readyContent: { paddingHorizontal: 12, gap: 8 },
    readyChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.surface,
      borderRadius: 12,
      paddingHorizontal: 10,
      paddingVertical: 8,
      maxWidth: 260,
    },
    readyTable: { fontSize: 16, fontWeight: '900', color: colors.success },
    readyTextWrap: { flexShrink: 1 },
    readyDish: { fontSize: 14, fontWeight: '700', color: colors.text },
    readyMeta: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
    // Filter + Sortierung
    filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
    filterChip: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: colors.surface,
      borderWidth: 1.5,
      borderColor: colors.border,
    },
    filterChipActive: { backgroundColor: colors.accentSurface, borderColor: colors.accent },
    filterChipDim: { opacity: 0.45 },
    filterChipText: { fontSize: 15, fontWeight: '800', color: colors.textSecondary },
    filterChipTextActive: { color: colors.accent },
    sortRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
    sortLabel: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
    sortToggle: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, backgroundColor: colors.surfaceAlt },
    sortToggleText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
    emptyText: { textAlign: 'center', color: colors.textFaint, marginTop: 32, fontSize: 15 },
    // Tischkarte
    card: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
      marginBottom: 12,
    },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    tableLabel: { fontSize: 20, fontWeight: '800', color: colors.text },
    waitPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
    waitOk: { backgroundColor: colors.surfaceAlt },
    waitWarn: { backgroundColor: '#fde68a' },
    waitAlert: { backgroundColor: '#fca5a5' },
    waitText: { fontSize: 13, fontWeight: '800', color: '#1c1917' },
    progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, marginBottom: 4 },
    progressTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
    progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.success },
    progressText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
    section: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border },
    sectionDimmed: { opacity: 0.4 },
    sectionTitle: { fontSize: 14, fontWeight: '800', color: colors.text, marginBottom: 6 },
    sectionCount: { fontSize: 12, fontWeight: '600', color: colors.warning },
    itemLine: { flexDirection: 'row', gap: 8, marginBottom: 6 },
    itemQty: { fontSize: 15, fontWeight: '900', color: colors.textSecondary, minWidth: 28 },
    itemQtyMulti: { color: colors.accent },
    itemTextWrap: { flex: 1 },
    itemName: { fontSize: 15, fontWeight: '600', color: colors.text },
    itemSub: { fontSize: 12, color: colors.textMuted },
    itemExtras: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
    itemNote: { fontSize: 12, fontWeight: '700', color: colors.warning, marginTop: 1 },
  });
