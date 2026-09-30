import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, PanResponder, SectionList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { ImageStyle, PanResponderInstance, TextStyle, ViewStyle } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useDeviceOrders, type DeviceOrderItem, type GroupedOrder } from '../hooks/useDeviceOrders';
import { useNewOrderChime } from '../hooks/useNewOrderChime';
import { useIsPhone } from '../hooks/useIsPhone';
import type { OrderItemStatus, TargetDevice } from '../types/database';
import type { ThemeColors } from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';
import { useThemedStyles } from '../theme/useThemedStyles';
import { translate, useI18n } from '../i18n/LanguageContext';
import type { StringKey } from '../i18n/strings';

// Übersetzer für die Board-Oberfläche: Bar immer Deutsch, Küche nach gewählter Sprache
// (Gerichtenamen auf den Tickets bleiben unabhängig davon zweisprachig).
type BoardT = (key: StringKey, params?: Record<string, string | number>) => string;

type Tab = 'offen' | 'fertig' | 'anzahl';
// Bewusst als "irgendein Style je Schlüssel" statt der exakten Literal-Typen aus
// StyleSheet.create — sonst ließe sich die Handy-Variante (createPhoneStyles, z.B.
// emptyBanner mit flexDirection 'column' statt 'row') nicht an dieselben Komponenten geben.
type BoardStyles = { [K in keyof ReturnType<typeof createStyles>]: ViewStyle & TextStyle & ImageStyle };

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

// Handy-Ansicht der Küche (siehe PhoneKitchenBoard): zuletzt gewählter Stationen-Filter,
// damit z.B. ein Handy, das fest am Grill liegt, direkt wieder auf "烤肉" steht.
const PHONE_STATION_STORAGE_KEY = 'yami:phone-kitchen-station';
type PhoneStation = 'all' | 'vorspeise' | 'hauptspeise' | 'barbecue';
const PHONE_STATIONS: PhoneStation[] = ['all', 'vorspeise', 'hauptspeise', 'barbecue'];
const PHONE_STATION_SLOT = { vorspeise: 'primary', hauptspeise: 'secondary', barbecue: 'tertiary' } as const;

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

// Reduziert jede Bestellung auf die Positionen, die zum Prädikat passen — für die Spalten
// von Küche (Vorspeise/Hauptspeise/Barbecue, siehe categories.kitchen_station) und Bar
// (Getränke/Nachspeisen, siehe categories.menu_group). Eine Karte behält dabei auch bereits
// abgehakte Positionen (grüner Haken + durchgestrichen) und fällt erst raus, sobald ALLE
// Positionen DIESER Spalte abgehakt sind — dann landet sie als ganzes Ticket in
// "Vergangene Bestellungen" (Küche: stationDoneTickets, Bar: `done`).
function itemsMatching(orders: GroupedOrder[], predicate: (item: DeviceOrderItem) => boolean): GroupedOrder[] {
  return orders
    .map((order) => ({
      ...order,
      items: order.items.filter(predicate),
    }))
    .filter((order) => order.items.some((item) => item.status === 'offen'));
}

// Zeitpunkt, an dem die letzte Position der Bestellung fertig markiert wurde — bestimmt
// die Reihenfolge der "Vergangene Bestellungen"-Liste (neueste zuerst).
function latestDoneAt(order: GroupedOrder): number {
  return order.items.reduce((latest, item) => Math.max(latest, item.done_at ? new Date(item.done_at).getTime() : 0), 0);
}

// Gegenstück zu itemsMatching für die "Vergangene Bestellungen"-Spalten der Küche: ganze
// Tickets (je Station), bei denen ALLE Positionen dieser Station abgehakt sind — neueste
// zuerst. Eine abgehakte Position bleibt bis dahin auf ihrem Ticket in der Offen-Spalte
// stehen (grüner Haken, durchgestrichen), statt einzeln in "Vergangene Bestellungen" zu
// wandern — so sieht der Koch am Ticket selbst, was schon raus ist und was noch fehlt.
// Erneutes Antippen des Hakens auf einem vergangenen Ticket setzt die Position zurück auf
// "offen" und holt das Ticket damit wieder in die Offen-Spalte.
function stationDoneTickets(orders: GroupedOrder[], predicate: (item: DeviceOrderItem) => boolean): GroupedOrder[] {
  return orders
    .map((order) => ({ ...order, items: order.items.filter(predicate) }))
    .filter((order) => order.items.length > 0 && order.items.every((item) => item.status === 'fertig'))
    .sort((a, b) => latestDoneAt(b) - latestDoneAt(a));
}

