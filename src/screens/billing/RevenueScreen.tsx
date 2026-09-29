import { useMemo } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useDeviceOrders } from '../../hooks/useDeviceOrders';
import { formatPrice, itemTotal } from '../../lib/pricing';
import type { ThemeColors } from '../../theme/colors';
import { useThemedStyles } from '../../theme/useThemedStyles';

// Eigener Menüpunkt "Umsatz" (vorher ein Kasten oben in der Tischübersicht). Summiert
// ALLE heutigen Positionen — offene wie bereits abgeschlossene Tische — bis zum
// Tagesabschluss (RoleSelectScreen.tsx), der orders komplett löscht und damit auch diese
// Zahlen leert. Rein zur Orientierung: die verbindlichen Zahlen liefert weiterhin die Kasse.
export default function RevenueScreen() {
  const styles = useThemedStyles(createStyles);
  const kitchen = useDeviceOrders('kitchen', { includeClosed: true });
  const bar = useDeviceOrders('bar', { includeClosed: true });

  const stats = useMemo(() => {
    let total = 0;
    let card = 0;
    let cash = 0;
    let unpaid = 0;
    let openTables = 0;
    let closedTables = 0;
    let kitchenSum = 0;
    let barSum = 0;
    let itemCount = 0;
    let hasUnpriced = false;
    const openTableNumbers = new Set<number>();
    // Vergangene Besetzungen werden wie in der Tischübersicht über Tischnummer + closed_at
    // unterschieden (ein Tisch kann am selben Tag mehrfach besetzt und abgeschlossen werden).
    const closedSessions = new Set<string>();

    for (const [device, orders] of [
      ['kitchen', kitchen.orders],
      ['bar', bar.orders],
    ] as const) {
      for (const order of orders) {
        if (order.closedAt === null) openTableNumbers.add(order.table.number);
        else closedSessions.add(`${order.table.number}::${order.closedAt}`);

        for (const item of order.items) {
          const value = itemTotal(item);
          if (value === null) {
            hasUnpriced = true;
            continue;
          }
          itemCount += 1;
          total += value;
          if (device === 'kitchen') kitchenSum += value;
          else barSum += value;
          if (item.paid_method === 'karte') card += value;
          else if (item.paid_method === 'bargeld') cash += value;
          else unpaid += value;
          if (order.closedAt === null) openTables += value;
          else closedTables += value;
        }
      }
    }

    return {
      total,
      card,
      cash,
      unpaid,
      openTables,
      closedTables,
      kitchenSum,
      barSum,
      itemCount,
      hasUnpriced,
      openTableCount: openTableNumbers.size,
      closedSessionCount: closedSessions.size,
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
        <Text style={styles.errorText}>Umsatz konnte nicht geladen werden: {loadError}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.heroCard}>
        <Text style={styles.heroLabel}>💰 Umsatz heute</Text>
        <Text style={styles.heroValue}>{formatPrice(stats.total)}</Text>
        <Text style={styles.heroSub}>
          {stats.itemCount} Positionen · {stats.openTableCount + stats.closedSessionCount} Tischbesetzungen
        </Text>
      </View>

      <Text style={styles.sectionTitle}>Zahlungsart</Text>
      <View style={styles.grid}>
        <StatTile icon="💳" label="Karte" value={stats.card} styles={styles} />
        <StatTile icon="💶" label="Bargeld" value={stats.cash} styles={styles} />
        <StatTile icon="⏳" label="Nicht als bezahlt markiert" value={stats.unpaid} highlight styles={styles} />
      </View>

      <Text style={styles.sectionTitle}>Tische</Text>
      <View style={styles.grid}>
        <StatTile
          icon="🪑"
          label={`Offen (${stats.openTableCount} ${stats.openTableCount === 1 ? 'Tisch' : 'Tische'})`}
          value={stats.openTables}
          styles={styles}
        />
        <StatTile
          icon="🕓"
          label={`Abgeschlossen (${stats.closedSessionCount})`}
          value={stats.closedTables}
          styles={styles}
        />
      </View>

      <Text style={styles.sectionTitle}>Bereich</Text>
      <View style={styles.grid}>
        <StatTile icon="👨‍🍳" label="Küche" value={stats.kitchenSum} styles={styles} />
        <StatTile icon="🍹" label="Bar" value={stats.barSum} styles={styles} />
      </View>

      {stats.hasUnpriced && (
        <Text style={styles.note}>Enthält Positionen ohne hinterlegten Preis — diese sind nicht mitgezählt.</Text>
      )}
      <Text style={styles.disclaimer}>
        Vorläufige Zahlen zur Orientierung, bis zum nächsten Tagesabschluss. Die verbindlichen Zahlen liefert die
        Kasse.
      </Text>
    </ScrollView>
  );
}

function StatTile({
  icon,
  label,
  value,
  highlight = false,
  styles,
}: {
  icon: string;
  label: string;
  value: number;
  highlight?: boolean;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={[styles.tile, highlight && value > 0 && styles.tileHighlight]}>
      <Text style={styles.tileIcon}>{icon}</Text>
      <Text style={styles.tileValue}>{formatPrice(value)}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, width: '100%', maxWidth: 760, alignSelf: 'center' },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
    errorText: { color: colors.danger, padding: 16 },
    heroCard: {
      backgroundColor: colors.accent,
      borderRadius: 20,
      paddingVertical: 24,
      paddingHorizontal: 16,
      alignItems: 'center',
      marginBottom: 8,
    },
    heroLabel: { fontSize: 15, fontWeight: '700', color: 'rgba(255,255,255,0.9)' },
    heroValue: { fontSize: 42, fontWeight: '800', color: colors.onAccent, marginTop: 4 },
    heroSub: { fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 4 },
    sectionTitle: {
      fontSize: 13,
      fontWeight: '800',
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginTop: 18,
      marginBottom: 8,
    },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    tile: {
      flexGrow: 1,
      flexBasis: 140,
      backgroundColor: colors.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
    },
    tileHighlight: { borderColor: colors.warning, borderWidth: 2 },
    tileIcon: { fontSize: 24 },
    tileValue: { fontSize: 22, fontWeight: '800', color: colors.text, marginTop: 6 },
    tileLabel: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
    note: { fontSize: 12, color: colors.warning, marginTop: 16, textAlign: 'center' },
    disclaimer: { fontSize: 11, color: colors.textFaint, marginTop: 12, textAlign: 'center', lineHeight: 15 },
  });
