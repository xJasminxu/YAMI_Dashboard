import { useMemo, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useDeviceOrders } from '../../hooks/useDeviceOrders';
import type { DeviceOrderItem } from '../../hooks/useDeviceOrders';
import type { RootStackParamList } from '../../navigation/types';

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
export default function TableBillingScreen({ route }: Props) {
  const { tableNumber } = route.params;
  const kitchen = useDeviceOrders('kitchen');
  const bar = useDeviceOrders('bar');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const items = useMemo(() => {
    return [...kitchen.orders, ...bar.orders]
      .filter((order) => order.table.number === tableNumber)
      .flatMap((order) => order.items)
      .sort((a, b) => a.menu_item.category.sort_order - b.menu_item.category.sort_order);
  }, [kitchen.orders, bar.orders, tableNumber]);

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(items.map((item) => item.id)));
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
      <View style={styles.selectRow}>
        <TouchableOpacity onPress={selectAll}>
          <Text style={styles.selectAction}>Alle auswählen</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={selectNone}>
          <Text style={styles.selectAction}>Auswahl aufheben</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const selected = selectedIds.has(item.id);
          const total = itemTotal(item);
          const isDone = item.status === 'fertig';
          return (
            <TouchableOpacity
              style={[styles.itemRow, selected && styles.itemRowSelected]}
              onPress={() => toggle(item.id)}
            >
              <View style={[styles.checkbox, selected && styles.checkboxChecked]}>
                {selected && <Text style={styles.checkboxMark}>✓</Text>}
              </View>
              <View style={styles.itemTextWrap}>
                <Text style={[styles.itemHanzi, isDone && styles.itemDone]}>
                  {item.menu_item.item_code ? `${item.menu_item.item_code} · ` : ''}
                  {item.menu_item.name_hanzi}
                  {item.variant_hanzi ? ` · ${item.variant_hanzi}` : ''}
                </Text>
                <Text style={[styles.itemDe, isDone && styles.itemDone]}>
                  {item.menu_item.name_de}
                  {item.variant_de ? ` · ${item.variant_de}` : ''}
                </Text>
                {item.extras && item.extras.length > 0 && (
                  <Text style={styles.itemExtras}>
                    {item.extras.map((e) => `+${e.quantity} ${e.name_hanzi} (${e.name_de})`).join(', ')}
                  </Text>
                )}
                {item.note && <Text style={styles.itemNote}>Notiz: {item.note}</Text>}
              </View>
              <Text style={styles.itemPrice}>{total !== null ? formatPrice(total) : '–'}</Text>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={<Text style={styles.emptyText}>Keine Positionen für diesen Tisch.</Text>}
      />

      <View style={styles.footer}>
        {hasUnpriced && <Text style={styles.footerNote}>Enthält Positionen ohne hinterlegten Preis.</Text>}
        <View style={styles.footerRow}>
          <Text style={styles.footerLabel}>
            Ausgewählt ({selectedIds.size}/{items.length})
          </Text>
          <Text style={styles.footerValue}>{formatPrice(selectedTotal)}</Text>
        </View>
        <Text style={styles.footerDisclaimer}>
          Vorläufige Berechnung zur Orientierung, z.B. für getrennte Rechnungen — gebucht wird nichts. Die
          verbindliche Rechnung druckt weiterhin die Kasse.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { color: '#b91c1c', padding: 16 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  title: { fontSize: 22, fontWeight: '700' },
  grandTotal: { fontSize: 16, fontWeight: '600', color: '#374151' },
  selectRow: {
    flexDirection: 'row',
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  selectAction: { fontSize: 13, color: '#2563eb', fontWeight: '600' },
  listContent: { paddingHorizontal: 16, paddingBottom: 8 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  itemRowSelected: { backgroundColor: '#dcfce7' },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#9ca3af',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  checkboxChecked: { backgroundColor: '#16a34a', borderColor: '#15803d' },
  checkboxMark: { color: '#fff', fontSize: 15, fontWeight: '700' },
  itemTextWrap: { flex: 1, paddingRight: 8 },
  itemHanzi: { fontSize: 16, fontWeight: '600' },
  itemDe: { fontSize: 12, color: '#6b7280' },
  itemExtras: { fontSize: 12, color: '#374151', marginTop: 2, fontStyle: 'italic' },
  itemNote: { fontSize: 12, color: '#b45309', marginTop: 2, fontWeight: '700' },
  itemDone: { color: '#9ca3af' },
  itemPrice: { fontSize: 15, fontWeight: '700', color: '#1f2937' },
  emptyText: { textAlign: 'center', color: '#9ca3af', marginTop: 32 },
  footer: {
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    padding: 16,
  },
  footerNote: { fontSize: 12, color: '#b45309', marginBottom: 6 },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footerLabel: { fontSize: 16, fontWeight: '700' },
  footerValue: { fontSize: 20, fontWeight: '800' },
  footerDisclaimer: { fontSize: 11, color: '#9ca3af', marginTop: 8, lineHeight: 15 },
});
