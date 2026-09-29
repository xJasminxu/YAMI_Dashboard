import { useMemo } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useDeviceOrders } from '../../hooks/useDeviceOrders';
import type { DeviceOrderItem } from '../../hooks/useDeviceOrders';
import type { RootStackParamList } from '../../navigation/types';
import { groupItems, SECTION_META, SECTIONS, sectionFor, sectionLabel, type Section } from '../../lib/sections';
import { useI18n } from '../../i18n/LanguageContext';
import type { ThemeColors } from '../../theme/colors';
import { useThemedStyles } from '../../theme/useThemedStyles';

type Props = NativeStackScreenProps<RootStackParamList, 'TableDetail'>;
type TableDetailStyles = ReturnType<typeof createStyles>;

// Bestellübersicht für einen Tisch: fasst Küche + Bar zusammen (über evtl.
// mehrere Bestellungen/Nachbestellungen hinweg), live über dieselben
// Realtime-Subscriptions wie die Küchen-/Bar-Ansichten.
export default function TableDetailScreen({ route }: Props) {
  const styles = useThemedStyles(createStyles);
  const { lang, t } = useI18n();
  const { tableNumber } = route.params;
  const kitchen = useDeviceOrders('kitchen');
  const bar = useDeviceOrders('bar');

  // Alle Positionen des Tisches (Küche + Bar), aufgeteilt nach Bereich wie im Status-Screen.
  const bySection = useMemo(() => {
    const map: Record<Section, DeviceOrderItem[]> = {
      vorspeise: [],
      hauptspeise: [],
      barbecue: [],
      getraenke: [],
      nachspeisen: [],
    };
    for (const item of collectItemsForTable([...kitchen.orders, ...bar.orders], tableNumber)) {
      if (item.menu_item.category.is_discount) continue;
      map[sectionFor(item)].push(item);
    }
    return map;
  }, [kitchen.orders, bar.orders, tableNumber]);

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

  const allItems = SECTIONS.flatMap((section) => bySection[section]);
  const totalItems = allItems.length;
  const doneItems = allItems.filter((item) => item.status === 'fertig').length;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>🪑 {t('table', { n: tableNumber })}</Text>
      {totalItems > 0 && (
        <Text style={styles.subtitle}>
          {t('doneOfTotal', { done: doneItems, total: totalItems })}
        </Text>
      )}

      {totalItems === 0 && <Text style={styles.emptyText}>{t('noOpenItemsForTable')}</Text>}

      {SECTIONS.filter((section) => bySection[section].length > 0).map((section) => (
        <ItemSection
          key={section}
          title={`${SECTION_META[section].icon} ${sectionLabel(section, lang)}`}
          items={bySection[section]}
          styles={styles}
        />
      ))}
    </ScrollView>
  );
}

function collectItemsForTable(orders: { table: { number: number }; items: DeviceOrderItem[] }[], tableNumber: number) {
  return orders
    .filter((order) => order.table.number === tableNumber)
    .flatMap((order) => order.items)
    .sort((a, b) => a.menu_item.category.sort_order - b.menu_item.category.sort_order);
}

function ItemSection({
  title,
  items,
  styles,
}: {
  title: string;
  items: DeviceOrderItem[];
  styles: TableDetailStyles;
}) {
  const { t } = useI18n();
  const open = items.filter((item) => item.status === 'offen');
  const done = items.filter((item) => item.status === 'fertig');

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>
        {title} — {t('doneOfTotal', { done: done.length, total: items.length })}
      </Text>
      {/* Offene zuerst, dann fertige — gleiche Portionen zusammengefasst ("2× …"). */}
      {groupItems([...open, ...done]).map(({ key, item, count }) => (
        <ItemRow key={key} item={item} count={count} styles={styles} />
      ))}
    </View>
  );
}

function ItemRow({ item, count, styles }: { item: DeviceOrderItem; count: number; styles: TableDetailStyles }) {
  const { t } = useI18n();
  const isDone = item.status === 'fertig';
  return (
    <View style={styles.itemRow}>
      <Text style={[styles.itemHanzi, isDone && styles.itemDone]}>
        <Text style={[styles.itemQty, count > 1 && !isDone && styles.itemQtyMulti]}>{count}× </Text>
        {item.menu_item.item_code ? `${item.menu_item.item_code} · ` : ''}
        {item.menu_item.name_hanzi ?? item.menu_item.name_de}
        {item.variant_hanzi ? ` · ${item.variant_hanzi}` : ''}
      </Text>
      {item.menu_item.name_hanzi && (
        <Text style={[styles.itemDe, isDone && styles.itemDone]}>
          {item.menu_item.name_de}
          {item.variant_de ? ` · ${item.variant_de}` : ''}
        </Text>
      )}
      {item.extras && item.extras.length > 0 && (
        <Text style={[styles.itemExtras, isDone && styles.itemDone]}>
          {item.extras.map((e) => `+${e.quantity} ${e.name_hanzi} (${e.name_de})`).join(', ')}
        </Text>
      )}
      {item.note && <Text style={[styles.itemNote, isDone && styles.itemDone]}>💬 {item.note}</Text>}
      <Text style={[styles.itemStatus, isDone ? styles.itemStatusDone : styles.itemStatusOpen]}>
        {isDone ? t('statusDone') : t('statusOpen')}
      </Text>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, width: '100%', maxWidth: 760, alignSelf: 'center' },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
    errorText: { color: colors.danger, padding: 16 },
    title: { fontSize: 24, fontWeight: '800', color: colors.text },
    subtitle: { fontSize: 14, fontWeight: '600', color: colors.textMuted, marginTop: 2, marginBottom: 16 },
    itemQty: { fontWeight: '900', color: colors.textSecondary },
    itemQtyMulti: { color: colors.accent },
    emptyText: { color: colors.textFaint, marginTop: 16 },
    section: { marginBottom: 24 },
    sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.textSecondary, marginBottom: 8 },
    itemRow: {
      backgroundColor: colors.surface,
      borderRadius: 10,
      padding: 12,
      marginBottom: 8,
    },
    itemHanzi: { fontSize: 17, fontWeight: '600', color: colors.text },
    itemDe: { fontSize: 13, color: colors.textMuted },
    itemExtras: { fontSize: 12, color: colors.textSecondary, marginTop: 2, fontStyle: 'italic' },
    itemNote: { fontSize: 12, color: colors.warning, marginTop: 2, fontWeight: '700' },
    itemDone: { textDecorationLine: 'line-through', color: colors.textFaint },
    itemStatus: { fontSize: 11, fontWeight: '700', marginTop: 4, textTransform: 'uppercase' },
    itemStatusOpen: { color: colors.warning },
    itemStatusDone: { color: colors.success },
  });
