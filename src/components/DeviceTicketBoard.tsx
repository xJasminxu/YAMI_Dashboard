import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, PanResponder, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { PanResponderInstance } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useDeviceOrders, type DeviceOrderItem, type GroupedOrder } from '../hooks/useDeviceOrders';
import { useNewOrderChime } from '../hooks/useNewOrderChime';
import type { OrderItemStatus, TargetDevice } from '../types/database';
import type { ThemeColors } from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';
import { useThemedStyles } from '../theme/useThemedStyles';

type Tab = 'offen' | 'fertig' | 'anzahl' | 'komplett';
type BoardStyles = ReturnType<typeof createStyles>;

// Zeigt sich, wenn im "Offen"-Tab (Küche oder Bar) gerade nichts zu tun ist — links
// der Spruch, rechts das Bild, siehe EmptyBoardBanner unten.
const IMPATIENT_HONGBIN = require('../../assets/impatient_hongbin.png');

// Eigener Key pro Gerät (Küche/Bar), falls dasselbe Tablet doch mal die Rolle wechselt —
// die Stumm-Einstellung der Küche soll dann nicht ungefragt auch für die Bar gelten.
function soundEnabledStorageKey(targetDevice: TargetDevice) {
  return `yami:sound-enabled:${targetDevice}`;
}

// Merkt sich die Kartengröße ("+"/"-"-Buttons neben der Glocke, siehe largeMode) je
// Gerät, aus demselben Grund wie oben.
function largeModeStorageKey(targetDevice: TargetDevice) {
  return `yami:large-mode:${targetDevice}`;
}

// Merkt sich die per Drag an den Trennlinien eingestellten Spaltenbreiten der Drei-
// Spalten-Ansicht (siehe stationRatios) — eigener Key je Gerät, da Küche (Vorspeise/
// Hauptspeise/Barbecue) und Bar (Getränke/Nachspeisen/Vergangene Bestellungen) fachlich
// unterschiedliche Spalten sind, auch wenn sie denselben Drag-Mechanismus teilen.
function stationRatiosStorageKey(targetDevice: TargetDevice) {
  return `yami:station-ratios:${targetDevice}`;
}

// Standardbreiten, bevor zum ersten Mal gezogen wurde — spiegeln die bisherigen festen
// flex-Werte: bei der Küche Vorspeise/Hauptspeise gleich breit, Barbecue schmaler (kurze
// Gerichtenamen); bei der Bar Getränke am breitesten (mehr Bestellungen als Nachspeisen),
// Vergangene Bestellungen am schmalsten (nur zur Kontrolle, keine Eile mehr).
function defaultStationRatios(targetDevice: TargetDevice): [number, number, number] {
  return targetDevice === 'kitchen' ? [1, 1, 0.7] : [1.8, 1, 0.6];
}

// Kein Trenner darf eine Spalte komplett verschwinden lassen — Mindestanteil an der
// gemeinsamen Breitensumme der beiden durch einen Trenner verbundenen Spalten.
const MIN_STATION_RATIO = 0.35;

// neu = noch nichts abgehakt, angefangen = teilweise fertig, fertig = alles abgehakt.
type OrderProgress = 'neu' | 'angefangen' | 'fertig';