// Eine Zeile auf dem Ticket = alle GLEICHEN Portionen einer Bestellung zusammen ("3×
// Bibimbap Rind" statt drei einzelner Zeilen). order_items speichert jede Portion als eigene
// Zeile (siehe OrderScreen.tsx submitOrder), gleich heißt hier: gleiches Gericht, gleiche
// Variante, gleiche Extras, gleiche Notiz UND gleicher Status — abgehakte und offene
// Portionen stehen also als getrennte Zeilen da (z.B. "2× Gyoza" offen, "1× Gyoza" fertig),
// damit der Haken-Button eindeutig bleibt: er hakt alle Portionen seiner Zeile auf einmal
// ab bzw. setzt sie zurück. Reihenfolge = erstes Auftreten (also weiterhin nach sort_order).
interface ItemGroup {
  key: string;
  item: DeviceOrderItem; // repräsentative Portion für Name/Variante/Extras/Notiz
  ids: string[];
}

function groupItems(items: DeviceOrderItem[]): ItemGroup[] {
  const groups = new Map<string, ItemGroup>();
  for (const item of items) {
    const extrasKey = (item.extras ?? [])
      .map((e) => `${e.name_de}x${e.quantity}`)
      .sort()
      .join('|');
    const key = [item.menu_item.id, item.variant_de ?? '', extrasKey, item.note ?? '', item.status].join('::');
    const group = groups.get(key);
    if (group) group.ids.push(item.id);
    else groups.set(key, { key, item, ids: [item.id] });
  }
  return Array.from(groups.values());
}

function countOpenItems(orders: GroupedOrder[]): number {
  return orders.reduce((sum, order) => sum + order.items.filter((item) => item.status === 'offen').length, 0);
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
  const { lang } = useI18n();
  const uiLang = targetDevice === 'bar' ? 'de' : lang;
  const bt: BoardT = (key, params) => translate(uiLang, key, params);
  // Küche auf Deutsch behält die zweisprachige Beschriftung (Küchenpersonal spricht
  // Chinesisch), auf Chinesisch rein chinesisch; Bar rein deutsch.
  const completeAllLabel =
    targetDevice === 'bar' ? '✓ Alle fertig' : lang === 'zh' ? '✓ 全部完成' : '✓ 全部完成 · Alle fertig';
  const cardBackground = useMemo(() => cardBackgroundFor(colors), [colors]);
  const { orders: rawOrders, loading, error, setItemsStatus } = useDeviceOrders(targetDevice);
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
  // Auf dem Handy (kürzeste Seite < 600dp) bekommt die Küche statt der drei Spalten
  // nebeneinander eine eigene, einspaltige Ansicht (PhoneKitchenBoard) — drei Spalten mit
  // je zwei Karten waren auf ~390px Breite unlesbar gequetscht. Tablet/Laptop unverändert.
  const isPhone = useIsPhone();
  const styles = useThemedStyles(createStyles);
  const phoneStyles = useThemedStyles(createPhoneStyles);
  const [phoneStation, setPhoneStation] = useState<PhoneStation>('all');

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(PHONE_STATION_STORAGE_KEY).then((stored) => {
      if (!cancelled && stored && (PHONE_STATIONS as string[]).includes(stored)) setPhoneStation(stored as PhoneStation);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function changePhoneStation(next: PhoneStation) {
    setPhoneStation(next);
    AsyncStorage.setItem(PHONE_STATION_STORAGE_KEY, next);
  }
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

  // Küchen-Stationen (Vorspeise | Hauptspeise | Barbecue): pro Station die offenen und die
  // bereits komplett erledigten Tickets, unabhängig vom gerade gewählten Tab — die Tab-Leiste
  // zeigt "Offen (n)" und "Vergangene Bestellungen (n)" gleichzeitig. "openOrders" sind ganze
  // Tickets (je Station), auf denen abgehakte Positionen mit grünem Haken stehen bleiben
  // (itemsMatching), bis das Ticket für diese Station komplett ist — dann wandert es als
  // Ganzes nach "doneOrders" (stationDoneTickets).
  const kitchenStations = useMemo(() => {
    if (targetDevice !== 'kitchen') return null;

    const build = (
      title: string,
      predicate: (item: DeviceOrderItem) => boolean,
      openEmptyText: string,
      doneEmptyText: string
    ) => ({
      title,
      openOrders: itemsMatching(orders, predicate),
      openEmptyText,
      doneOrders: stationDoneTickets(orders, predicate),
      doneEmptyText,
    });

    return {
      primary: build(
        bt('stationVorspeise'),
        (item) => (item.menu_item.category.kitchen_station ?? 'hauptspeise') === 'vorspeise',
        bt('emptyOpenVorspeise'),
        bt('emptyDoneVorspeise')
      ),
      secondary: build(
        bt('stationHauptspeise'),
        (item) => (item.menu_item.category.kitchen_station ?? 'hauptspeise') === 'hauptspeise',
        bt('emptyOpenHauptspeise'),
        bt('emptyDoneHauptspeise')
      ),
      tertiary: build(
        bt('stationBarbecue'),
        (item) => item.menu_item.category.kitchen_station === 'barbecue',
        bt('emptyOpenBarbecue'),
        bt('emptyDoneBarbecue')
      ),
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- bt hängt nur an uiLang
  }, [orders, targetDevice, uiLang]);

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

  // Tab-Zähler "Vergangene Bestellungen (n)": Summe der fertigen Tickets aller drei
  // Stationen-Spalten — ein Tisch kann z.B. mit der Vorspeise schon fertig sein, während
  // seine Hauptspeise noch offen ist.
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
        <Text style={styles.errorText}>{bt('ordersLoadError', { error })}</Text>
      </View>
    );
  }

  if (targetDevice === 'kitchen' && isPhone) {
    return (
      <PhoneKitchenBoard
        styles={phoneStyles}
        t={bt}
        lang={lang}
        tab={tab}
        onTabChange={setTab}
        station={phoneStation}
        onStationChange={changePhoneStation}
        openCount={open.length}
        openItemCount={countOpenItems(open)}
        doneCardCount={kitchenDoneCardCount}
        stations={kitchenStations!}
        dishCounts={kitchenDishCounts!}
        soundEnabled={soundEnabled}
        onToggleSound={toggleSound}
        completeAllLabel={completeAllLabel}
        cardBackground={cardBackground}
        onToggleItem={setItemsStatus}
        onCompleteOrder={completeOrder}
      />
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
              <KitchenTabLabel hanzi="待做" de={lang === 'de' ? 'Offen' : null} count={open.length} active={tab === 'offen'} large={largeMode} styles={styles} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, largeMode && styles.tabLarge, tab === 'fertig' && styles.tabActive]}
              onPress={() => setTab('fertig')}
            >
              <KitchenTabLabel
                hanzi="已完成"
                de={lang === 'de' ? 'Vergangene Bestellungen' : null}
                count={kitchenDoneCardCount}
                active={tab === 'fertig'}
                large={largeMode}
                styles={styles}
              />
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
                de={lang === 'de' ? 'Anzahl' : null}
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
                t={bt}
                completeAllLabel={completeAllLabel}
                orders={barColumns!.primaryOrders}
                large={largeMode}
                styles={styles}
                cardBackground={cardBackground}
                onToggleItem={setItemsStatus}
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
                t={bt}
                completeAllLabel={completeAllLabel}
                orders={barColumns!.secondaryOrders}
                large={largeMode}
                styles={styles}
                cardBackground={cardBackground}
                onToggleItem={setItemsStatus}
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
                t={bt}
                completeAllLabel={completeAllLabel}
              orders={done}
              large={largeMode}
              styles={styles}
              cardBackground={cardBackground}
              onToggleItem={setItemsStatus}
              showFinishedAt
              emptyText="Noch keine erledigten Bestellungen."
            />
          </View>
        </View>
      ) : tab === 'offen' && open.length === 0 ? (
        <EmptyBoardBanner large={largeMode} styles={styles} />
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
            <StationHeader title={kitchenStations!.primary.title} count={sumCounts(kitchenDishCounts!.primary)} suffix={bt('suffixOpen')} large={largeMode} styles={styles} />
            <DishCountList entries={kitchenDishCounts!.primary} large={largeMode} styles={styles} emptyText={bt('emptyOpenVorspeise')} />
          </View>
          <StationDividerHandle responder={dividerResponders[0]} styles={styles} />
          <View style={{ flex: stationRatios[1] }}>
            <StationHeader title={kitchenStations!.secondary.title} count={sumCounts(kitchenDishCounts!.secondary)} suffix={bt('suffixOpen')} large={largeMode} styles={styles} />
            <DishCountList entries={kitchenDishCounts!.secondary} large={largeMode} styles={styles} emptyText={bt('emptyOpenHauptspeise')} />
          </View>
          <StationDividerHandle responder={dividerResponders[1]} styles={styles} />
          <View style={{ flex: stationRatios[2] }}>
            <StationHeader title={kitchenStations!.tertiary.title} count={sumCounts(kitchenDishCounts!.tertiary)} suffix={bt('suffixOpen')} large={largeMode} styles={styles} />
            <DishCountList entries={kitchenDishCounts!.tertiary} large={largeMode} styles={styles} emptyText={bt('emptyOpenBarbecue')} />
          </View>
        </View>
      ) : (
        // Drei Spalten für die Küche, in BEIDEN Tabs: im "Offen"-Tab die Tickets mit noch
        // offenen Positionen je Station (abgehakte Positionen bleiben mit grünem Haken auf
        // dem Ticket stehen), im "Vergangene Bestellungen"-Tab die Tickets, die für diese
        // Station komplett fertig sind — neueste zuerst.
        <View
          style={styles.stationRow}
          onLayout={(e) => handleStationRowLayout(e.nativeEvent.layout.width)}
        >
          <View style={{ flex: stationRatios[0] }}>
            <StationHeader
              title={kitchenStations!.primary.title}
              count={tab === 'offen' ? countOpenItems(kitchenStations!.primary.openOrders) : kitchenStations!.primary.doneOrders.length}
              suffix={tab === 'offen' ? bt('suffixOpen') : bt('suffixDone')}
              large={largeMode}
              styles={styles}
            />
            <TicketList
                t={bt}
                completeAllLabel={completeAllLabel}
              orders={tab === 'offen' ? kitchenStations!.primary.openOrders : kitchenStations!.primary.doneOrders}
              large={largeMode}
              styles={styles}
              cardBackground={cardBackground}
              onToggleItem={setItemsStatus}
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
              count={tab === 'offen' ? countOpenItems(kitchenStations!.secondary.openOrders) : kitchenStations!.secondary.doneOrders.length}
              suffix={tab === 'offen' ? bt('suffixOpen') : bt('suffixDone')}
              large={largeMode}
              styles={styles}
            />
            <TicketList
                t={bt}
                completeAllLabel={completeAllLabel}
              orders={tab === 'offen' ? kitchenStations!.secondary.openOrders : kitchenStations!.secondary.doneOrders}
              large={largeMode}
              styles={styles}
              cardBackground={cardBackground}
              onToggleItem={setItemsStatus}
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
              count={tab === 'offen' ? countOpenItems(kitchenStations!.tertiary.openOrders) : kitchenStations!.tertiary.doneOrders.length}
              suffix={tab === 'offen' ? bt('suffixOpen') : bt('suffixDone')}
              large={largeMode}
              styles={styles}
            />
            <TicketList
                t={bt}
                completeAllLabel={completeAllLabel}
              orders={tab === 'offen' ? kitchenStations!.tertiary.openOrders : kitchenStations!.tertiary.doneOrders}
              large={largeMode}
              styles={styles}
              cardBackground={cardBackground}
              onToggleItem={setItemsStatus}
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

type KitchenStationData = {
  title: string;
  openOrders: GroupedOrder[];
  openEmptyText: string;
  doneOrders: GroupedOrder[];
  doneEmptyText: string;
};
type KitchenStationsData = Record<'primary' | 'secondary' | 'tertiary', KitchenStationData>;
type KitchenDishCountsData = Record<'primary' | 'secondary' | 'tertiary', DishCount[]>;
type PhoneStyles = ReturnType<typeof createPhoneStyles>;

// Handy-Ansicht der Küche (siehe useIsPhone) — statt drei Stationen-Spalten nebeneinander:
//   1. kompakte Tab-Leiste (待做 / 已完成 / 数量, deutsche Kurzform darunter), nur Glocke,
//      keine "−"/"+"-Kartengröße (auf dem Handy gibt es nur eine sinnvolle Größe),
//   2. darunter eine Stationen-Leiste als Filter (全部 | 小吃 | 主食 | 烤肉) mit Zähler je
//      Station — "全部" zeigt alle Stationen untereinander mit fixierten Abschnitts-
//      Überschriften, eine einzelne Station nur deren Tickets,
//   3. EINE Spalte volle Breite mit denselben Ticket-Karten wie auf dem Tablet (TicketCard,
//      gleiches Abhaken/Wischen/"全部完成"), nur mit etwas größerer Schrift/Haken für das
//      kleine Display.
// Datenbasis (kitchenStations/kitchenDishCounts) ist exakt dieselbe wie auf dem Tablet.
function PhoneKitchenBoard({
  styles,
  t,
  lang,
  tab,
  onTabChange,
  station,
  onStationChange,
  openCount,
  openItemCount,
  doneCardCount,
  stations,
  dishCounts,
  soundEnabled,
  onToggleSound,
  completeAllLabel,
  cardBackground,
  onToggleItem,
  onCompleteOrder,
}: {
  styles: PhoneStyles;
  t: BoardT;
  lang: string;
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  station: PhoneStation;
  onStationChange: (station: PhoneStation) => void;
  openCount: number;
  openItemCount: number;
  doneCardCount: number;
  stations: KitchenStationsData;
  dishCounts: KitchenDishCountsData;
  soundEnabled: boolean;
  onToggleSound: () => void;
  completeAllLabel: string;
  cardBackground: Record<OrderProgress, object>;
  onToggleItem: (itemIds: string[], status: OrderItemStatus) => void;
  onCompleteOrder: (order: GroupedOrder) => void;
}) {
  const de = lang === 'de';

  function countFor(s: Exclude<PhoneStation, 'all'>): number {
    const slot = PHONE_STATION_SLOT[s];
    if (tab === 'offen') return countOpenItems(stations[slot].openOrders);
    if (tab === 'fertig') return stations[slot].doneOrders.length;
    return sumCounts(dishCounts[slot]);
  }

  const stationList: Exclude<PhoneStation, 'all'>[] =
    station === 'all' ? ['vorspeise', 'hauptspeise', 'barbecue'] : [station];
  const showSectionHeaders = station === 'all';
  const suffix = tab === 'fertig' ? t('suffixDone') : t('suffixOpen');

  const tabs: { key: Tab; hanzi: string; de: string; count: number }[] = [
    { key: 'offen', hanzi: '待做', de: 'Offen', count: openCount },
    { key: 'fertig', hanzi: '已完成', de: 'Fertig', count: doneCardCount },
    { key: 'anzahl', hanzi: '数量', de: 'Anzahl', count: openItemCount },
  ];

  let content: React.ReactNode;
  if (tab === 'offen' && openCount === 0) {
    content = <EmptyBoardBanner large={false} styles={styles} />;
  } else if (tab === 'anzahl') {
    const sections = stationList
      .map((s) => ({
        key: s,
        title: stations[PHONE_STATION_SLOT[s]].title,
        count: countFor(s),
        data: dishCounts[PHONE_STATION_SLOT[s]],
      }))
      .filter((section) => !showSectionHeaders || section.data.length > 0);
    content = (
      <SectionList
        sections={sections}
        keyExtractor={(entry) => entry.key}
        stickySectionHeadersEnabled
        contentContainerStyle={styles.listContent}
        renderSectionHeader={({ section }) =>
          showSectionHeaders ? (
            <StationHeader title={section.title} count={section.count} suffix={suffix} large={false} styles={styles} />
          ) : null
        }
        renderItem={({ item: entry }) => (
          <View style={styles.countCard}>
            <Text style={styles.countCardCount}>{entry.count}×</Text>
            <View style={styles.countCardTextWrap}>
              <Text style={styles.countCardDish}>{entry.dishLabel}</Text>
              {entry.variantLabel && <Text style={styles.countCardVariant}>{entry.variantLabel}</Text>}
            </View>
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            {station === 'all' ? t('emptyOpenAll') : stations[PHONE_STATION_SLOT[station]].openEmptyText}
          </Text>
        }
      />
    );
  } else {
    const sections = stationList
      .map((s) => {
        const data = stations[PHONE_STATION_SLOT[s]];
        return {
          key: s,
          title: data.title,
          count: countFor(s),
          data: tab === 'offen' ? data.openOrders : data.doneOrders,
        };
      })
      .filter((section) => !showSectionHeaders || section.data.length > 0);
    const emptyText =
      station === 'all'
        ? tab === 'offen'
          ? t('emptyOpenAll')
          : t('emptyDoneAll')
        : tab === 'offen'
          ? stations[PHONE_STATION_SLOT[station]].openEmptyText
          : stations[PHONE_STATION_SLOT[station]].doneEmptyText;
    content = (
      <SectionList
        sections={sections}
        keyExtractor={(order) => order.orderId}
        stickySectionHeadersEnabled
        contentContainerStyle={styles.listContent}
        renderSectionHeader={({ section }) =>
          showSectionHeaders ? (
            <StationHeader title={section.title} count={section.count} suffix={suffix} large={false} styles={styles} />
          ) : null
        }
        renderItem={({ item: order }) => (
          <TicketCard
            t={t}
            completeAllLabel={completeAllLabel}
            order={order}
            large={false}
            styles={styles}
            cardBackground={cardBackground}
            onToggleItem={onToggleItem}
            onCompleteOrder={onCompleteOrder}
            allowComplete={tab === 'offen'}
            showFinishedAt={tab === 'fertig'}
          />
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>{emptyText}</Text>}
      />
    );
  }

  const allCount = countFor('vorspeise') + countFor('hauptspeise') + countFor('barbecue');

  return (
    <View style={styles.container}>
      <View style={styles.tabBar}>
        <View style={styles.tabsRow}>
          {tabs.map(({ key, hanzi, de: deLabel, count }) => (
            <TouchableOpacity key={key} style={[styles.tab, tab === key && styles.tabActive]} onPress={() => onTabChange(key)}>
              <KitchenTabLabel hanzi={hanzi} de={de ? deLabel : null} count={count} active={tab === key} large={false} styles={styles} />
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity style={styles.bellButton} onPress={onToggleSound} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.bellButtonText}>{soundEnabled ? '🔔' : '🔕'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.phoneStationBar}>
        {PHONE_STATIONS.map((s) => {
          const active = s === station;
          const count = s === 'all' ? allCount : countFor(s);
          const label = s === 'all' ? t('stationAll') : stations[PHONE_STATION_SLOT[s]].title;
          return (
            <TouchableOpacity
              key={s}
              style={[styles.phoneStationChip, active && styles.phoneStationChipActive]}
              onPress={() => onStationChange(s)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text
                style={[styles.phoneStationChipLabel, active && styles.phoneStationChipLabelActive]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
              >
                {label}
              </Text>
              <Text
                style={[
                  styles.phoneStationChipCount,
                  count > 0 && tab !== 'fertig' && styles.phoneStationChipCountHot,
                  active && styles.phoneStationChipCountActive,
                ]}
              >
                {count}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {content}
    </View>
  );
}

// Ersetzt die Ticket-Liste komplett, solange im "Offen"-Tab der Küche nichts ansteht
// (statt nur eines schlichten ListEmptyComponent-Texts wie sonst) — ein kleiner Spaß für
// ruhige Momente. Gilt für alle drei Spalten gleichzeitig (dieselbe `open`-Liste speist
// sie alle), deshalb einmal über dem ganzen Board statt einmal pro Spalte. Die Bar hat
// dieses Vollbild-Banner nicht (siehe isBar), da ihre Vergangene-Bestellungen-Spalte immer
// sichtbar bleiben soll.
// Zwei-Zeilen-Beschriftung für die Küchen-Tabs (Offen/Vergangene Bestellungen/
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
  // null = auf Chinesisch geschaltet, dann nur die Hanzi-Zeile.
  de: string | null;
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
      {de && <Text style={[styles.tabTextDe, large && styles.tabTextDeLarge, active && styles.tabTextActive]}>{de}</Text>}
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
  t,
  completeAllLabel,
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
  t: BoardT;
  completeAllLabel: string;
  orders: GroupedOrder[];
  large: boolean;
  styles: BoardStyles;
  cardBackground: Record<OrderProgress, object>;
  // Setzt ALLE Portionen einer Ticket-Zeile (siehe groupItems) auf einmal.
  onToggleItem: (itemIds: string[], status: OrderItemStatus) => void;
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
  // Fertig-Zeit passiert schon vorher beim Aufbau von `orders` (stationDoneTickets/`done`).
  showFinishedAt?: boolean;
}) {
  return (
    <FlatList
      data={orders}
      keyExtractor={(order) => order.orderId}
      numColumns={columns}
      columnWrapperStyle={columns > 1 ? styles.cardRow : undefined}
      contentContainerStyle={[styles.listContent, large && styles.listContentLarge]}
      renderItem={({ item: order }) => (
        <TicketCard
          t={t}
          completeAllLabel={completeAllLabel}
          order={order}
          large={large}
          styles={styles}
          cardBackground={cardBackground}
          onToggleItem={onToggleItem}
          onCompleteOrder={onCompleteOrder}
          allowComplete={allowComplete}
          inGrid={columns > 1}
          showFinishedAt={showFinishedAt}
        />
      )}
      ListEmptyComponent={<Text style={styles.emptyText}>{emptyText}</Text>}
    />
  );
}


// Eine einzelne Ticket-Karte — aus TicketList herausgelöst, damit die Handy-Ansicht der
// Küche (PhoneKitchenBoard, SectionList statt Spalten-FlatLists) exakt dieselbe Karte mit
// demselben Abhak-/Wisch-Verhalten rendern kann.
function TicketCard({
  t,
  completeAllLabel,
  order,
  large,
  styles,
  cardBackground,
  onToggleItem,
  onCompleteOrder,
  allowComplete = false,
  inGrid = false,
  showFinishedAt = false,
}: {
  t: BoardT;
  completeAllLabel: string;
  order: GroupedOrder;
  large: boolean;
  styles: BoardStyles;
  cardBackground: Record<OrderProgress, object>;
  onToggleItem: (itemIds: string[], status: OrderItemStatus) => void;
  onCompleteOrder?: (order: GroupedOrder) => void;
  allowComplete?: boolean;
  // true im Zwei-Spalten-Kartenraster (columns > 1 in TicketList).
  inGrid?: boolean;
  showFinishedAt?: boolean;
}) {
  const finishedAtMs = showFinishedAt ? latestDoneAt(order) : 0;
  const doneCount = order.items.filter((item) => item.status === 'fertig').length;
  const itemGroups = groupItems(order.items);
  const openGroupCount = itemGroups.filter((group) => group.item.status === 'offen').length;
  const card = (
    <View style={[styles.card, large && styles.cardLarge, cardBackground[progressFor(order)]]}>
      <View style={styles.cardHeader}>
        <Text style={[styles.tableLabel, large && styles.tableLabelLarge]}>{t('table', { n: order.table.number })}</Text>
        <View style={styles.cardHeaderRight}>
          <Text style={[styles.timeLabel, large && styles.timeLabelLarge]}>
            {showFinishedAt && finishedAtMs > 0
              ? t('finishedAt', { time: formatTime(new Date(finishedAtMs).toISOString()) })
              : formatTime(order.createdAt)}
          </Text>
          {order.items.length > 1 && (
            // Fortschritt des Tickets auf einen Blick ("2/3 erledigt"), da abgehakte
            // Positionen jetzt auf dem Ticket stehen bleiben statt zu verschwinden.
            <View style={[styles.progressPill, large && styles.progressPillLarge]}>
              <Text style={[styles.progressPillText, large && styles.progressPillTextLarge]}>
                ✓ {doneCount}/{order.items.length}
              </Text>
            </View>
          )}
        </View>
      </View>
      {itemGroups.map(({ key, item, ids }) => {
      const isDone = item.status === 'fertig';
      // Menge ("3×") direkt vor dem Gerichtenamen, auch bei 1× — steht so immer an
      // derselben Stelle. Ab 2× in Akzentfarbe, damit Mehrfach-Portionen auffallen.
      // Inline statt als eigene Spalte, damit schmale Küchenkarten nicht Breite verlieren.
      const qtyPrefix = (
        <Text style={[styles.qtyText, ids.length > 1 && styles.qtyTextMulti, isDone && styles.qtyTextDone]}>
          {ids.length}×{' '}
        </Text>
      );
      return (
      // Jede Position hat rechts einen eigenen, großen Haken-Button — abgehakt wird NUR
      // über ihn, nicht mehr über die ganze Zeile, damit ein flüchtiges Antippen der
      // Karte (z.B. beim Scrollen) nicht aus Versehen die falsche Position abhakt.
      // Abgehakte Positionen bleiben auf dem Ticket stehen (grüner Haken, grau/
      // durchgestrichen); erneutes Antippen des Hakens macht das rückgängig.
      <View key={key} style={[styles.itemRow, large && styles.itemRowLarge]}>
      <View style={[styles.itemText, isDone && styles.itemTextDone]}>
        {item.menu_item.name_hanzi ? (
          <>
            <Text
              style={[styles.itemHanzi, large && styles.itemHanziLarge, item.status === 'fertig' && styles.itemDone]}
            >
              {qtyPrefix}
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
            {qtyPrefix}
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
            💬 {item.note}
          </Text>
        )}
      </View>
      <TouchableOpacity
        onPress={() => onToggleItem(ids, isDone ? 'offen' : 'fertig')}
        style={[styles.checkButton, large && styles.checkButtonLarge, isDone && styles.checkButtonDone]}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: isDone }}
        accessibilityLabel={isDone ? t('markOpen') : t('markDone')}
      >
        <Text style={[styles.checkButtonText, large && styles.checkButtonTextLarge, isDone && styles.checkButtonTextDone]}>
          ✓
        </Text>
      </TouchableOpacity>
      </View>
      );
      })}
      {allowComplete && openGroupCount > 1 && (
        // Hakt alle noch offenen Positionen des Tickets auf einmal ab — als breiter
        // Button unten auf der Karte (vorher ein kleines "×" oben rechts, das eher nach
        // Löschen/Schließen aussah als nach "alles fertig"). Nur sichtbar, wenn noch
        // mehr als eine Position offen ist — bei einer einzigen reicht ihr eigener Haken.
        <TouchableOpacity
          onPress={() => onCompleteOrder?.(order)}
          style={[styles.completeAllButton, large && styles.completeAllButtonLarge]}
          accessibilityLabel={t('markAllDone')}
        >
          <Text style={[styles.completeAllButtonText, large && styles.completeAllButtonTextLarge]}>
            {completeAllLabel}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );

  // In der Zwei-Spalten-Kartenansicht (columns=2) braucht der eigentliche Grid-
  // Slot — egal ob rohe Karte oder Swipeable-Wrapper — flex:1, sonst füllt die Karte
  // nicht die ihr per columnWrapperStyle zugewiesene Spaltenbreite aus.
  if (!allowComplete) {
    return inGrid ? <View style={styles.cardInRow}>{card}</View> : card;
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
            {t('swipeDone')}
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

  return inGrid ? <View style={styles.cardInRow}>{swipeable}</View> : swipeable;
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
    // Tischnummer ist die wichtigste Info auf dem Ticket — darf nie abgeschnitten werden;
    // bei schmalen Karten bricht stattdessen die rechte Seite (Zeit/Fortschritt) um.
    tableLabel: { fontSize: 18, fontWeight: '700', color: colors.text, flexShrink: 0 },
    tableLabelLarge: { fontSize: 28 },
    cardHeaderRight: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 6,
      flexShrink: 1,
    },
    timeLabel: { fontSize: 13, color: colors.textMuted, fontWeight: '600' },
    timeLabelLarge: { fontSize: 18 },
    // Fortschritts-Pille "✓ 2/3" im Karten-Kopf (siehe TicketList).
    progressPill: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      backgroundColor: 'rgba(0,0,0,0.08)',
    },
    progressPillLarge: { paddingHorizontal: 12, paddingVertical: 5 },
    progressPillText: { fontSize: 12, fontWeight: '800', color: colors.textSecondary },
    progressPillTextLarge: { fontSize: 17 },
    // "✓ 全部完成"-Button unten auf der Karte: hakt alle offenen Positionen auf einmal ab.
    completeAllButton: {
      marginTop: 8,
      paddingVertical: 8,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: colors.success,
      alignItems: 'center',
    },
    completeAllButtonLarge: { marginTop: 12, paddingVertical: 12, borderRadius: 12 },
    completeAllButtonText: { fontSize: 13, fontWeight: '800', color: colors.success, textAlign: 'center' },
    completeAllButtonTextLarge: { fontSize: 18 },
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
    itemRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 8,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    itemRowLarge: { paddingVertical: 14, gap: 14 },
    itemText: { flex: 1 },
    // Menge ("3×") vor dem Gerichtenamen, siehe qtyPrefix in TicketList. Erbt Schriftgröße
    // der Zeile (normal/large), ab 2× in Akzentfarbe.
    qtyText: { fontWeight: '900', color: colors.textSecondary },
    qtyTextMulti: { color: colors.accent },
    qtyTextDone: { color: colors.textFaint },
    itemTextDone: { opacity: 0.6 },
    // Haken-Button je Position: offen = leerer Kreis mit dezentem Haken als Hinweis,
    // fertig = gefüllter grüner Kreis mit weißem Haken. Groß genug für nasse/fettige Finger.
    checkButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      borderWidth: 2.5,
      borderColor: colors.success,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkButtonLarge: { width: 58, height: 58, borderRadius: 29, borderWidth: 3 },
    checkButtonDone: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
    checkButtonText: { fontSize: 20, fontWeight: '900', color: colors.borderStrong, lineHeight: 24 },
    checkButtonTextLarge: { fontSize: 30, lineHeight: 34 },
    checkButtonTextDone: { color: '#ffffff' },
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

// Handy-Variante der Board-Styles (siehe PhoneKitchenBoard): alle Basis-Styles plus
// Überschreibungen für eine einspaltige Ansicht auf ~360–430px Breite — etwas größere
// Schrift/Haken als die kompakte Tablet-Größe (eine Karte hat jetzt die volle Breite),
// schlankere Kopfzeile, Banner untereinander statt nebeneinander, Stationen-Leiste.
const createPhoneStyles = (colors: ThemeColors) => {
  const base = createStyles(colors);
  return StyleSheet.create({
    ...base,
    tab: { flex: 1, paddingVertical: 10, alignItems: 'center' },
    tabTextHanzi: { ...base.tabTextHanzi, fontSize: 17 },
    tabTextDe: { ...base.tabTextDe, fontSize: 11 },
    bellButton: { paddingHorizontal: 12, paddingVertical: 8 },
    phoneStationBar: {
      flexDirection: 'row',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    phoneStationChip: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 6,
      paddingHorizontal: 2,
      borderRadius: 10,
      backgroundColor: colors.surfaceAlt,
    },
    phoneStationChipActive: { backgroundColor: colors.accent },
    phoneStationChipLabel: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
    phoneStationChipLabelActive: { color: colors.onAccent },
    phoneStationChipCount: { fontSize: 18, fontWeight: '800', color: colors.textFaint, marginTop: 1 },
    phoneStationChipCountHot: { color: colors.accent },
    phoneStationChipCountActive: { color: colors.onAccent },
    // Fixierte Abschnitts-Überschrift in "全部" — braucht einen Hintergrund, sonst scrollen
    // die Karten sichtbar darunter durch.
    stationHeader: {
      ...base.stationHeader,
      backgroundColor: colors.background,
      paddingHorizontal: 4,
      paddingTop: 10,
      paddingBottom: 8,
    },
    stationHeaderText: { ...base.stationHeaderText, fontSize: 17 },
    stationHeaderCount: { ...base.stationHeaderCount, fontSize: 13 },
    listContent: { paddingHorizontal: 10, paddingTop: 4, paddingBottom: 32 },
    card: { ...base.card, padding: 12, marginBottom: 10 },
    swipeCompleteAction: { ...base.swipeCompleteAction, marginBottom: 10 },
    tableLabel: { ...base.tableLabel, fontSize: 22 },
    timeLabel: { ...base.timeLabel, fontSize: 14 },
    itemRow: { ...base.itemRow, paddingVertical: 10 },
    itemHanzi: { ...base.itemHanzi, fontSize: 20 },
    itemDe: { ...base.itemDe, fontSize: 14 },
    itemExtrasText: { ...base.itemExtrasText, fontSize: 15 },
    itemNote: { ...base.itemNote, fontSize: 14 },
    checkButton: { ...base.checkButton, width: 46, height: 46, borderRadius: 23 },
    checkButtonText: { ...base.checkButtonText, fontSize: 22, lineHeight: 26 },
    completeAllButton: { ...base.completeAllButton, paddingVertical: 12 },
    completeAllButtonText: { ...base.completeAllButtonText, fontSize: 15 },
    countCard: { ...base.countCard, marginBottom: 10 },
    emptyBanner: { ...base.emptyBanner, flexDirection: 'column', gap: 16, paddingHorizontal: 16 },
    emptyBannerText: { ...base.emptyBannerText, flex: 0, fontSize: 28, textAlign: 'center' },
    emptyBannerImage: { width: 200, aspectRatio: 3 / 4 },
  });
};