function progressFor(order: GroupedOrder): OrderProgress {
  const doneCount = order.items.filter((item) => item.status === 'fertig').length;
  if (doneCount === 0) return 'neu';
  if (doneCount === order.items.length) return 'fertig';
  return 'angefangen';
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function cardBackgroundFor(colors: ThemeColors): Record<OrderProgress, object> {
  return {
    neu: { backgroundColor: colors.cardNeu },
    angefangen: { backgroundColor: colors.cardAngefangen },
    fertig: { backgroundColor: colors.cardFertig },
  };
}

// Reduziert jede Bestellung auf die Positionen, die zum Prädikat passen — für die Bar
// (Getränke/Nachspeisen, siehe categories.menu_group). Eine Karte behält dabei auch bereits
// abgehakte Positionen (nur durchgestrichen) und fällt erst raus, sobald ALLE Positionen
// DIESER Spalte abgehakt sind — die Bar hat (anders als die Küche seit Kurzem, siehe
// stationOpenOnly unten) keine separate "einzelne Position sofort raus"-Logik, weil ihre
// "Vergangene Bestellungen"-Spalte ohnehin nur ganze fertige Bestellungen zeigt (`done`,
// siehe isBar-Zweig), nicht einzelne fertige Positionen.
function itemsMatching(orders: GroupedOrder[], predicate: (item: DeviceOrderItem) => boolean): GroupedOrder[] {
  return orders
    .map((order) => ({
      ...order,
      items: order.items.filter(predicate),
    }))
    .filter((order) => order.items.some((item) => item.status === 'offen'));
}

// Wie itemsMatching, aber nur für die Küchen-Stationen-Spalten im "Offen"-Tab: behält je
// Karte NUR die tatsächlich noch offenen Positionen (nicht wie itemsMatching auch bereits
// abgehakte, die dort "nur" die Karte offen halten). Sobald eine einzelne Position
// abgehakt wird, verschwindet SIE sofort aus der Offen-Karte — und taucht dank
// stationDoneItems (siehe unten) im selben Moment als eigene Karte in der passenden
// Vergangene-Bestellungen-Spalte auf — statt bis zur letzten Position derselben Station in der
// Offen-Karte liegen zu bleiben und dort unnötig Platz zu blockieren, den eine neu
// eingehende Bestellung bräuchte.
function stationOpenOnly(orders: GroupedOrder[], predicate: (item: DeviceOrderItem) => boolean): GroupedOrder[] {
  return orders
    .map((order) => ({
      ...order,
      items: order.items.filter((item) => item.status === 'offen' && predicate(item)),
    }))
    .filter((order) => order.items.length > 0);
}

// Zeitpunkt, an dem die letzte Position der Bestellung fertig markiert wurde — bestimmt
// die Reihenfolge der "Vergangene Bestellungen"-Liste (neueste zuerst).
function latestDoneAt(order: GroupedOrder): number {
  return order.items.reduce((latest, item) => Math.max(latest, item.done_at ? new Date(item.done_at).getTime() : 0), 0);
}

// Gegenstück zu stationOpenOnly für die "Vergangene Bestellungen"-Spalten der Küche: liefert
// pro fertig abgehakter Position DIESER Station eine EIGENE Karte (nicht wie vorher alle
// fertigen Positionen einer Bestellung zusammen in einer Karte) — jede Karte trägt weiterhin
// Tisch/Zeit der ursprünglichen Bestellung, aber nur genau diese eine Position. Sortiert
// nach dem individuellen done_at jeder Position (neueste zuerst), nicht nach dem spätesten
// done_at einer ganzen Bestellung — sonst hätte eine um 10:05 abgehakte Position eine um
// 10:00 abgehakte Position derselben Bestellung "mit nach oben gezogen", obwohl dazwischen
// noch andere Bestellungen fertig wurden. Grund für die Aufsplittung: Köche haken
// gelegentlich aus Versehen die falsche Position ab — steckte sie in einer Sammelkarte mit
// mehreren Positionen, musste erst gesucht werden, welche der mehreren Positionen es war,
// um sie durch erneutes Antippen zurück auf "offen" zu setzen. Als eigene, klar
// abgegrenzte Karte ganz oben (dank Sortierung nach Zeit) ist sofort erkennbar, welche
// Position das war. Läuft über `orders` (nicht nur `open`), da eine Bestellung, deren
// Vorspeise komplett fertig ist, ggf. schon nicht mehr in `open` steckt, wenn auch die
// restlichen Stationen fertig sind — die Position soll aber trotzdem gefunden werden.
function stationDoneItems(orders: GroupedOrder[], predicate: (item: DeviceOrderItem) => boolean): GroupedOrder[] {
  const entries: GroupedOrder[] = [];

  for (const order of orders) {
    for (const item of order.items) {
      if (item.status !== 'fertig' || !predicate(item)) continue;
      entries.push({
        ...order,
        // orderId ist normalerweise pro Bestellung eindeutig — hier bewusst pro Position
        // (item.id), da jede Position jetzt ihre eigene Karte ist und React/FlatList einen
        // pro Karte eindeutigen key braucht (siehe keyExtractor in TicketList).
        orderId: item.id,
        items: [item],
      });
    }
  }

  return entries.sort((a, b) => latestDoneAt(b) - latestDoneAt(a));
}

function countOpenItems(orders: GroupedOrder[]): number {
  return orders.reduce((sum, order) => sum + order.items.filter((item) => item.status === 'offen').length, 0);
}

// Für die "erledigt"-Zähler der Vergangene-Bestellungen-Spalten — orders kommen hier
// bereits aus stationDoneItems, alle enthaltenen Positionen sind also schon fertig, ein
// Status-Filter wie bei countOpenItems ist daher nicht nötig.
function countItems(orders: GroupedOrder[]): number {
  return orders.reduce((sum, order) => sum + order.items.length, 0);
}

interface DishCount {
  key: string;
  dishLabel: string;
  variantLabel: string | null;
  count: number;
}

// Baut aus allen noch offenen Positionen einer Station eine nach Menge sortierte
// Stückzahl-Liste (z.B. "5× Gyoza") statt einzelner Ticket-Karten — für den "Anzahl"-Tab
// der Küche (siehe unten), damit man bei vielen gleichen Bestellungen (z.B. mehrere
// Gyoza-Bestellungen gleichzeitig) direkt in einem Rutsch nachbraten kann, ohne selbst über
// die Ticket-Karten zu zählen. Gruppiert nach Gericht + Variante (Rind/Huhn zählt getrennt,
// da unterschiedliche Zubereitung) — Extras fließen bewusst NICHT in die Gruppierung ein
// (bleiben Sache der einzelnen Ticket-Karte in Offen/Vergangene Bestellungen), sonst würde
// aus 5 identischen Gyoza mit je unterschiedlichen Extra-Wünschen fälschlich 5 einzelne
// Positionen statt "5× Gyoza" werden.
function aggregateOpen(orders: GroupedOrder[], predicate: (item: DeviceOrderItem) => boolean): DishCount[] {
  const byKey = new Map<string, DishCount>();

  for (const order of orders) {
    for (const item of order.items) {
      if (item.status !== 'offen' || !predicate(item)) continue;

      const variantLabel = item.variant_hanzi ?? item.variant_de ?? null;
      const key = `${item.menu_item.id}::${variantLabel ?? ''}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.count += 1;
        continue;
      }

      const { name_hanzi, name_de, item_code } = item.menu_item;
      const code = item_code ? `${item_code} · ` : '';
      byKey.set(key, {
        key,
        dishLabel: name_hanzi ? `${code}${name_hanzi} (${name_de})` : `${code}${name_de}`,
        variantLabel,
        count: 1,
      });
    }
  }

  return Array.from(byKey.values()).sort((a, b) => b.count - a.count || a.dishLabel.localeCompare(b.dishLabel, 'de'));
}

function sumCounts(entries: DishCount[]): number {
  return entries.reduce((sum, entry) => sum + entry.count, 0);
}

// large: größere Karten/Schrift für Geräte, die aus Distanz gelesen werden
// müssen (z.B. iPad in der Küche, wo die Köche verteilt am Pass stehen).
export default function DeviceTicketBoard({
  targetDevice,
  large = false,
}: {
  targetDevice: TargetDevice;
  large?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const cardBackground = useMemo(() => cardBackgroundFor(colors), [colors]);
  const { orders: rawOrders, loading, error, setItemStatus, setItemsStatus } = useDeviceOrders(targetDevice);
  // Rabatt-Positionen sind Preis-Abzüge, kein zuzubereitendes Gericht/Getränk (siehe
  // categories.is_discount) — auf Küchen-/Bar-Tickets werden sie deshalb ausgeblendet,
  // bleiben aber in Tischübersicht/Abrechnung sichtbar (die nutzen useDeviceOrders direkt).
  const orders = useMemo(
    () =>
      rawOrders
        .map((order) => ({
          ...order,
          items: order.items.filter((item) => !item.menu_item.category.is_discount),
        }))
        .filter((order) => order.items.length > 0),
    [rawOrders]
  );
  const [tab, setTab] = useState<Tab>('offen');
  // Standardmäßig an — Küche/Bar können den Ton per Glocken-Button stumm schalten
  // (z.B. während einer Pause). Wird in AsyncStorage gemerkt, damit die Einstellung
  // erhalten bleibt, wenn die App in den Hintergrund/Task-Wechsel geht oder neu
  // startet, statt bei jedem Neu-Mounten wieder auf "an" zurückzuspringen.
  const [soundEnabled, setSoundEnabled] = useState(true);
  useNewOrderChime(orders, soundEnabled, targetDevice === 'kitchen');

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(soundEnabledStorageKey(targetDevice)).then((stored) => {
      if (!cancelled && stored !== null) setSoundEnabled(stored === '1');
    });
    return () => {
      cancelled = true;
    };
  }, [targetDevice]);

  function toggleSound() {
    setSoundEnabled((prev) => {
      const next = !prev;
      AsyncStorage.setItem(soundEnabledStorageKey(targetDevice), next ? '1' : '0');
      return next;
    });
  }

  // Kartengröße — startet beim vom Screen übergebenen `large`-Wert (Küche groß für
  // Distanzlesbarkeit, Bar normal), ist danach aber per "−"/"+"-Button in der Kopfzeile
  // umschaltbar, falls der Koch z.B. lieber mehr Gerichte auf einen Blick sehen will statt
  // große Schrift. Persistiert wie soundEnabled je Gerät.
  const [largeMode, setLargeMode] = useState(large);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(largeModeStorageKey(targetDevice)).then((stored) => {
      if (!cancelled && stored !== null) setLargeMode(stored === '1');
    });
    return () => {
      cancelled = true;
    };
  }, [targetDevice]);

  function setCardSize(next: boolean) {
    setLargeMode(next);
    AsyncStorage.setItem(largeModeStorageKey(targetDevice), next ? '1' : '0');
  }

  // Per Drag an den Trennlinien einstellbare Breiten der Drei-Spalten-Ansicht — bei der
  // Küche Vorspeise/Hauptspeise/Barbecue, bei der Bar Getränke/Nachspeisen/Vergangene
  // Bestellungen. Ratios statt fixer Pixelbreiten, damit sich das Verhältnis über
  // Geräteneustarts/Bildschirmgrößen hinweg gleich verhält; ratiosRef hält den Wert
  // zusätzlich für die PanResponder-Callbacks aktuell, ohne dass die Responder bei jedem
  // Re-Render (z.B. durch neue Bestellungen via Realtime) neu erzeugt werden müssten —
  // das würde eine gerade laufende Drag-Geste abbrechen.
  const [stationRatios, setStationRatios] = useState<[number, number, number]>(() =>
    defaultStationRatios(targetDevice)
  );
  const ratiosRef = useRef(stationRatios);
  ratiosRef.current = stationRatios;
  const rowWidthRef = useRef(0);
  const dragStartRatiosRef = useRef(stationRatios);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(stationRatiosStorageKey(targetDevice)).then((stored) => {
      if (cancelled || !stored) return;
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length === 3 && parsed.every((n) => typeof n === 'number')) {
          setStationRatios(parsed as [number, number, number]);
        }
      } catch {
        // Beschädigter/alter Storage-Wert — einfach bei den Standardbreiten bleiben.
      }
    });
    return () => {
      cancelled = true;
    };
  }, [targetDevice]);

  function handleStationRowLayout(width: number) {
    rowWidthRef.current = width;
  }

  // Ein PanResponder pro Trenner (0 = erste|zweite Spalte, 1 = zweite|dritte Spalte) —
  // verschiebt beim Ziehen Breitenanteile zwischen genau den beiden angrenzenden Spalten,
  // die Summe der beiden bleibt dabei gleich, andere Spalten sind unberührt. Per
  // useRef-Lazy-Init einmalig erzeugt (nicht bei jedem Render neu), damit eine laufende
  // Geste nicht durch einen Re-Render (z.B. neue Bestellung via Realtime) unterbrochen
  // wird — die Callbacks lesen den aktuellen Stand stattdessen über die Refs oben.
  const dividerRespondersRef = useRef<Record<0 | 1, PanResponderInstance> | null>(null);
  if (!dividerRespondersRef.current) {
    function makeDividerResponder(index: 0 | 1): PanResponderInstance {
      return PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_evt, gesture) => Math.abs(gesture.dx) > 3,
        onPanResponderGrant: () => {
          dragStartRatiosRef.current = ratiosRef.current;
        },
        onPanResponderMove: (_evt, gesture) => {
          const width = rowWidthRef.current;
          if (!width) return;
          const start = dragStartRatiosRef.current;
          const pairSum = start[index] + start[index + 1];
          // dx in Pixel → Anteil an der gemeinsamen Breitensumme der beiden Spalten,
          // relativ zur Gesamtbreite der Reihe (nicht nur der beiden Spalten selbst,
          // deren tatsächliche Pixelbreite von den Ratios aller drei Spalten abhängt).
          const totalRatio = start[0] + start[1] + start[2];
          const deltaRatio = (gesture.dx * totalRatio) / width;
          const maxForIndex = pairSum - MIN_STATION_RATIO;
          const newIndexRatio = Math.max(MIN_STATION_RATIO, Math.min(maxForIndex, start[index] + deltaRatio));
          const next = [...start] as [number, number, number];
          next[index] = newIndexRatio;
          next[index + 1] = pairSum - newIndexRatio;
          setStationRatios(next);
        },
        onPanResponderRelease: () => {
          AsyncStorage.setItem(stationRatiosStorageKey(targetDevice), JSON.stringify(ratiosRef.current));
        },
      });
    }

    dividerRespondersRef.current = { 0: makeDividerResponder(0), 1: makeDividerResponder(1) };
  }
  const dividerResponders = dividerRespondersRef.current;

  // Hakt alle noch offenen Positionen einer Karte auf einmal ab (X-Button oder
  // Wisch-Geste, siehe TicketList) statt jedes Item einzeln antippen zu müssen — z.B.
  // wenn die Bedienung mündlich Bescheid gibt, dass ein Tisch storniert wurde, oder die
  // Küche eine ganze Bestellung im selben Moment fertigstellt. Bereits fertige Items in
  // der Karte werden nicht angefasst, damit ihr done_at-Zeitstempel nicht überschrieben
  // wird.
  function completeOrder(order: GroupedOrder) {
    const openItemIds = order.items.filter((item) => item.status === 'offen').map((item) => item.id);
    setItemsStatus(openItemIds, 'fertig');
  }

  const { open, done } = useMemo(() => {
    const open = orders.filter((order) => order.items.some((item) => item.status === 'offen'));
    const done = orders
      .filter((order) => order.items.every((item) => item.status === 'fertig'))
      .sort((a, b) => latestDoneAt(b) - latestDoneAt(a));
    return { open, done };
  }, [orders]);

  // Bar zeigt Vergangene Bestellungen nicht in einem umschaltbaren Tab, sondern immer
  // zusätzlich als dritte, schmalere Spalte neben Getränke/Nachspeisen (siehe isBar unten).
  // "Offen"/"Anzahl" bleiben aber ein Tab-Umschalter (`tab`-State, geteilt mit der Küche) —
  // er entscheidet nur, ob die ersten beiden Spalten Ticket-Karten oder eine Stückzahl-Liste
  // zeigen (siehe barDishCounts unten), die dritte Spalte bleibt davon unberührt.
  const isBar = targetDevice === 'bar';

  // Bar-Spalten (Getränke | Nachspeisen) für den "Offen"-Tab, immer offen-basiert — ihre
  // "Vergangene Bestellungen"-Spalte wird separat weiter unten aus `done` gespeist (ganze
  // Bestellung fertig, siehe isBar-Zweig im JSX) und bleibt in beiden Bar-Tabs gleich.
  const barColumns = useMemo(() => {
    if (!isBar) return null;
    return {
      primaryOrders: itemsMatching(open, (item) => item.menu_item.category.menu_group === 'getraenke'),
      primaryTitle: 'Getränke',
      primaryEmptyText: 'Keine offenen Getränke.',
      secondaryOrders: itemsMatching(open, (item) => item.menu_item.category.menu_group === 'nachspeisen'),
      secondaryTitle: 'Nachspeisen',
      secondaryEmptyText: 'Keine offenen Nachspeisen.',
    };
  }, [open, isBar]);

  // Stückzahl-Zusammenfassung für den "Anzahl"-Tab der Bar (siehe kitchenDishCounts) —
  // dieselbe Getränke/Nachspeisen-Aufteilung wie barColumns oben, aber als sortierte
  // "5× Cola"-Liste statt einzelner Ticket-Karten.
  const barDishCounts = useMemo(() => {
    if (!isBar) return null;
    return {
      primary: aggregateOpen(open, (item) => item.menu_item.category.menu_group === 'getraenke'),
      secondary: aggregateOpen(open, (item) => item.menu_item.category.menu_group === 'nachspeisen'),
    };
  }, [open, isBar]);

  // Küchen-Stationen (Vorspeise | Hauptspeise | Barbecue): pro Station sowohl die offenen
  // als auch die bereits fertigen Karten getrennt berechnen, unabhängig vom gerade
  // gewählten Tab — die Tab-Leiste zeigt "Offen (n)" und "Vergangene Bestellungen (n)"
  // gleichzeitig, braucht also beide Zahlen parallel, nicht nur die des sichtbaren Tabs.
  // "openOrders" enthält je Karte nur noch die tatsächlich offenen Positionen dieser
  // Station (stationOpenOnly) — "doneOrders" zeigt jede fertig abgehakte Position als
  // EIGENE Karte (stationDoneItems), sortiert nach individueller Abhak-Zeit (neueste
  // zuerst), statt mehrere fertige Positionen derselben Bestellung zu einer Sammelkarte
  // zusammenzufassen. Grund: eine einzelne abgehakte Position soll sofort und klar auffindbar
  // in "Vergangene Bestellungen" auftauchen, nicht erst wenn ALLE Positionen dieser Station
  // fertig sind — und falls eine Position aus Versehen abgehakt wurde, steht sie dank der
  // Sortierung ganz oben und muss nicht erst in einer Sammelkarte gesucht werden, um sie per
  // erneutem Antippen zurück auf "offen" zu setzen.
  const kitchenStations = useMemo(() => {
    if (targetDevice !== 'kitchen') return null;

    const build = (
      title: string,
      predicate: (item: DeviceOrderItem) => boolean,
      openEmptyText: string,
      doneEmptyText: string
    ) => ({
      title,
      openOrders: stationOpenOnly(orders, predicate),
      openEmptyText,
      doneOrders: stationDoneItems(orders, predicate),
      doneEmptyText,
    });

    return {
      primary: build(
        'Vorspeise',
        (item) => (item.menu_item.category.kitchen_station ?? 'hauptspeise') === 'vorspeise',
        'Keine offenen Vorspeisen.',
        'Noch keine erledigten Vorspeisen.'
      ),
      secondary: build(
        'Hauptspeise',
        (item) => (item.menu_item.category.kitchen_station ?? 'hauptspeise') === 'hauptspeise',
        'Keine offenen Hauptspeisen.',
        'Noch keine erledigten Hauptspeisen.'
      ),
      tertiary: build(
        'Barbecue',
        (item) => item.menu_item.category.kitchen_station === 'barbecue',
        'Keine offenen Barbecue-Bestellungen.',
        'Noch keine erledigten Barbecue-Bestellungen.'
      ),
    };
  }, [orders, targetDevice]);

  // Stückzahl-Zusammenfassung für den "Anzahl"-Tab (siehe aggregateOpen) — dieselbe
  // Stationen-Aufteilung wie kitchenStations oben, aber aus allen noch offenen Positionen
  // pro Station eine sortierte "5× Gyoza"-Liste statt einzelner Ticket-Karten.
  const kitchenDishCounts = useMemo(() => {
    if (targetDevice !== 'kitchen') return null;
    return {
      primary: aggregateOpen(open, (item) => (item.menu_item.category.kitchen_station ?? 'hauptspeise') === 'vorspeise'),
      secondary: aggregateOpen(open, (item) => (item.menu_item.category.kitchen_station ?? 'hauptspeise') === 'hauptspeise'),
      tertiary: aggregateOpen(open, (item) => item.menu_item.category.kitchen_station === 'barbecue'),
    };
  }, [open, targetDevice]);

  // Tab-Zähler "Vergangene Bestellungen (n)": Summe der drei Stationen-Spalten statt der
  // alten "ganze Bestellung fertig"-Zählung (`done.length`) — eine Bestellung kann jetzt
  // gleichzeitig in mehreren Stationen-Spalten als erledigt auftauchen (z.B. Vorspeise UND
  // Barbecue fertig, Hauptspeise noch offen), der Zähler soll das widerspiegeln statt nur
  // komplett abgeschlossene Bestellungen zu zählen.
  const kitchenDoneCardCount = kitchenStations
    ? kitchenStations.primary.doneOrders.length +
      kitchenStations.secondary.doneOrders.length +
      kitchenStations.tertiary.doneOrders.length
    : 0;

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Bestellungen konnten nicht geladen werden: {error}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.tabBar}>
        {isBar ? (
          // Vergangene Bestellungen stehen für die Bar immer als eigene Spalte daneben
          // (siehe isBar-Zweig unten), brauchen also keinen eigenen Tab mehr — "Offen" und
          // "Anzahl" schalten aber weiterhin um, ob Getränke/Nachspeisen als Ticket-Karten
          // oder als Stückzahl-Liste (z.B. "5× Cola", siehe barDishCounts) angezeigt werden.
          // Deutsch-only, ohne Hanzi-Zeile — die Bar-Belegschaft spricht Deutsch, anders als
          // die Küche (siehe CLAUDE.md).
          <View style={styles.tabsRow}>
            <TouchableOpacity
              style={[styles.tab, tab === 'offen' && styles.tabActive]}
              onPress={() => setTab('offen')}
            >
              <BarTabLabel label="Offen" count={open.length} active={tab === 'offen'} large={largeMode} styles={styles} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, tab === 'anzahl' && styles.tabActive]}
              onPress={() => setTab('anzahl')}
            >
              <BarTabLabel label="Anzahl" count={countOpenItems(open)} active={tab === 'anzahl'} large={largeMode} styles={styles} />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.tabsRow}>
            {/* largeMode && styles.tabLarge/tabTextHanziLarge/tabTextDeLarge: die Küche läuft im
                "large"-Modus (aus der Distanz lesbar, siehe DeviceTicketBoard-Kommentar
                oben) — vorher hatte nur der Rest der Karten/Spalten eine große Variante, der
                Tab selbst blieb bei 15px/kompakter Höhe. Dadurch war "Vergangene
                Bestellungen" auf dem Küchen-Tablet leicht zu übersehen: fertig abgehakte
                Bestellungen landeten dort zwar korrekt, aber der Tab dazu ging im
                hektischen Betrieb optisch unter — wirkte dann wie "Bestellung ist einfach
                weg". Jeder Tab zeigt zusätzlich Hanzi (primär, oben/größer) über dem
                deutschen Namen (sekundär, siehe KitchenTabLabel) — dieselbe Sprach-
                Hierarchie wie bei den Gerichtenamen, weil die Küchenmitarbeiter kein
                Deutsch sprechen (siehe CLAUDE.md). */}
            <TouchableOpacity
              style={[styles.tab, largeMode && styles.tabLarge, tab === 'offen' && styles.tabActive]}
              onPress={() => setTab('offen')}
            >
              <KitchenTabLabel hanzi="待做" de="Offen" count={open.length} active={tab === 'offen'} large={largeMode} styles={styles} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, largeMode && styles.tabLarge, tab === 'fertig' && styles.tabActive]}
              onPress={() => setTab('fertig')}
            >
              <KitchenTabLabel
                hanzi="已完成"
                de="Vergangene Bestellungen"
                count={kitchenDoneCardCount}
                active={tab === 'fertig'}
                large={largeMode}
                styles={styles}
              />
            </TouchableOpacity>
            {/* "Komplett"-Tab: zeigt jedes Tisch-Ticket unfragmentiert (alle Stationen
                zusammen in einer Karte, mit dem Status jeder einzelnen Position) — anders
                als Offen/Vergangene Bestellungen, die dieselbe Bestellung stationsweise
                aufsplitten. Für den Überblick, wenn jemand den ganzen Stand eines Tisches
                auf einen Blick braucht, statt ihn aus mehreren Spalten zusammenzusuchen. */}
            <TouchableOpacity
              style={[styles.tab, largeMode && styles.tabLarge, tab === 'komplett' && styles.tabActive]}
              onPress={() => setTab('komplett')}
            >
              <KitchenTabLabel hanzi="整单" de="Komplett" count={orders.length} active={tab === 'komplett'} large={largeMode} styles={styles} />
            </TouchableOpacity>
            {/* "Anzahl"-Tab: fasst alle offenen Positionen zu einer Stückzahl-Liste zusammen
                (z.B. "5× Gyoza"), damit man bei vielen gleichen Bestellungen nicht selbst
                über die Ticket-Karten zählen muss, siehe aggregateOpen/kitchenDishCounts. */}
            <TouchableOpacity
              style={[styles.tab, largeMode && styles.tabLarge, tab === 'anzahl' && styles.tabActive]}
              onPress={() => setTab('anzahl')}
            >
              <KitchenTabLabel
                hanzi="数量"
                de="Anzahl"
                count={countOpenItems(open)}
                active={tab === 'anzahl'}
                large={largeMode}
                styles={styles}
              />
            </TouchableOpacity>
          </View>
        )}
        {/* "−"/"+"-Buttons für die Kartengröße (siehe largeMode/setCardSize) — z.B. wenn der
            Koch lieber mehr Gerichte auf einen Blick sehen will statt große, aus der Distanz
            lesbare Schrift. */}
        <View style={styles.cardSizeButtons}>
          <TouchableOpacity
            style={[styles.cardSizeButton, largeMode && styles.bellButtonLarge]}
            onPress={() => setCardSize(false)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.cardSizeButtonText, largeMode && styles.bellButtonTextLarge]}>−</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.cardSizeButton, largeMode && styles.bellButtonLarge]}
            onPress={() => setCardSize(true)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.cardSizeButtonText, largeMode && styles.bellButtonTextLarge]}>+</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={[styles.bellButton, largeMode && styles.bellButtonLarge]}
          onPress={toggleSound}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={[styles.bellButtonText, largeMode && styles.bellButtonTextLarge]}>
            {soundEnabled ? '🔔' : '🔕'}
          </Text>
        </TouchableOpacity>
      </View>

      {isBar ? (
        // Kein EmptyBoardBanner-Vollbild für die Bar: die Vergangene-Bestellungen-Spalte
        // soll immer sichtbar bleiben, auch wenn gerade nichts offen ist — ein Vollbild-
        // Banner würde sie verdecken. Leere Getränke-/Nachspeisen-Spalten zeigen stattdessen
        // einfach ihren eigenen emptyText.
        <View
          style={styles.stationRow}
          onLayout={(e) => handleStationRowLayout(e.nativeEvent.layout.width)}
        >
          <View style={{ flex: stationRatios[0] }}>
            <StationHeader
              title={barColumns!.primaryTitle}
              count={tab === 'anzahl' ? sumCounts(barDishCounts!.primary) : countOpenItems(barColumns!.primaryOrders)}
              large={largeMode}
              styles={styles}
            />
            {tab === 'anzahl' ? (
              <DishCountList entries={barDishCounts!.primary} large={largeMode} styles={styles} emptyText={barColumns!.primaryEmptyText} />
            ) : (
              <TicketList
                orders={barColumns!.primaryOrders}
                large={largeMode}
                styles={styles}
                cardBackground={cardBackground}
                onToggleItem={setItemStatus}
                onCompleteOrder={completeOrder}
                allowComplete
                emptyText={barColumns!.primaryEmptyText}
                columns={2}
              />
            )}
          </View>
          {/* Trennlinie zwischen Getränke/Nachspeisen per Drag verschiebbar (siehe
              dividerResponders/stationRatios) — die Breiten (Getränke standardmäßig am
              breitesten, Vergangene Bestellungen am schmalsten) sind damit nur noch der
              Startzustand, nicht mehr fix. */}
          <StationDividerHandle responder={dividerResponders[0]} styles={styles} />
          <View style={{ flex: stationRatios[1] }}>
            <StationHeader
              title={barColumns!.secondaryTitle}
              count={tab === 'anzahl' ? sumCounts(barDishCounts!.secondary) : countOpenItems(barColumns!.secondaryOrders)}
              large={largeMode}
              styles={styles}
            />
            {tab === 'anzahl' ? (
              <DishCountList entries={barDishCounts!.secondary} large={largeMode} styles={styles} emptyText={barColumns!.secondaryEmptyText} />
            ) : (
              <TicketList
                orders={barColumns!.secondaryOrders}
                large={largeMode}
                styles={styles}
                cardBackground={cardBackground}
                onToggleItem={setItemStatus}
                onCompleteOrder={completeOrder}
                allowComplete
                emptyText={barColumns!.secondaryEmptyText}
                columns={2}
              />
            )}
          </View>
          <StationDividerHandle responder={dividerResponders[1]} styles={styles} />
          <View style={{ flex: stationRatios[2] }}>
            <StationHeader title="Vergangene Bestellungen" count={done.length} suffix="erledigt" large={largeMode} styles={styles} />
            <TicketList
              orders={done}
              large={largeMode}
              styles={styles}
              cardBackground={cardBackground}
              onToggleItem={setItemStatus}
              showFinishedAt
              emptyText="Noch keine erledigten Bestellungen."
            />
          </View>
        </View>
      ) : tab === 'offen' && open.length === 0 ? (
        <EmptyBoardBanner large={largeMode} styles={styles} />
      ) : tab === 'komplett' ? (
        // "Komplett"-Tab: eine einzelne, volle Breite nutzende Liste statt der
        // Stationen-Aufteilung — jede Karte zeigt das GESAMTE Ticket eines Tisches, so wie
        // es reinkam (alle Positionen aller Stationen zusammen, mit individuellem
        // Offen/Fertig-Status je Position), unabhängig davon, ob einzelne Positionen schon
        // in einer anderen Spalte (Offen/Vergangene Bestellungen) getrennt aufgeführt sind.
        // `orders` (nicht `open`/`done`) als Quelle: bleibt sichtbar, bis der Tisch
        // abgeschlossen wird, auch wenn schon alle Positionen fertig sind.
        <TicketList
          orders={orders}
          large={largeMode}
          styles={styles}
          cardBackground={cardBackground}
          onToggleItem={setItemStatus}
          emptyText="Keine Bestellungen."
          columns={3}
        />
      ) : tab === 'anzahl' ? (
        // "Anzahl"-Tab: dieselbe Drei-Spalten-Aufteilung wie Offen/Vergangene Bestellungen,
        // aber jede Spalte zeigt eine nach Menge sortierte Stückzahl-Liste
        // (kitchenDishCounts, siehe aggregateOpen) statt einzelner Ticket-Karten — z.B.
        // "5× Gyoza" auf einen Blick, statt mehrere Karten mit je 1× Gyoza durchzählen zu
        // müssen.
        <View
          style={styles.stationRow}
          onLayout={(e) => handleStationRowLayout(e.nativeEvent.layout.width)}
        >
          <View style={{ flex: stationRatios[0] }}>
            <StationHeader title={kitchenStations!.primary.title} count={sumCounts(kitchenDishCounts!.primary)} large={largeMode} styles={styles} />
            <DishCountList entries={kitchenDishCounts!.primary} large={largeMode} styles={styles} emptyText="Keine offenen Vorspeisen." />
          </View>
          <StationDividerHandle responder={dividerResponders[0]} styles={styles} />
          <View style={{ flex: stationRatios[1] }}>
            <StationHeader title={kitchenStations!.secondary.title} count={sumCounts(kitchenDishCounts!.secondary)} large={largeMode} styles={styles} />
            <DishCountList entries={kitchenDishCounts!.secondary} large={largeMode} styles={styles} emptyText="Keine offenen Hauptspeisen." />
          </View>
          <StationDividerHandle responder={dividerResponders[1]} styles={styles} />
          <View style={{ flex: stationRatios[2] }}>
            <StationHeader title={kitchenStations!.tertiary.title} count={sumCounts(kitchenDishCounts!.tertiary)} large={largeMode} styles={styles} />
            <DishCountList entries={kitchenDishCounts!.tertiary} large={largeMode} styles={styles} emptyText="Keine offenen Barbecue-Bestellungen." />
          </View>
        </View>
      ) : (
        // Drei Spalten für die Küche, in BEIDEN Tabs: im "Offen"-Tab die noch offenen
        // Positionen je Station (Vorspeise/Hauptspeise/Barbecue, siehe stationOpenOnly),
        // im "Vergangene Bestellungen"-Tab jede bereits abgehakte Position als EIGENE Karte
        // (kitchenStations.*.doneOrders, siehe stationDoneItems), sortiert nach Abhak-Zeit —
        // eine einzelne Position wandert also sofort beim Abhaken von der Offen- in eine
        // eigene Vergangene-Bestellungen-Karte, statt erst wenn ALLE Positionen dieser
        // Station fertig sind, und ohne mit anderen Positionen zu einer Sammelkarte
        // vermischt zu werden (leichter wiederzufinden, falls aus Versehen abgehakt). So
        // blockiert eine schon fertige Position keinen Platz mehr in der Offen-Karte, den eine neu
        // eingehende Bestellung bräuchte, und dieselbe Bestellung kann gleichzeitig als
        // Offen- UND Vergangene-Bestellungen-Karte in derselben Station auftauchen.
        <View
          style={styles.stationRow}
          onLayout={(e) => handleStationRowLayout(e.nativeEvent.layout.width)}
        >
          <View style={{ flex: stationRatios[0] }}>
            <StationHeader
              title={kitchenStations!.primary.title}
              count={tab === 'offen' ? countOpenItems(kitchenStations!.primary.openOrders) : countItems(kitchenStations!.primary.doneOrders)}
              suffix={tab === 'offen' ? 'offen' : 'erledigt'}
              large={largeMode}
              styles={styles}
            />
            <TicketList
              orders={tab === 'offen' ? kitchenStations!.primary.openOrders : kitchenStations!.primary.doneOrders}
              large={largeMode}
              styles={styles}
              cardBackground={cardBackground}
              onToggleItem={setItemStatus}
              onCompleteOrder={completeOrder}
              allowComplete={tab === 'offen'}
              showFinishedAt={tab === 'fertig'}
              emptyText={tab === 'offen' ? kitchenStations!.primary.openEmptyText : kitchenStations!.primary.doneEmptyText}
              columns={2}
            />
          </View>
          {/* Trennlinie zwischen Vorspeise/Hauptspeise per Drag verschiebbar (siehe
              dividerResponders/stationRatios) — die Breiten (Vorspeise/Hauptspeise
              standardmäßig gleich breit, Barbecue schmaler, da kurze Gerichtenamen) sind
              damit nur noch der Startzustand, nicht mehr fix. */}
          <StationDividerHandle responder={dividerResponders[0]} styles={styles} />
          <View style={{ flex: stationRatios[1] }}>
            <StationHeader
              title={kitchenStations!.secondary.title}
              count={tab === 'offen' ? countOpenItems(kitchenStations!.secondary.openOrders) : countItems(kitchenStations!.secondary.doneOrders)}
              suffix={tab === 'offen' ? 'offen' : 'erledigt'}
              large={largeMode}
              styles={styles}
            />
            <TicketList
              orders={tab === 'offen' ? kitchenStations!.secondary.openOrders : kitchenStations!.secondary.doneOrders}
              large={largeMode}
              styles={styles}
              cardBackground={cardBackground}
              onToggleItem={setItemStatus}
              onCompleteOrder={completeOrder}
              allowComplete={tab === 'offen'}
              showFinishedAt={tab === 'fertig'}
              emptyText={tab === 'offen' ? kitchenStations!.secondary.openEmptyText : kitchenStations!.secondary.doneEmptyText}
              columns={2}
            />
          </View>
          <StationDividerHandle responder={dividerResponders[1]} styles={styles} />
          <View style={{ flex: stationRatios[2] }}>
            <StationHeader
              title={kitchenStations!.tertiary.title}
              count={tab === 'offen' ? countOpenItems(kitchenStations!.tertiary.openOrders) : countItems(kitchenStations!.tertiary.doneOrders)}
              suffix={tab === 'offen' ? 'offen' : 'erledigt'}
              large={largeMode}
              styles={styles}
            />
            <TicketList
              orders={tab === 'offen' ? kitchenStations!.tertiary.openOrders : kitchenStations!.tertiary.doneOrders}
              large={largeMode}
              styles={styles}
              cardBackground={cardBackground}
              onToggleItem={setItemStatus}
              onCompleteOrder={completeOrder}
              allowComplete={tab === 'offen'}
              showFinishedAt={tab === 'fertig'}
              emptyText={tab === 'offen' ? kitchenStations!.tertiary.openEmptyText : kitchenStations!.tertiary.doneEmptyText}
              columns={1}
            />
          </View>
        </View>
      )}
    </View>
  );
}

// Ersetzt die Ticket-Liste komplett, solange im "Offen"-Tab der Küche nichts ansteht
// (statt nur eines schlichten ListEmptyComponent-Texts wie sonst) — ein kleiner Spaß für
// ruhige Momente. Gilt für alle drei Spalten gleichzeitig (dieselbe `open`-Liste speist
// sie alle), deshalb einmal über dem ganzen Board statt einmal pro Spalte. Die Bar hat
// dieses Vollbild-Banner nicht (siehe isBar), da ihre Vergangene-Bestellungen-Spalte immer
// sichtbar bleiben soll.
// Zwei-Zeilen-Beschriftung für die Küchen-Tabs (Offen/Vergangene Bestellungen/Komplett/
// Anzahl) — Hanzi oben/primär, Deutsch darunter/sekundär, genau wie bei den Gerichtenamen
// auf den Ticket-Karten selbst (siehe CLAUDE.md: Küchenmitarbeiter sprechen kein Deutsch,
// Hanzi ist deshalb überall in der Küchen-Ansicht die primäre Sprache, nicht nur bei den
// Gerichten). Nur für die Küchen-Tabs verwendet — die Bar arbeitet auf Deutsch, ihr
// statischer Titel (barTitleText) bleibt einsprachig.
function KitchenTabLabel({
  hanzi,
  de,
  count,
  active,
  large,
  styles,
}: {
  hanzi: string;
  de: string;
  count: number;
  active: boolean;
  large: boolean;
  styles: BoardStyles;
}) {
  return (
    <>
      <Text style={[styles.tabTextHanzi, large && styles.tabTextHanziLarge, active && styles.tabTextActive]}>
        {hanzi} ({count})
      </Text>
      <Text style={[styles.tabTextDe, large && styles.tabTextDeLarge, active && styles.tabTextActive]}>{de}</Text>
    </>
  );
}

function BarTabLabel({
  label,
  count,
  active,
  large,
  styles,
}: {
  label: string;
  count: number;
  active: boolean;
  large: boolean;
  styles: BoardStyles;
}) {
  return (
    <Text style={[styles.tabTextHanzi, large && styles.tabTextHanziLarge, active && styles.tabTextActive]}>
      {label} ({count})
    </Text>
  );
}

function EmptyBoardBanner({ large, styles }: { large: boolean; styles: BoardStyles }) {
  return (
    <View style={styles.emptyBanner}>
      <Text style={[styles.emptyBannerText, large && styles.emptyBannerTextLarge]}>
        啊呀怎么没事情干啊😔😔😔
      </Text>
      <Image
        source={IMPATIENT_HONGBIN}
        style={[styles.emptyBannerImage, large && styles.emptyBannerImageLarge]}
        resizeMode="contain"
      />
    </View>
  );
}

function StationHeader({
  title,
  count,
  suffix = 'offen',
  large,
  styles,
}: {
  title: string;
  count: number;
  // 'erledigt' für die Vergangene-Bestellungen-Spalte der Bar (siehe isBar), sonst
  // Standard 'offen' wie für Vorspeise/Hauptspeise/Getränke/Nachspeisen.
  suffix?: string;
  large: boolean;
  styles: BoardStyles;
}) {
  return (
    <View style={styles.stationHeader}>
      <Text style={[styles.stationHeaderText, large && styles.stationHeaderTextLarge]}>{title}</Text>
      <Text style={[styles.stationHeaderCount, large && styles.stationHeaderCountLarge]}>
        {count} {suffix}
      </Text>
    </View>
  );
}

// Draggable Trennlinie zwischen zwei Küchen-Stationen-Spalten (siehe
// dividerResponders/stationRatios in DeviceTicketBoard) — eine breitere, unsichtbare
// Grifffläche um die eigentlich sichtbare 1px-Linie herum, damit sie sich auch mit einem
// Kochfinger treffsicher greifen lässt, ohne selbst breit auszusehen.
function StationDividerHandle({ responder, styles }: { responder: PanResponderInstance; styles: BoardStyles }) {
  return (
    <View style={styles.stationDividerHandle} {...responder.panHandlers}>
      <View style={styles.stationDividerLine} />
    </View>
  );
}

// Eine Spalte für den "Anzahl"-Tab (siehe kitchenDishCounts) — zeigt statt einzelner
// Ticket-Karten eine schlichte, nach Menge sortierte Liste "5× Gyoza" pro Gericht/Variante.
// Kein Antippen/Abhaken hier: die Stückzahl ist eine reine Zähl-Hilfe zum Nachbraten in
// einem Rutsch, das eigentliche Abhaken passiert weiterhin über die Ticket-Karten im
// "Offen"-Tab (sonst müsste geklärt werden, WELCHE der z.B. 5 Gyoza-Bestellungen gemeint
// ist).
function DishCountList({
  entries,
  large,
  styles,
  emptyText,
}: {
  entries: DishCount[];
  large: boolean;
  styles: BoardStyles;
  emptyText: string;
}) {
  return (
    <FlatList
      data={entries}
      keyExtractor={(entry) => entry.key}
      contentContainerStyle={[styles.listContent, large && styles.listContentLarge]}
      renderItem={({ item: entry }) => (
        <View style={[styles.countCard, large && styles.countCardLarge]}>
          <Text style={[styles.countCardCount, large && styles.countCardCountLarge]}>{entry.count}×</Text>
          <View style={styles.countCardTextWrap}>
            <Text style={[styles.countCardDish, large && styles.countCardDishLarge]}>{entry.dishLabel}</Text>
            {entry.variantLabel && (
              <Text style={[styles.countCardVariant, large && styles.countCardVariantLarge]}>{entry.variantLabel}</Text>
            )}
          </View>
        </View>
      )}
      ListEmptyComponent={<Text style={styles.emptyText}>{emptyText}</Text>}
    />
  );
}

// Eine Spalte Bestellkarten — dieselbe Karten-Darstellung wird sowohl für die normale
// Einzel-Liste (der "Fertig"-Tab der Küche, die Vergangene-Bestellungen-Spalte der Bar) als
// auch für jede Spalte der "Offen"-Mehr-Spalten-Ansicht verwendet, damit Kartenlayout/
// -verhalten überall identisch bleiben.
function TicketList({
  orders,
  large,
  styles,
  cardBackground,
  onToggleItem,
  onCompleteOrder,
  allowComplete = false,
  emptyText,
  columns = 1,
  showFinishedAt = false,
}: {
  orders: GroupedOrder[];
  large: boolean;
  styles: BoardStyles;
  cardBackground: Record<OrderProgress, object>;
  onToggleItem: (itemId: string, status: OrderItemStatus) => void;
  onCompleteOrder?: (order: GroupedOrder) => void;
  allowComplete?: boolean;
  emptyText: string;
  // 2 für die Vorspeise-/Hauptspeise-Spalten (siehe DeviceTicketBoard) — zwei Karten
  // nebeneinander statt einer einzelnen Spalte, damit auf einen Blick mehr offene
  // Tickets sichtbar sind, ohne scrollen zu müssen.
  columns?: number;
  // true für die "Vergangene Bestellungen"-Listen (Küchen-Stationen im "Fertig"-Tab, die
  // Vergangene-Bestellungen-Spalte der Bar): zeigt die Fertig-Zeit (spätestes done_at der
  // Karte, siehe latestDoneAt) statt der Bestellzeit — dort interessiert, wann abgehakt
  // wurde, nicht wann bestellt wurde. Bestimmt nur die Anzeige, die Sortierung nach
  // Fertig-Zeit passiert schon vorher beim Aufbau von `orders` (stationDoneItems/`done`).
  showFinishedAt?: boolean;
}) {
  return (
    <FlatList
      data={orders}
      keyExtractor={(order) => order.orderId}
      numColumns={columns}
      columnWrapperStyle={columns > 1 ? styles.cardRow : undefined}
      contentContainerStyle={[styles.listContent, large && styles.listContentLarge]}
      renderItem={({ item: order }) => {
        const finishedAtMs = showFinishedAt ? latestDoneAt(order) : 0;
        const card = (
          <View style={[styles.card, large && styles.cardLarge, cardBackground[progressFor(order)]]}>
            <View style={styles.cardHeader}>
              <Text style={[styles.tableLabel, large && styles.tableLabelLarge]}>Tisch {order.table.number}</Text>
              <View style={styles.cardHeaderRight}>
                <Text style={[styles.timeLabel, large && styles.timeLabelLarge]}>
                  {showFinishedAt && finishedAtMs > 0
                    ? `Fertig ${formatTime(new Date(finishedAtMs).toISOString())}`
                    : formatTime(order.createdAt)}
                </Text>
                {allowComplete && (
                  <TouchableOpacity
                    onPress={() => onCompleteOrder?.(order)}
                    style={[styles.cardCloseButton, large && styles.cardCloseButtonLarge]}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Text style={[styles.cardCloseButtonText, large && styles.cardCloseButtonTextLarge]}>×</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
            {order.items.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={[styles.itemRow, large && styles.itemRowLarge]}
              onPress={() => onToggleItem(item.id, item.status === 'offen' ? 'fertig' : 'offen')}
            >
              {item.menu_item.name_hanzi ? (
                <>
                  <Text
                    style={[styles.itemHanzi, large && styles.itemHanziLarge, item.status === 'fertig' && styles.itemDone]}
                  >
                    {item.menu_item.item_code ? `${item.menu_item.item_code} · ` : ''}
                    {item.menu_item.name_hanzi}
                    {item.variant_hanzi ? ` · ${item.variant_hanzi}` : ''}
                  </Text>
                  <Text style={[styles.itemDe, large && styles.itemDeLarge, item.status === 'fertig' && styles.itemDone]}>
                    {item.menu_item.name_de}
                    {item.variant_de ? ` · ${item.variant_de}` : ''}
                  </Text>
                </>
              ) : (
                // Bar-Items haben kein Hanzi (an der Bar wird auf Deutsch gearbeitet) —
                // deutschen Namen dann in der großen/fetten Zeile zeigen statt einer leeren
                // Hanzi-Zeile über einem winzigen deutschen Namen darunter.
                <Text
                  style={[styles.itemHanzi, large && styles.itemHanziLarge, item.status === 'fertig' && styles.itemDone]}
                >
                  {item.menu_item.item_code ? `${item.menu_item.item_code} · ` : ''}
                  {item.menu_item.name_de}
                  {item.variant_de ? ` · ${item.variant_de}` : ''}
                </Text>
              )}
              {item.extras && item.extras.length > 0 && (
                // Eigene auffällige Sprechblase statt nur kursivem Text — Extras (z.B.
                // Ajitama-Ei/Mais bei Ramen) wurden von der Küche regelmäßig übersehen, wenn
                // sie nur als kleine Textzeile zwischen Gericht und Notiz stand. Fester
                // Amber-Ton (nicht colors.warning) + Icon, damit sie unabhängig von Hell-/
                // Dunkelmodus und auch beim flüchtigen Blick auf die Karte sofort auffällt.
                <View
                  style={[
                    styles.itemExtrasBadge,
                    large && styles.itemExtrasBadgeLarge,
                    item.status === 'fertig' && styles.itemExtrasBadgeDone,
                  ]}
                >
                  <Text
                    style={[
                      styles.itemExtrasText,
                      large && styles.itemExtrasTextLarge,
                      item.status === 'fertig' && styles.itemExtrasTextDone,
                    ]}
                  >
                    ➕ {item.extras.map((e) => `${e.quantity} ${e.name_hanzi} (${e.name_de})`).join(', ')}
                  </Text>
                </View>
              )}
              {item.note && (
                <Text
                  style={[styles.itemNote, large && styles.itemNoteLarge, item.status === 'fertig' && styles.itemDone]}
                >
                  Notiz: {item.note}
                </Text>
              )}
            </TouchableOpacity>
            ))}
          </View>
        );

        // In der Zwei-Spalten-Kartenansicht (columns=2) braucht der eigentliche Grid-
        // Slot — egal ob rohe Karte oder Swipeable-Wrapper — flex:1, sonst füllt die Karte
        // nicht die ihr per columnWrapperStyle zugewiesene Spaltenbreite aus.
        if (!allowComplete) {
          return columns > 1 ? <View style={styles.cardInRow}>{card}</View> : card;
        }

        // Wisch-Geste als zweiter Weg (neben dem X-Button oben), eine ganze Karte auf
        // einmal abzuhaken — z.B. wenn eine Hand gerade an Töpfen/Tellern beschäftigt
        // ist und ein Wisch schneller geht als gezielt den kleinen X-Button zu treffen.
        // renderRightActions zeigt das grüne Aktionsfeld, während nach links gewischt
        // wird (der Inhalt rutscht dabei nach links, das Feld erscheint von rechts).
        // onSwipeableOpen löst direkt beim vollständigen Öffnen aus, ohne dass zusätzlich
        // noch auf das Aktionsfeld getippt werden müsste — ein durchgezogener Wisch reicht.
        const swipeable = (
          <Swipeable
            renderRightActions={() => (
              <View style={[styles.swipeCompleteAction, large && styles.swipeCompleteActionLarge]}>
                <Text style={[styles.swipeCompleteActionText, large && styles.swipeCompleteActionTextLarge]}>
                  ✓ Fertig
                </Text>
              </View>
            )}
            onSwipeableOpen={(direction) => {
              if (direction === 'right') onCompleteOrder?.(order);
            }}
            overshootRight={false}
            rightThreshold={40}
          >
            {card}
          </Swipeable>
        );

        return columns > 1 ? <View style={styles.cardInRow}>{swipeable}</View> : swipeable;
      }}
      ListEmptyComponent={<Text style={styles.emptyText}>{emptyText}</Text>}
    />
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
    errorText: { color: colors.danger, padding: 16 },
    tabBar: {
      flexDirection: 'row',
      alignItems: 'center',
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    tabsRow: { flex: 1, flexDirection: 'row' },
    tab: { flex: 1, paddingVertical: 14, alignItems: 'center' },
    // Größerer Tab für die Küche (large-Modus) — sonst blieb "Vergangene Bestellungen"
    // bei winziger Standardgröße, obwohl der Rest der Küchen-Ansicht extra groß ist, siehe
    // Kommentar an der Verwendungsstelle oben.
    tabLarge: { paddingVertical: 22 },
    tabActive: { borderBottomWidth: 3, borderBottomColor: colors.text },
    // Zwei-Zeilen-Beschriftung der Küchen-Tabs (siehe KitchenTabLabel): Hanzi oben/primär
    // und größer, Deutsch darunter/sekundär und kleiner — spiegelt dieselbe Hanzi-zuerst-
    // Hierarchie wie bei den Gerichtenamen auf den Ticket-Karten (itemHanzi/itemDe).
    tabTextHanzi: { fontSize: 15, color: colors.textMuted, fontWeight: '600' },
    tabTextHanziLarge: { fontSize: 24, fontWeight: '700' },
    tabTextDe: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
    tabTextDeLarge: { fontSize: 15, marginTop: 2 },
    tabTextActive: { color: colors.text },
    // Ersetzt die Tabs für die Bar (siehe isBar) — nur noch ein statischer Hinweistext,
    // da es nichts mehr umzuschalten gibt.
    barTitleText: { fontSize: 15, fontWeight: '700', color: colors.text, paddingVertical: 14, paddingLeft: 4 },
    // "−"/"+"-Buttons für die Kartengröße (siehe largeMode/setCardSize) — dieselbe
    // Größenanpassung (bellButtonLarge/bellButtonTextLarge) wie die Glocke daneben, damit
    // alle drei Kopfzeilen-Buttons in beiden Kartengrößen gleich aussehen.
    cardSizeButtons: { flexDirection: 'row', gap: 4 },
    cardSizeButton: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardSizeButtonText: { fontSize: 22, fontWeight: '700', color: colors.textSecondary },
    bellButton: { paddingHorizontal: 14, paddingVertical: 10 },
    bellButtonLarge: { paddingHorizontal: 18, paddingVertical: 14 },
    bellButtonText: { fontSize: 22 },
    bellButtonTextLarge: { fontSize: 32 },
    // "Nichts zu tun"-Banner statt Ticket-Liste, siehe EmptyBoardBanner — Text links,
    // Bild rechts. Bild-Breite fix, Höhe über aspectRatio (Originalbild ist 1200×1600,
    // also Hochformat 3:4) statt fixer Höhe, damit es nicht verzerrt wird. overflow:
    // 'hidden' als Sicherheitsnetz — Views clippen in RN standardmäßig NICHT, ein zu
    // großes Bild würde sonst optisch (und für Touches!) über den Container hinaus in
    // die Tableiste darüber hineinragen, wie bei Breite 660 auf der Küche geschehen
    // (660 × 4/3 ≈ 880 hoch, mehr als der verfügbare Platz unter der Tableiste).
    emptyBanner: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 24,
      gap: 20,
      overflow: 'hidden',
    },
    emptyBannerText: {
      flex: 1,
      fontSize: 54,
      fontWeight: '600',
      color: colors.textMuted,
      textAlign: 'right',
    },
    emptyBannerTextLarge: { fontSize: 78 },
    emptyBannerImage: { width: 420, aspectRatio: 3 / 4 },
    emptyBannerImageLarge: { width: 280 },
    // Mehr-Spalten-Ansicht im "Offen"-Tab (Küche: Vorspeise | Hauptspeise | Barbecue, Bar:
    // Getränke | Nachspeisen | Vergangene Bestellungen), jede Spalte unabhängig scrollbar,
    // damit eine große laufende Bestellung nicht mehr die neu eingegangenen Positionen
    // einer anderen Spalte wegscrollt. Die Spaltenbreiten selbst sind keine festen
    // Styles mehr, sondern kommen per Drag-verschiebbarem stationRatios-State als
    // inline-flex (siehe StationDividerHandle) — Start-/Mindestbreiten dafür in
    // defaultStationRatios/MIN_STATION_RATIO weiter oben.
    stationRow: { flex: 1, flexDirection: 'row' },
    // Draggable Trennlinie zwischen zwei Stationen-/Bar-Spalten (siehe
    // StationDividerHandle). Eigene 18px breite Grifffläche statt einer schmalen 1px-Linie
    // direkt, damit sie sich treffsicher mit dem Finger fassen lässt — die eigentlich
    // sichtbare Linie bleibt darin schmal (stationDividerLine), der Rest der Grifffläche
    // ist transparent.
    stationDividerHandle: {
      width: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stationDividerLine: { width: 1, alignSelf: 'stretch', backgroundColor: colors.border },
    stationHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      paddingHorizontal: 12,
      paddingTop: 10,
    },
    stationHeaderText: { fontSize: 15, fontWeight: '700', color: colors.text },
    stationHeaderTextLarge: { fontSize: 20 },
    stationHeaderCount: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
    stationHeaderCountLarge: { fontSize: 16 },
    listContent: { padding: 12, gap: 12 },
    listContentLarge: { gap: 16 },
    // Zwei-Spalten-Kartenraster innerhalb von Vorspeise/Hauptspeise (siehe
    // TicketList columns-Prop) — mehr Tickets gleichzeitig sichtbar statt einer
    // einzelnen, tief scrollenden Spalte.
    cardRow: { gap: 12 },
    cardInRow: { flex: 1 },
    card: {
      borderRadius: 12,
      padding: 14,
      marginBottom: 12,
    },
    cardLarge: { padding: 20, borderRadius: 16 },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
      gap: 8,
    },
    tableLabel: { fontSize: 18, fontWeight: '700', color: colors.text },
    tableLabelLarge: { fontSize: 28 },
    cardHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    timeLabel: { fontSize: 13, color: colors.textMuted, fontWeight: '600' },
    timeLabelLarge: { fontSize: 18 },
    // X-Button zum Abhaken der ganzen Karte auf einmal (siehe TicketList) — bewusst als
    // dezenter Kreis statt eines auffälligen roten Buttons, damit er im hektischen
    // Küchenbetrieb nicht mit einem Fehler-/Löschen-Signal verwechselt wird; das eigentliche
    // "Fertig"-Signal kommt über die Kartenfarbe (siehe cardBackgroundFor), sobald alle
    // Items abgehakt sind.
    cardCloseButton: {
      width: 26,
      height: 26,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceAlt,
    },
    cardCloseButtonLarge: { width: 38, height: 38, borderRadius: 19 },
    cardCloseButtonText: { fontSize: 16, fontWeight: '700', color: colors.textSecondary, lineHeight: 18 },
    cardCloseButtonTextLarge: { fontSize: 22, lineHeight: 24 },
    // Grünes Aktionsfeld, das beim Wischen einer Karte nach links von rechts hereinrutscht
    // (siehe renderRightActions in TicketList) — dieselbe Breite muss nicht exakt zum
    // rightThreshold der Swipeable passen, das Feld ist nur die visuelle Rückmeldung.
    swipeCompleteAction: {
      width: 96,
      marginBottom: 12,
      borderRadius: 12,
      backgroundColor: '#16a34a',
      alignItems: 'center',
      justifyContent: 'center',
    },
    swipeCompleteActionLarge: { width: 130, borderRadius: 16 },
    swipeCompleteActionText: { color: '#fff', fontWeight: '700', fontSize: 14 },
    swipeCompleteActionTextLarge: { fontSize: 18 },
    itemRow: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border },
    itemRowLarge: { paddingVertical: 14 },
    itemHanzi: { fontSize: 18, fontWeight: '600', color: colors.text },
    itemHanziLarge: { fontSize: 28 },
    itemDe: { fontSize: 13, color: colors.textMuted },
    itemDeLarge: { fontSize: 19 },
    // Fest verdrahteter Amber-Ton statt colors.warning — soll unabhängig vom Theme gleich
    // knallig bleiben, damit Extras nirgends im Dunkelmodus verwaschen wirken.
    itemExtrasBadge: {
      alignSelf: 'flex-start',
      marginTop: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 8,
      backgroundColor: '#f59e0b',
    },
    itemExtrasBadgeLarge: { marginTop: 10, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
    itemExtrasBadgeDone: { opacity: 0.5 },
    itemExtrasText: { fontSize: 14, fontWeight: '800', color: '#1c1c1e' },
    itemExtrasTextLarge: { fontSize: 19 },
    itemExtrasTextDone: { textDecorationLine: 'line-through' },
    itemNote: { fontSize: 12, color: colors.warning, marginTop: 2, fontWeight: '700' },
    itemNoteLarge: { fontSize: 17, marginTop: 4 },
    itemDone: { textDecorationLine: 'line-through', color: colors.textFaint },
    emptyText: { textAlign: 'center', color: colors.textFaint, marginTop: 32 },
    // Zeilen im "Anzahl"-Tab (siehe DishCountList) — bewusst schlichter/kompakter als die
    // Ticket-Karten (kein Tisch/Zeit-Header, kein Abhaken), die fette Zahl links ist der
    // eigentliche Blickfang.
    countCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 14,
      marginBottom: 12,
      gap: 12,
    },
    countCardLarge: { padding: 20, borderRadius: 16, gap: 18 },
    countCardCount: { fontSize: 24, fontWeight: '800', color: colors.text, minWidth: 44 },
    countCardCountLarge: { fontSize: 40, minWidth: 74 },
    countCardTextWrap: { flex: 1 },
    countCardDish: { fontSize: 17, fontWeight: '600', color: colors.text },
    countCardDishLarge: { fontSize: 26 },
    countCardVariant: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
    countCardVariantLarge: { fontSize: 18, marginTop: 4 },
  });
