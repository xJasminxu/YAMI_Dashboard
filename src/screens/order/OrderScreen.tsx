import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NavigationAction } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMenu } from '../../hooks/useMenu';
import { supabase } from '../../lib/supabase';
import type { RootStackParamList } from '../../navigation/types';
import type { MenuGroup, MenuItem, VariantOption } from '../../types/database';
import type { ThemeColors } from '../../theme/colors';
import { useThemedStyles } from '../../theme/useThemedStyles';
import { translate, useI18n, type Language } from '../../i18n/LanguageContext';
import { categoryEmoji, MENU_GROUP_EMOJIS, titleCase } from '../../lib/emoji';
import { SPICE_LABELS, SPICE_LEVELS, supportsSpiceLevel } from '../../lib/spice';

type Props = NativeStackScreenProps<RootStackParamList, 'Order'>;

// Wird als Prop an alle Dialog-Unterkomponenten weitergereicht, da deren Farben vom
// aktuellen Hell-/Dunkelmodus abhängen (siehe createStyles unten) und sie selbst nicht
// jeweils einzeln useTheme() aufrufen sollen.
type OrderStyles = ReturnType<typeof createStyles>;

// TouchableOpacity ist keine Animated-Komponente — ohne diesen Wrapper würde ein
// Animated.Value im style-Prop nicht reagieren. Wird für die "Zur Bestellung"-Pille
// gebraucht, damit Tap-Fläche und sichtbare Pille exakt dasselbe Element sind (siehe
// CartBar) statt eines unsichtbaren Overlays, das sich unabhängig vom Text bewegt hat.
const AnimatedTouchableOpacity = Animated.createAnimatedComponent(TouchableOpacity);

// Getränke/Nachspeisen gehören zur Bar und bleiben deshalb auch auf Chinesisch Deutsch.
function menuGroupLabel(group: MenuGroup, lang: Language): string {
  if (group === 'essen') return translate(lang, 'groupFood');
  return group === 'getraenke' ? 'Getränke' : 'Nachspeisen';
}

interface CartExtra {
  nameHanzi: string;
  nameDe: string;
  quantity: number;
  price: number | null;
}

interface CartLine {
  cartKey: string;
  menuItemId: string;
  itemCode: string | null;
  nameHanzi: string | null;
  nameDe: string;
  variantHanzi: string | null;
  variantDe: string | null;
  unitPrice: number | null; // Preis für eine Portion Grundgericht/-getränk (inkl. Variante, exkl. Extras)
  extras: CartExtra[];
  note: string;
  // 0 = nicht scharf, 1-3 = mild/scharf/sehr scharf (nur Hauptspeisen, siehe lib/spice.ts)
  spiceLevel: number;
  quantity: number;
}

function extrasSignature(extras: CartExtra[]) {
  return extras
    .map((e) => `${e.nameDe}x${e.quantity}`)
    .sort()
    .join('|');
}

// Schärfegrad gehört mit zum Schlüssel: "2× Ramen scharf + 1× Ramen mild" sind zwei
// Zeilen, weil die Küche sie unterschiedlich zubereitet.
function cartKeyFor(menuItemId: string, variantDe: string | null, extras: CartExtra[], spiceLevel = 0) {
  return `${menuItemId}::${variantDe ?? ''}::${extrasSignature(extras)}::${spiceLevel}`;
}

// Bearbeitbar (Variante/Extras/Beschreibung nachträglich ändern, siehe handleEditCartLine)
// ist alles, was beim Hinzufügen schon einen eigenen Dialog hatte — z.B. Ramen (Rind/Huhn +
// Ajitama-Ei/Mais/...), oder "Diverses" (Freitext + Preis). Items ohne jede Auswahl (fixer
// Preis, kein Dialog) haben nichts zu bearbeiten.
function isEditableMenuItem(item: MenuItem): boolean {
  return item.is_custom_entry || (item.variant_options?.length ?? 0) > 0 || (item.extra_options?.length ?? 0) > 0;
}

// Preis für eine Bestellzeile (eine Portion): Variantenpreis falls vorhanden, sonst
// der Item-Grundpreis, plus alle Extras mit ihrer jeweiligen Menge.
function lineUnitTotal(line: Pick<CartLine, 'unitPrice' | 'extras'>): number | null {
  const extrasSum = line.extras.reduce((sum, e) => sum + (e.price ?? 0) * e.quantity, 0);
  if (line.unitPrice === null && line.extras.every((e) => e.price === null)) return null;
  return (line.unitPrice ?? 0) + extrasSum;
}

// Feste Farben der Schärfe-Leiste (unabhängig von Hell/Dunkel): Gelb → Orange → Rot.
const SPICE_COLORS: Record<number, string> = { 1: '#F59F00', 2: '#E8590C', 3: '#C92A2A' };

function formatPrice(amount: number) {
  return `${amount.toFixed(2).replace('.', ',')} €`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

// Warenkorb-Leiste am unteren Bildschirmrand: standardmäßig eingeklappt (nur Griff +
// Summe + Senden-Button sichtbar, damit die Kategorie-Liste möglichst viel Platz hat),
// per Ziehen am Griff oder Antippen ausklappbar, um alle Positionen auf einmal zu sehen
// statt in einer winzigen internen Liste zu scrollen.
const CART_ITEMS_COLLAPSED_HEIGHT = 0;
const CART_ITEMS_EXPANDED_HEIGHT = 320;

// Preis-Anzeige für die Item-Liste: fixer Preis, "ab X€" wenn der Preis erst per
// Variante feststeht (z.B. Fried Chicken 4/8 Stück), oder nichts, falls noch kein
// Preis hinterlegt ist.
function itemPriceLabel(item: MenuItem, lang: Language): string | null {
  if (item.price !== null) return formatPrice(item.price);
  const variantPrices = (item.variant_options ?? []).map((v) => v.price).filter((p): p is number => p !== undefined);
  if (variantPrices.length > 0) return translate(lang, 'fromPrice', { price: formatPrice(Math.min(...variantPrices)) });
  return null;
}

export default function OrderScreen({ route }: Props) {
  const { lang, t } = useI18n();
  const navigation = useNavigation();
  const styles = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();
  // Grundabstand + Safe-Area-Inset (Home-Indicator auf iPhones ohne Home-Taste), sonst
  // klebt die Pille zu dicht in der unteren Ecke.
  const cartBarBottomOffset = 24 + insets.bottom;
  const { categories, loading, error } = useMenu();
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  // Vorausgefüllt, wenn über den "+"-Button einer Tischkarte in der Tischübersicht
  // aufgerufen (siehe RootStackParamList['Order'] und TableOverviewScreen.tsx) — sonst
  // leer wie bisher, Tischnummer wird dann wie gewohnt über das Numpad eingetippt.
  const [tableNumber, setTableNumber] = useState(route.params?.tableNumber ? String(route.params.tableNumber) : '');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [variantPromptItem, setVariantPromptItem] = useState<MenuItem | null>(null);
  const [optionsPromptItem, setOptionsPromptItem] = useState<MenuItem | null>(null);
  const [customEntryItem, setCustomEntryItem] = useState<MenuItem | null>(null);
  // Wenn gesetzt, bearbeitet der gerade offene Varianten-/Extras-/Diverses-Dialog eine
  // bereits im Warenkorb liegende Position (siehe handleEditCartLine/updateCartLine)
  // statt eine neue hinzuzufügen — z.B. wenn beim Ramen doch noch last-minute ein Extra
  // dazu soll, bevor die Bestellung abgeschickt ist.
  const [editingCartKey, setEditingCartKey] = useState<string | null>(null);
  const [numpadOpen, setNumpadOpen] = useState(false);
  const [noteEditLine, setNoteEditLine] = useState<CartLine | null>(null);
  const [leaveConfirmVisible, setLeaveConfirmVisible] = useState(false);
  const [cartExpanded, setCartExpanded] = useState(false);
  const cartItemsHeight = useRef(new Animated.Value(CART_ITEMS_COLLAPSED_HEIGHT)).current;
  const dragStartHeight = useRef(CART_ITEMS_COLLAPSED_HEIGHT);
  // Kurzer "Pop" auf der Warenkorb-Anzeige (Griff-Leiste + Mini-Pill in der Item-Liste),
  // sobald etwas hinzugefügt wird — vorher änderte sich nur die Zahl, was leicht zu
  // übersehen war.
  const cartBumpScale = useRef(new Animated.Value(1)).current;

  function bumpCartIndicator() {
    cartBumpScale.setValue(1);
    Animated.sequence([
      Animated.spring(cartBumpScale, { toValue: 1.25, useNativeDriver: true, speed: 40, bounciness: 5 }),
      Animated.spring(cartBumpScale, { toValue: 1, useNativeDriver: true, speed: 16, bounciness: 8 }),
    ]).start();
  }

  function animateCartTo(expand: boolean) {
    setCartExpanded(expand);
    Animated.spring(cartItemsHeight, {
      toValue: expand ? CART_ITEMS_EXPANDED_HEIGHT : CART_ITEMS_COLLAPSED_HEIGHT,
      useNativeDriver: false,
      bounciness: 4,
    }).start();
  }

  const cartPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_evt, gesture) => Math.abs(gesture.dy) > 4,
      onPanResponderGrant: () => {
        cartItemsHeight.stopAnimation((currentHeight) => {
          dragStartHeight.current = currentHeight;
        });
      },
      onPanResponderMove: (_evt, gesture) => {
        // Nach oben ziehen (negatives dy) vergrößert die Höhe der Positionsliste.
        const next = clamp(
          dragStartHeight.current - gesture.dy,
          CART_ITEMS_COLLAPSED_HEIGHT,
          CART_ITEMS_EXPANDED_HEIGHT
        );
        cartItemsHeight.setValue(next);
      },
      onPanResponderRelease: (_evt, gesture) => {
        const endHeight = clamp(
          dragStartHeight.current - gesture.dy,
          CART_ITEMS_COLLAPSED_HEIGHT,
          CART_ITEMS_EXPANDED_HEIGHT
        );
        const midpoint = (CART_ITEMS_COLLAPSED_HEIGHT + CART_ITEMS_EXPANDED_HEIGHT) / 2;
        animateCartTo(endHeight > midpoint);
      },
    })
  ).current;

  // Eine Bestellung gilt als "in Aufnahme", sobald Positionen im Warenkorb liegen
  // oder eine Tischnummer gewählt wurde — beides ginge beim Verlassen der Seite
  // sonst kommentarlos verloren. Ref statt state im Listener, damit der
  // beforeRemove-Handler unten nicht bei jeder Änderung neu registriert werden muss.
  const orderInProgressRef = useRef(false);
  orderInProgressRef.current = cart.length > 0 || tableNumber.length > 0;
  const pendingLeaveAction = useRef<NavigationAction | null>(null);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (!orderInProgressRef.current) return;
      e.preventDefault();
      pendingLeaveAction.current = e.data.action;
      setLeaveConfirmVisible(true);
    });
    return unsubscribe;
  }, [navigation]);

  function confirmLeave() {
    setLeaveConfirmVisible(false);
    const action = pendingLeaveAction.current;
    pendingLeaveAction.current = null;
    if (action) navigation.dispatch(action);
  }

  function cancelLeave() {
    setLeaveConfirmVisible(false);
    pendingLeaveAction.current = null;
  }

  // Der native-stack-Header rendert den "← Hauptmenü"-Zurück-Button plattformseitig
  // (UIKit/Android) und startet bei Antippen sofort die native Pop-Animation, bevor
  // JS eingreifen kann — der beforeRemove-Handler oben würde die Navigation zwar noch
  // stoppen, aber sichtbar mit einem kurzen Ruckler. Mit einem eigenen JS-Button, der
  // navigation.goBack() aufruft, läuft der beforeRemove-Check zuerst und der Dialog
  // öffnet sich ohne jegliche Übergangsanimation — "sofort" im eigentlichen Sinn.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.headerBackButton}
        >
          <Text style={styles.headerBackButtonText}>{t('backToHome')}</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation, t]);

  const groupedCategories = useMemo(() => {
    const groups: Record<MenuGroup, typeof categories> = { essen: [], getraenke: [], nachspeisen: [] };
    for (const category of categories) {
      // Rabatt ist kein Menü-Button — wird seit Kurzem in Tischübersicht/Abrechnung direkt auf
      // den Tisch gebucht (components/DiscountDialog.tsx), nicht mehr hier. Nicht Teil
      // des Essen/Getränke/Nachspeisen-Rasters.
      if (category.is_discount) continue;
      groups[category.menu_group].push(category);
    }
    return groups;
  }, [categories]);

  // Nachschlagen des vollen MenuItem (inkl. variant_options/extra_options) zu einer
  // Warenkorb-Zeile — die Zeile selbst kennt nur menuItemId, für den Bearbeiten-Dialog
  // (handleEditCartLine) wird aber die Options-Definition des Items gebraucht.
  const menuItemsById = useMemo(() => {
    const map = new Map<string, MenuItem>();
    for (const category of categories) {
      for (const item of category.items) map.set(item.id, item);
    }
    return map;
  }, [categories]);

  // Gerichte, bei denen in der Bestellübersicht ein Schärfegrad einstellbar ist (Hauptspeisen).
  const spiceableItemIds = useMemo(() => {
    const ids = new Set<string>();
    for (const category of categories) {
      for (const item of category.items) if (supportsSpiceLevel(item, category)) ids.add(item.id);
    }
    return ids;
  }, [categories]);

  // Die gerade zum Bearbeiten geöffnete Warenkorb-Zeile (siehe editingCartKey) — liefert
  // die aktuelle Variante/Extras/Beschreibung, mit der die Dialoge unten vorausgefüllt
  // werden, statt leer zu starten.
  const editingLine = useMemo(
    () => (editingCartKey ? cart.find((l) => l.cartKey === editingCartKey) ?? null : null),
    [cart, editingCartKey]
  );

  const activeCategory = categories.find((c) => c.id === activeCategoryId) ?? null;
  const cartCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const cartTotal = cart.reduce((sum, line) => sum + (lineUnitTotal(line) ?? 0) * line.quantity, 0);
  const cartHasUnpricedItem = cart.some((line) => lineUnitTotal(line) === null);

  function addToCart(item: MenuItem, variant: VariantOption | null, extras: CartExtra[] = []) {
    const cartKey = cartKeyFor(item.id, variant?.name_de ?? null, extras);
    const unitPrice = variant?.price ?? item.price ?? null;
    bumpCartIndicator();
    setCart((prev) => {
      const existing = prev.find((line) => line.cartKey === cartKey);
      if (existing) {
        return prev.map((line) => (line.cartKey === cartKey ? { ...line, quantity: line.quantity + 1 } : line));
      }
      return [
        ...prev,
        {
          cartKey,
          menuItemId: item.id,
          itemCode: item.item_code,
          nameHanzi: item.name_hanzi,
          nameDe: item.name_de,
          variantHanzi: variant?.name_hanzi ?? null,
          variantDe: variant?.name_de ?? null,
          unitPrice,
          extras,
          note: '',
          spiceLevel: 0,
          quantity: 1,
        },
      ];
    });
  }

  // Schreibt eine neue Varianten-/Extras-Auswahl auf eine bereits im Warenkorb liegende
  // Zeile (siehe editingCartKey/handleEditCartLine), statt eine neue Zeile anzuhängen wie
  // addToCart. cartKey hängt von Variante+Extras ab, ändert sich beim Bearbeiten also meist
  // mit — trifft die neue Kombination zufällig eine bereits existierende andere Zeile
  // (z.B. Extras nachträglich auf "keine" reduziert, sodass sie einer bestehenden Zeile
  // ohne Extras entspricht), werden die Mengen zusammengeführt statt zwei Zeilen mit
  // demselben cartKey zu erzeugen (bricht sonst FlatList-Keys und die Warenkorb-Summe).
  function updateCartLine(cartKey: string, item: MenuItem, variant: VariantOption | null, extras: CartExtra[]) {
    setCart((prev) => {
      const line = prev.find((l) => l.cartKey === cartKey);
      if (!line) return prev;

      const unitPrice = variant?.price ?? item.price ?? null;
      const newCartKey = cartKeyFor(item.id, variant?.name_de ?? null, extras, line.spiceLevel);

      if (newCartKey === cartKey) {
        return prev.map((l) =>
          l.cartKey === cartKey
            ? { ...l, variantHanzi: variant?.name_hanzi ?? null, variantDe: variant?.name_de ?? null, unitPrice, extras }
            : l
        );
      }

      const collision = prev.find((l) => l.cartKey === newCartKey);
      if (collision) {
        return prev
          .filter((l) => l.cartKey !== cartKey)
          .map((l) => (l.cartKey === newCartKey ? { ...l, quantity: l.quantity + line.quantity } : l));
      }

      return prev.map((l) =>
        l.cartKey === cartKey
          ? { ...l, cartKey: newCartKey, variantHanzi: variant?.name_hanzi ?? null, variantDe: variant?.name_de ?? null, unitPrice, extras }
          : l
      );
    });
  }

  // Wie updateCartLine: der neue Schärfegrad ändert den cartKey — trifft er dabei eine
  // bereits existierende Zeile (gleiches Gericht mit diesem Schärfegrad), werden die
  // Mengen zusammengeführt.
  function setSpiceLevel(cartKey: string, spiceLevel: number) {
    setCart((prev) => {
      const line = prev.find((l) => l.cartKey === cartKey);
      if (!line || line.spiceLevel === spiceLevel) return prev;
      const newCartKey = cartKeyFor(line.menuItemId, line.variantDe, line.extras, spiceLevel);
      const collision = prev.find((l) => l.cartKey === newCartKey);
      if (collision) {
        return prev
          .filter((l) => l.cartKey !== cartKey)
          .map((l) => (l.cartKey === newCartKey ? { ...l, quantity: l.quantity + line.quantity } : l));
      }
      return prev.map((l) => (l.cartKey === cartKey ? { ...l, cartKey: newCartKey, spiceLevel } : l));
    });
  }

  function updateNote(cartKey: string, note: string) {
    setCart((prev) => prev.map((line) => (line.cartKey === cartKey ? { ...line, note } : line)));
  }

  function confirmNote(note: string) {
    if (!noteEditLine) return;
    updateNote(noteEditLine.cartKey, note);
    setNoteEditLine(null);
  }

  function cancelNote() {
    setNoteEditLine(null);
  }

  function handleItemPress(item: MenuItem) {
    if (item.is_custom_entry) {
      setCustomEntryItem(item);
    } else if (item.extra_options && item.extra_options.length > 0) {
      setOptionsPromptItem(item);
    } else if (item.variant_options && item.variant_options.length > 0) {
      setVariantPromptItem(item);
    } else {
      addToCart(item, null);
    }
  }

  // Öffnet denselben Dialog, den das Item beim ursprünglichen Hinzufügen gezeigt hätte,
  // aber im Bearbeiten-Modus (editingCartKey) — z.B. wenn ein Gast beim schon im Warenkorb
  // liegenden Ramen doch noch last-minute ein Extra möchte, bevor die Bestellung
  // abgeschickt ist. Der Dialog selbst startet dank editingLine (siehe oben) mit der
  // aktuellen Auswahl der Zeile vorausgefüllt statt leer.
  function handleEditCartLine(line: CartLine) {
    const item = menuItemsById.get(line.menuItemId);
    if (!item || !isEditableMenuItem(item)) return;
    setEditingCartKey(line.cartKey);
    if (item.is_custom_entry) {
      setCustomEntryItem(item);
    } else if (item.extra_options && item.extra_options.length > 0) {
      setOptionsPromptItem(item);
    } else if (item.variant_options && item.variant_options.length > 0) {
      setVariantPromptItem(item);
    }
  }

  function chooseVariant(variant: VariantOption) {
    if (!variantPromptItem) return;
    if (editingCartKey) {
      updateCartLine(editingCartKey, variantPromptItem, variant, []);
      setEditingCartKey(null);
    } else {
      addToCart(variantPromptItem, variant);
    }
    setVariantPromptItem(null);
  }

  function confirmCustomEntry(description: string, price: number | null) {
    if (!customEntryItem) return;
    // Freitext-Beschreibung + Preis fahren huckepack auf dem Varianten-Mechanismus mit
    // (siehe addToCart) statt eines eigenen Datenpfads — Preis-Summierung, Warenkorb-
    // Anzeige und order_items-Insert funktionieren dadurch ohne Sonderfall.
    const variant = { name_hanzi: description, name_de: description, price: price ?? undefined };
    if (editingCartKey) {
      updateCartLine(editingCartKey, customEntryItem, variant, []);
      setEditingCartKey(null);
    } else {
      addToCart(customEntryItem, variant);
    }
    setCustomEntryItem(null);
  }

  function confirmOptions(variant: VariantOption | null, extras: CartExtra[]) {
    if (!optionsPromptItem) return;
    const filteredExtras = extras.filter((e) => e.quantity > 0);
    if (editingCartKey) {
      updateCartLine(editingCartKey, optionsPromptItem, variant, filteredExtras);
      setEditingCartKey(null);
    } else {
      addToCart(optionsPromptItem, variant, filteredExtras);
    }
    setOptionsPromptItem(null);
  }

  function removeFromCart(cartKey: string) {
    setCart((prev) =>
      prev
        .map((line) => (line.cartKey === cartKey ? { ...line, quantity: line.quantity - 1 } : line))
        .filter((line) => line.quantity > 0)
    );
  }

  async function submitOrder() {
    const number = parseInt(tableNumber, 10);
    if (!number || cart.length === 0) return;

    setSubmitting(true);
    setSubmitError(null);

    const { data: table, error: tableError } = await supabase
      .from('tables')
      .upsert({ number }, { onConflict: 'number' })
      .select()
      .single();

    if (tableError || !table) {
      setSubmitError(tableError?.message ?? t('tableCreateError'));
      setSubmitting(false);
      return;
    }

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({ table_id: table.id })
      .select()
      .single();

    if (orderError || !order) {
      setSubmitError(orderError?.message ?? t('orderCreateError'));
      setSubmitting(false);
      return;
    }

    const rows = cart.flatMap((line) => {
      return Array.from({ length: line.quantity }, () => ({
        order_id: order.id,
        menu_item_id: line.menuItemId,
        variant_hanzi: line.variantHanzi,
        variant_de: line.variantDe,
        extras:
          line.extras.length > 0
            ? line.extras.map((e) => ({ name_hanzi: e.nameHanzi, name_de: e.nameDe, quantity: e.quantity, price: e.price }))
            : null,
        unit_price: line.unitPrice,
        note: line.note.trim() ? line.note.trim() : null,
        spice_level: line.spiceLevel > 0 ? line.spiceLevel : null,
      }));
    });

    const { error: itemsError } = await supabase.from('order_items').insert(rows);

    if (itemsError) {
      setSubmitError(itemsError.message);
      setSubmitting(false);
      return;
    }

    setCart([]);
    setTableNumber('');
    setActiveCategoryId(null);
    setSubmitting(false);
  }

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
        <Text style={styles.errorText}>{t('menuLoadError', { error })}</Text>
      </View>
    );
  }

  // Alle Dialoge (unten im JSX) werden unabhängig davon gerendert, ob gerade die
  // Kategorie-Übersicht oder eine Item-Liste angezeigt wird — vorher hingen sie in den
  // jeweils anderen der beiden früher getrennten return-Zweige und blieben unsichtbar,
  // wenn z.B. ein "Diverses"-Dialog aus dem falschen Zweig heraus geöffnet wurde (er kam
  // erst zum Vorschein, sobald man in den Zweig mit dem Dialog zurücknavigierte).
  return (
    <View style={styles.container}>
      {/* Zentrierte Inhaltsspalte mit maximaler Breite — auf dem iPad/im Querformat
          klebte sonst alles am linken Rand und die Kategorie-Buttons zogen sich über
          die ganze Bildschirmbreite. */}
      <View style={styles.content}>
      {activeCategory ? (
        <>
          <TouchableOpacity onPress={() => setActiveCategoryId(null)} style={styles.backButton}>
            <Text style={styles.backButtonText}>{t('backToCategories')}</Text>
          </TouchableOpacity>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionEmoji}>
              {categoryEmoji(activeCategory.name_de, activeCategory.menu_group)}
            </Text>
            <View>
              <Text style={styles.sectionTitle}>{titleCase(activeCategory.name_de)}</Text>
              {activeCategory.name_hanzi && <Text style={styles.sectionHanzi}>{activeCategory.name_hanzi}</Text>}
            </View>
          </View>
          <FlatList
            data={activeCategory.items}
            keyExtractor={(item) => item.id}
            // Die schwebende "Zur Bestellung"-Pille (CartBar) liegt absolut positioniert
            // über der Liste — ohne diesen Puffer verdeckt sie die letzten Einträge einer
            // langen Kategorie (z.B. "Alkoholfreie Getränke").
            contentContainerStyle={{ paddingBottom: cartBarBottomOffset + 80, gap: 8 }}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.itemRow} onPress={() => handleItemPress(item)} activeOpacity={0.7}>
                {item.item_code && (
                  <View style={styles.itemCodeBadge}>
                    <Text style={styles.itemCodeText}>{item.item_code}</Text>
                  </View>
                )}
                <View style={styles.itemRowText}>
                  {item.name_hanzi ? (
                    <>
                      <Text style={styles.itemHanzi}>{item.name_hanzi}</Text>
                      <Text style={styles.itemDe}>{item.name_de}</Text>
                    </>
                  ) : (
                    // Getränke/Nachspeisen haben kein Hanzi (an der Bar wird auf Deutsch
                    // gearbeitet) — dann den deutschen Namen groß/prominent zeigen statt
                    // einer leeren Hanzi-Zeile über einem winzigen deutschen Namen.
                    <Text style={styles.itemHanzi}>{item.name_de}</Text>
                  )}
                </View>
                {itemPriceLabel(item, lang) && (
                  <View style={styles.itemPricePill}>
                    <Text style={styles.itemPrice}>{itemPriceLabel(item, lang)}</Text>
                  </View>
                )}
                <Text style={styles.itemAdd}>＋</Text>
              </TouchableOpacity>
            )}
          />
          <CartBar
            cartCount={cartCount}
            onPress={() => setActiveCategoryId(null)}
            styles={styles}
            bumpScale={cartBumpScale}
            bottomOffset={cartBarBottomOffset}
          />
        </>
      ) : (
        <>
          <TouchableOpacity
            style={[styles.tableInput, !!tableNumber && styles.tableInputFilled]}
            onPress={() => setNumpadOpen(true)}
            activeOpacity={0.8}
          >
            <Text style={styles.tableInputEmoji}>🪑</Text>
            <Text style={tableNumber ? styles.tableInputValueLarge : styles.tableInputPlaceholder}>
              {tableNumber ? t('table', { n: tableNumber }) : t('enterTableNumber')}
            </Text>
          </TouchableOpacity>
          <NumpadDialog
            visible={numpadOpen}
            value={tableNumber}
            onChange={setTableNumber}
            onDone={() => setNumpadOpen(false)}
            styles={styles}
          />

          <FlatList
            data={(Object.keys(groupedCategories) as MenuGroup[]).filter((g) => groupedCategories[g].length > 0)}
            keyExtractor={(group) => group}
            contentContainerStyle={styles.categoryListContent}
            renderItem={({ item: group }) => (
              <View style={styles.groupSection}>
                <Text style={styles.groupTitle}>
                  {MENU_GROUP_EMOJIS[group]} {menuGroupLabel(group, lang)}
                </Text>
                <View style={styles.categoryGrid}>
                  {groupedCategories[group].map((category) => {
                    // Kategorien mit einem "Diverses"-Item (siehe seed.sql) verhalten sich wie
                    // ein eigener Button: direkt den Freitext-Dialog öffnen statt erst in eine
                    // Item-Liste zu navigieren. find() statt einer strikten
                    // "genau 1 Item"-Prüfung, damit das auch robust bleibt, falls durch alte/
                    // doppelte Seed-Daten mal ein zweiter Eintrag in der Kategorie landet — sonst
                    // fällt der Button auf setActiveCategoryId zurück und der Diverses-Dialog
                    // (der nur im Kategorie-Übersicht-Zweig lag) blieb bis zum letzten Refactor
                    // unsichtbar, bis man "← Kategorien" antippte.
                    const soleCustomItem = category.items.find((i) => i.is_custom_entry) ?? null;
                    return (
                      <TouchableOpacity
                        key={category.id}
                        style={styles.categoryButton}
                        activeOpacity={0.75}
                        onPress={() =>
                          soleCustomItem ? setCustomEntryItem(soleCustomItem) : setActiveCategoryId(category.id)
                        }
                      >
                        <Text style={styles.categoryEmoji}>{categoryEmoji(category.name_de, category.menu_group)}</Text>
                        {category.name_hanzi ? (
                          <>
                            <Text style={styles.categoryHanzi}>{category.name_hanzi}</Text>
                            <Text style={styles.categoryDe}>{titleCase(category.name_de)}</Text>
                          </>
                        ) : (
                          // Bar-Kategorien (Getränke/Nachspeisen) haben kein Hanzi — deutschen
                          // Namen dann groß/prominent zeigen statt einer leeren Hanzi-Zeile.
                          <Text style={styles.categoryHanzi}>{titleCase(category.name_de)}</Text>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}
          />

          {cart.length > 0 && (
            <View style={styles.cartPanel}>
              <TouchableOpacity
                style={styles.cartHandle}
                onPress={() => animateCartTo(!cartExpanded)}
                activeOpacity={0.7}
                {...cartPanResponder.panHandlers}
              >
                <View style={styles.cartHandleBar} />
                <Animated.Text style={[styles.cartHandleText, { transform: [{ scale: cartBumpScale }] }]}>
                  {t('cartSummary', { n: cartCount, sum: formatPrice(cartTotal) })} {cartExpanded ? '▾' : '▴'}
                </Animated.Text>
              </TouchableOpacity>
              <Animated.View style={[styles.cartItemsWrap, { height: cartItemsHeight }]}>
                <FlatList
                  style={styles.cartItemsList}
                  data={cart}
                  keyExtractor={(line) => line.cartKey}
                  renderItem={({ item: line }) => {
                    const menuItem = menuItemsById.get(line.menuItemId);
                    const editable = menuItem ? isEditableMenuItem(menuItem) : false;
                    return (
                      <View style={styles.cartLine}>
                        <View style={styles.cartLineTextWrap}>
                          <Text style={styles.cartLineText}>
                            {line.quantity}× {line.itemCode ? `${line.itemCode} · ` : ''}
                            {line.nameHanzi} ({line.nameDe})
                            {line.variantDe ? ` · ${line.variantHanzi} (${line.variantDe})` : ''}
                          </Text>
                          {line.extras.length > 0 && (
                            <Text style={styles.cartLineExtras}>
                              {line.extras.map((e) => `+${e.quantity} ${e.nameHanzi} (${e.nameDe})`).join(', ')}
                            </Text>
                          )}
                          {lineUnitTotal(line) !== null && (
                            <Text style={styles.cartLinePrice}>
                              {formatPrice(lineUnitTotal(line)! * line.quantity)}
                            </Text>
                          )}
                          {spiceableItemIds.has(line.menuItemId) && (
                            // Schärfe-Leiste: Segmente bis zum gewählten Grad sind gefüllt.
                            // Antippen des bereits gewählten Grads setzt zurück auf nicht scharf.
                            <View style={styles.spiceBarRow}>
                              <Text style={styles.spiceBarIcon}>🌶️</Text>
                              <View style={styles.spiceBar}>
                                {SPICE_LEVELS.map((level) => {
                                  const filled = level <= line.spiceLevel;
                                  return (
                                    <TouchableOpacity
                                      key={level}
                                      style={[
                                        styles.spiceSegment,
                                        level > 1 && styles.spiceSegmentDivider,
                                        filled && { backgroundColor: SPICE_COLORS[level] },
                                      ]}
                                      onPress={() => setSpiceLevel(line.cartKey, line.spiceLevel === level ? 0 : level)}
                                      accessibilityRole="adjustable"
                                      accessibilityState={{ selected: line.spiceLevel === level }}
                                      accessibilityLabel={SPICE_LABELS[level][lang]}
                                    >
                                      <Text style={[styles.spiceSegmentText, filled && styles.spiceSegmentTextFilled]}>
                                        {SPICE_LABELS[level][lang]}
                                      </Text>
                                    </TouchableOpacity>
                                  );
                                })}
                              </View>
                            </View>
                          )}
                          <TouchableOpacity style={styles.noteField} onPress={() => setNoteEditLine(line)}>
                            <Text
                              style={line.note ? styles.noteFieldText : styles.noteFieldPlaceholder}
                              numberOfLines={2}
                            >
                              {line.note ? `💬 ${line.note}` : t('notePlaceholder')}
                            </Text>
                          </TouchableOpacity>
                        </View>
                        {editable && (
                          <TouchableOpacity
                            onPress={() => handleEditCartLine(line)}
                            style={styles.cartLineEditButton}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Text style={styles.cartLineEditButtonText}>✏️</Text>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity onPress={() => removeFromCart(line.cartKey)}>
                          <Text style={styles.removeText}>−</Text>
                        </TouchableOpacity>
                      </View>
                    );
                  }}
                />
              </Animated.View>
              {submitError && <Text style={styles.errorText}>{submitError}</Text>}
              <View style={styles.cartTotalRow}>
                <Text style={styles.cartTotalLabel}>
                  {t('sum')}
                  {cartHasUnpricedItem ? t('sumIncomplete') : ''}
                </Text>
                <Text style={styles.cartTotalValue}>{formatPrice(cartTotal)}</Text>
              </View>
              {cartHasUnpricedItem && (
                <Text style={styles.cartTotalNote}>{t('unpricedNote')}</Text>
              )}
              <TouchableOpacity
                style={[styles.submitButton, (!tableNumber || submitting) && styles.submitButtonDisabled]}
                onPress={submitOrder}
                disabled={!tableNumber || submitting}
              >
                <Text style={styles.submitButtonText}>
                  {submitting ? t('sending') : !tableNumber ? t('chooseTableFirst') : t('sendOrder', { n: cartCount })}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </>
      )}
      </View>
      <VariantDialog
        item={variantPromptItem}
        onChoose={chooseVariant}
        onCancel={() => {
          setVariantPromptItem(null);
          setEditingCartKey(null);
        }}
        styles={styles}
      />
      <ItemOptionsDialog
        item={optionsPromptItem}
        initialVariantDe={editingLine?.variantDe ?? null}
        initialExtras={editingLine?.extras ?? []}
        editing={editingCartKey !== null}
        onConfirm={confirmOptions}
        onCancel={() => {
          setOptionsPromptItem(null);
          setEditingCartKey(null);
        }}
        styles={styles}
      />
      <CustomEntryDialog
        item={customEntryItem}
        initialDescription={editingCartKey ? editingLine?.variantDe ?? '' : ''}
        initialPrice={editingCartKey ? editingLine?.unitPrice ?? null : null}
        editing={editingCartKey !== null}
        onConfirm={confirmCustomEntry}
        onCancel={() => {
          setCustomEntryItem(null);
          setEditingCartKey(null);
        }}
        styles={styles}
      />
      <NoteDialog line={noteEditLine} onConfirm={confirmNote} onCancel={cancelNote} styles={styles} />
      <LeaveConfirmDialog
        visible={leaveConfirmVisible}
        onConfirm={confirmLeave}
        onCancel={cancelLeave}
        styles={styles}
      />
    </View>
  );
}

// Großer Touch-Numpad für die Tischnummer, statt der nativen Tastatur — auf
// einem an den Tisch montierten Gerät zuverlässiger/schneller zu bedienen und
// verhält sich auf allen Plattformen (inkl. Web) gleich.
const NUMPAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'] as const;
const MAX_TABLE_NUMBER_LENGTH = 3; // höchste Tischnummer aktuell: 204

function NumpadDialog({
  visible,
  value,
  onChange,
  onDone,
  styles,
}: {
  visible: boolean;
  value: string;
  onChange: (value: string) => void;
  onDone: () => void;
  styles: OrderStyles;
}) {
  const { t } = useI18n();
  // onChange schreibt bei jedem Tastendruck direkt in die Tischnummer des Eltern-Screens
  // (für die Live-Anzeige hinter dem Dialog), "Abbrechen" muss also den Stand von vor dem
  // Öffnen separat merken, um ihn zurückzuschreiben, statt nur den Dialog zu schließen.
  const [snapshot, setSnapshot] = useState(value);
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setSnapshot(value);
  }

  function press(key: (typeof NUMPAD_KEYS)[number]) {
    if (key === 'clear') {
      onChange('');
    } else if (key === 'back') {
      onChange(value.slice(0, -1));
    } else if (value.length < MAX_TABLE_NUMBER_LENGTH) {
      onChange(value + key);
    }
  }

  function handleCancel() {
    onChange(snapshot);
    onDone();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{t('tableNumberTitle')}</Text>
          <Text style={styles.numpadDisplay}>{value || '—'}</Text>
          <View style={styles.numpadGrid}>
            {NUMPAD_KEYS.map((key) => (
              <TouchableOpacity key={key} style={styles.numpadKey} onPress={() => press(key)}>
                <Text style={styles.numpadKeyText}>{key === 'clear' ? 'C' : key === 'back' ? '⌫' : key}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            style={[styles.submitButton, !value && styles.submitButtonDisabled]}
            onPress={onDone}
            disabled={!value}
          >
            <Text style={styles.submitButtonText}>{t('done')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.modalCancel} onPress={handleCancel}>
            <Text style={styles.modalCancelText}>{t('cancel')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// Warnt vor Verlassen der Bestellaufnahme (Hauptmenü-Button im Header, Zurück-Geste, etc.),
// solange Warenkorb oder Tischnummer noch nicht abgeschickt sind — sonst geht die
// aufgenommene Bestellung kommentarlos verloren.
function LeaveConfirmDialog({
  visible,
  onConfirm,
  onCancel,
  styles,
}: {
  visible: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  styles: OrderStyles;
}) {
  const { t } = useI18n();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalEmoji}>⚠️</Text>
          <Text style={styles.modalTitle}>{t('discardTitle')}</Text>
          <Text style={styles.modalSubtitle}>
            {t('discardBody')}
          </Text>
          <TouchableOpacity style={styles.leaveConfirmButton} onPress={onConfirm}>
            <Text style={styles.submitButtonText}>{t('discardConfirm')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.modalCancel} onPress={onCancel}>
            <Text style={styles.leaveConfirmCancelText}>{t('backToOrder')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function CartBar({
  cartCount,
  onPress,
  styles,
  bumpScale,
  bottomOffset,
}: {
  cartCount: number;
  onPress: () => void;
  styles: OrderStyles;
  bumpScale: Animated.Value;
  bottomOffset: number;
}) {
  const { t } = useI18n();
  if (cartCount === 0) return null;
  return (
    <AnimatedTouchableOpacity
      style={[styles.cartBarMini, { bottom: bottomOffset, transform: [{ scale: bumpScale }] }]}
      onPress={onPress}
    >
      <Text style={styles.cartBarMiniText}>{t('cartToOrder', { n: cartCount })}</Text>
    </AnimatedTouchableOpacity>
  );
}

function VariantDialog({
  item,
  onChoose,
  onCancel,
  styles,
}: {
  item: MenuItem | null;
  onChoose: (variant: VariantOption) => void;
  onCancel: () => void;
  styles: OrderStyles;
}) {
  const { t } = useI18n();
  return (
    <Modal visible={item !== null} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{item?.name_hanzi}</Text>
          <Text style={styles.modalSubtitle}>{item?.name_de}</Text>
          {item?.variant_options?.map((variant) => (
            <TouchableOpacity
              key={variant.name_de}
              style={styles.variantOption}
              onPress={() => onChoose(variant)}
            >
              <Text style={styles.variantOptionHanzi}>{variant.name_hanzi}</Text>
              <Text style={styles.variantOptionDe}>
                {variant.name_de}
                {variant.price !== undefined ? ` — ${formatPrice(variant.price)}` : ''}
              </Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.modalCancel} onPress={onCancel}>
            <Text style={styles.modalCancelText}>{t('cancel')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// Dialog für "Diverses"-Items (menu_items.is_custom_entry): Bedienung trägt Beschreibung
// + Preis frei ein, statt aus einer festen Speisekarten-Position zu wählen. Auch für das
// Bearbeiten einer bereits im Warenkorb liegenden Diverses-Zeile wiederverwendet (siehe
// editing/initialDescription/initialPrice in OrderScreen), dann mit dem aktuellen Stand
// vorausgefüllt statt leer zu starten.
function CustomEntryDialog({
  item,
  initialDescription = '',
  initialPrice = null,
  editing = false,
  onConfirm,
  onCancel,
  styles,
}: {
  item: MenuItem | null;
  initialDescription?: string;
  initialPrice?: number | null;
  editing?: boolean;
  onConfirm: (description: string, price: number | null) => void;
  onCancel: () => void;
  styles: OrderStyles;
}) {
  const { t } = useI18n();
  const [description, setDescription] = useState('');
  const [priceText, setPriceText] = useState('');
  const [priceNumpadOpen, setPriceNumpadOpen] = useState(false);

  // Bei jedem neu geöffneten Item die lokale Eingabe zurücksetzen — auf initialDescription/
  // initialPrice beim Bearbeiten, sonst leer (siehe Kommentar oben).
  const itemId = item?.id ?? null;
  const [resetForItemId, setResetForItemId] = useState<string | null>(null);
  if (itemId !== resetForItemId) {
    setResetForItemId(itemId);
    setDescription(initialDescription);
    setPriceText(initialPrice !== null ? String(initialPrice).replace('.', ',') : '');
    setPriceNumpadOpen(false);
  }

  if (!item) return null;

  const trimmedDescription = description.trim();
  const canConfirm = trimmedDescription.length > 0;

  function handleConfirm() {
    const normalized = priceText.trim().replace(',', '.');
    const parsed = normalized ? Number.parseFloat(normalized) : NaN;
    onConfirm(trimmedDescription, Number.isFinite(parsed) ? parsed : null);
  }

  return (
    <Modal visible={item !== null} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{item.name_hanzi}</Text>
          <Text style={styles.modalSubtitle}>{item.name_de}</Text>
          <TextInput
            style={styles.customEntryInput}
            placeholder={t('description')}
            value={description}
            onChangeText={setDescription}
            autoFocus
          />
          <TouchableOpacity style={styles.customEntryInput} onPress={() => setPriceNumpadOpen(true)}>
            <Text style={priceText ? styles.tableInputValue : styles.tableInputPlaceholder}>
              {priceText ? `${priceText} €` : t('enterPrice')}
            </Text>
          </TouchableOpacity>
          <PriceNumpadDialog
            visible={priceNumpadOpen}
            value={priceText}
            onChange={setPriceText}
            onDone={() => setPriceNumpadOpen(false)}
            styles={styles}
          />
          <TouchableOpacity
            style={[styles.submitButton, !canConfirm && styles.submitButtonDisabled]}
            onPress={handleConfirm}
            disabled={!canConfirm}
          >
            <Text style={styles.submitButtonText}>
              {editing ? t('applyChanges') : t('addToCart')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.modalCancel} onPress={onCancel}>
            <Text style={styles.modalCancelText}>{t('cancel')}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// Eigener Dialog statt Inline-TextInput im Warenkorb: das Notizfeld saß bisher unten in
// der (ohnehin schon eingeklappten) Warenkorb-Leiste, wo die Tastatur beim Tippen den
// Eingabefokus verdeckte. Als KeyboardAvoidingView-Dialog bleibt das Feld immer sichtbar.
function NoteDialog({
  line,
  onConfirm,
  onCancel,
  styles,
}: {
  line: CartLine | null;
  onConfirm: (note: string) => void;
  onCancel: () => void;
  styles: OrderStyles;
}) {
  const { t } = useI18n();
  const [text, setText] = useState('');

  // Bei jeder neu geöffneten Warenkorb-Zeile die lokale Eingabe auf deren aktuellen
  // Notiz-Text zurücksetzen (gleiches Muster wie bei CustomEntryDialog/ItemOptionsDialog).
  const lineKey = line?.cartKey ?? null;
  const [resetForKey, setResetForKey] = useState<string | null>(null);
  if (lineKey !== resetForKey) {
    setResetForKey(lineKey);
    setText(line?.note ?? '');
  }

  if (!line) return null;

  return (
    <Modal visible={line !== null} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{t('noteTitle')}</Text>
          <Text style={styles.modalSubtitle}>
            {line.nameHanzi} ({line.nameDe})
          </Text>
          <TextInput
            style={[styles.customEntryInput, styles.noteDialogInput]}
            placeholder={t('noteExample')}
            value={text}
            onChangeText={setText}
            multiline
            autoFocus
          />
          <TouchableOpacity style={styles.submitButton} onPress={() => onConfirm(text.trim())}>
            <Text style={styles.submitButtonText}>{t('apply')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.modalCancel} onPress={onCancel}>
            <Text style={styles.modalCancelText}>{t('cancel')}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// Numpad für die Preiseingabe im Diverses-Dialog: Ziffern + Komma, kein natives
// Tastatur-Overlay nötig (siehe NumpadDialog oben für dieselbe Idee bei Tischnummern).
const PRICE_NUMPAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'back'] as const;
const MAX_PRICE_LENGTH = 7; // z.B. "9999,99"

function PriceNumpadDialog({
  visible,
  value,
  onChange,
  onDone,
  styles,
}: {
  visible: boolean;
  value: string;
  onChange: (value: string) => void;
  onDone: () => void;
  styles: OrderStyles;
}) {
  const { t } = useI18n();
  function press(key: (typeof PRICE_NUMPAD_KEYS)[number]) {
    if (key === 'back') {
      onChange(value.slice(0, -1));
    } else if (key === ',') {
      if (value.length > 0 && !value.includes(',')) onChange(value + ',');
    } else if (value.length < MAX_PRICE_LENGTH) {
      onChange(value + key);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDone}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{t('priceTitle')}</Text>
          <Text style={styles.numpadDisplay}>{value ? `${value} €` : '—'}</Text>
          <View style={styles.numpadGrid}>
            {PRICE_NUMPAD_KEYS.map((key) => (
              <TouchableOpacity key={key} style={styles.numpadKey} onPress={() => press(key)}>
                <Text style={styles.numpadKeyText}>{key === 'back' ? '⌫' : key}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={styles.submitButton} onPress={onDone}>
            <Text style={styles.submitButtonText}>{t('done')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// Kombinierter Dialog für Items mit variant_options (Pflichtauswahl, z.B. Rind/Huhn)
// und/oder extra_options (optionale Extras mit +/- Menge, z.B. bei Ajitama-Ramen). Auch
// für das Bearbeiten einer bereits im Warenkorb liegenden Zeile wiederverwendet (siehe
// editing/initialVariantDe/initialExtras in OrderScreen) — z.B. wenn beim Ramen noch
// last-minute ein Extra dazu soll, bevor die Bestellung abgeschickt ist; startet dann mit
// der aktuellen Auswahl der Zeile vorausgefüllt statt leer.
function ItemOptionsDialog({
  item,
  initialVariantDe = null,
  initialExtras = [],
  editing = false,
  onConfirm,
  onCancel,
  styles,
}: {
  item: MenuItem | null;
  initialVariantDe?: string | null;
  initialExtras?: CartExtra[];
  editing?: boolean;
  onConfirm: (variant: VariantOption | null, extras: CartExtra[]) => void;
  onCancel: () => void;
  styles: OrderStyles;
}) {
  const { t } = useI18n();
  const [selectedVariant, setSelectedVariant] = useState<VariantOption | null>(null);
  const [extraQuantities, setExtraQuantities] = useState<Record<string, number>>({});

  // Bei jedem neu geöffneten Item die lokale Auswahl zurücksetzen — auf initialVariantDe/
  // initialExtras beim Bearbeiten, sonst leer (siehe Kommentar oben).
  const itemId = item?.id ?? null;
  const [resetForItemId, setResetForItemId] = useState<string | null>(null);
  if (itemId !== resetForItemId) {
    setResetForItemId(itemId);
    const variantOptions = item?.variant_options ?? [];
    setSelectedVariant(variantOptions.find((v) => v.name_de === initialVariantDe) ?? null);
    const quantities: Record<string, number> = {};
    for (const extra of initialExtras) quantities[extra.nameDe] = extra.quantity;
    setExtraQuantities(quantities);
  }

  if (!item) return null;

  const requiresVariant = !!item.variant_options && item.variant_options.length > 0;
  const canConfirm = !requiresVariant || selectedVariant !== null;

  function changeExtraQty(extraKey: string, delta: number) {
    setExtraQuantities((prev) => {
      const next = Math.max(0, (prev[extraKey] ?? 0) + delta);
      return { ...prev, [extraKey]: next };
    });
  }

  function handleConfirm() {
    const extras: CartExtra[] = (item!.extra_options ?? [])
      .map((option) => ({
        nameHanzi: option.name_hanzi,
        nameDe: option.name_de,
        price: option.price ?? null,
        quantity: extraQuantities[option.name_de] ?? 0,
      }))
      .filter((e) => e.quantity > 0);
    onConfirm(selectedVariant, extras);
  }

  return (
    <Modal visible={item !== null} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{item.name_hanzi}</Text>
          <Text style={styles.modalSubtitle}>{item.name_de}</Text>

          {requiresVariant && (
            <View style={styles.optionsSection}>
              <View style={styles.variantRow}>
                {item.variant_options!.map((variant) => {
                  const active = selectedVariant?.name_de === variant.name_de;
                  return (
                    <TouchableOpacity
                      key={variant.name_de}
                      style={[styles.variantChoice, active && styles.variantChoiceActive]}
                      onPress={() => setSelectedVariant(variant)}
                    >
                      <Text style={[styles.variantChoiceHanzi, active && styles.variantChoiceTextActive]}>
                        {variant.name_hanzi}
                      </Text>
                      <Text style={[styles.variantChoiceDe, active && styles.variantChoiceTextActive]}>
                        {variant.name_de}
                        {variant.price !== undefined ? ` — ${formatPrice(variant.price)}` : ''}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {item.extra_options && item.extra_options.length > 0 && (
            <View style={styles.optionsSection}>
              <Text style={styles.optionsSectionTitle}>{t('extras')}</Text>
              {item.extra_options.map((extra) => {
                const qty = extraQuantities[extra.name_de] ?? 0;
                return (
                  <View key={extra.name_de} style={styles.extraRow}>
                    <View style={styles.extraLabel}>
                      <Text style={styles.extraHanzi}>{extra.name_hanzi}</Text>
                      <Text style={styles.extraDe}>
                        {extra.name_de}
                        {extra.price !== undefined ? ` — +${formatPrice(extra.price)}` : ''}
                      </Text>
                    </View>
                    <View style={styles.stepper}>
                      <TouchableOpacity
                        style={styles.stepperButton}
                        onPress={() => changeExtraQty(extra.name_de, -1)}
                        disabled={qty === 0}
                      >
                        <Text style={[styles.stepperButtonText, qty === 0 && styles.stepperButtonTextDisabled]}>
                          −
                        </Text>
                      </TouchableOpacity>
                      <Text style={styles.stepperValue}>{qty}</Text>
                      <TouchableOpacity style={styles.stepperButton} onPress={() => changeExtraQty(extra.name_de, 1)}>
                        <Text style={styles.stepperButtonText}>+</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          <TouchableOpacity
            style={[styles.submitButton, !canConfirm && styles.submitButtonDisabled]}
            onPress={handleConfirm}
            disabled={!canConfirm}
          >
            <Text style={styles.submitButtonText}>
              {editing ? t('applyChanges') : t('addToCart')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.modalCancel} onPress={onCancel}>
            <Text style={styles.modalCancelText}>{t('cancel')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    headerBackButton: { paddingHorizontal: 8, paddingVertical: 4 },
    headerBackButtonText: { fontSize: 17, color: colors.accent, fontWeight: '600' },
    container: { flex: 1, backgroundColor: colors.background },
    content: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center', padding: 16 },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
    errorText: { color: colors.danger },
    tableInput: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      backgroundColor: colors.surface,
      borderWidth: 1.5,
      borderColor: colors.borderStrong,
      borderStyle: 'dashed',
      borderRadius: 16,
      paddingHorizontal: 16,
      paddingVertical: 16,
      marginBottom: 12,
    },
    tableInputFilled: { borderStyle: 'solid', borderColor: colors.accent, backgroundColor: colors.accentSurface },
    tableInputEmoji: { fontSize: 22 },
    tableInputValueLarge: { fontSize: 20, color: colors.accent, fontWeight: '800' },
    tableInputValue: { fontSize: 16, color: colors.text, fontWeight: '600' },
    tableInputPlaceholder: { fontSize: 17, color: colors.textMuted, fontWeight: '600' },
    numpadDisplay: {
      fontSize: 32,
      fontWeight: '700',
      textAlign: 'center',
      marginBottom: 16,
      color: colors.text,
    },
    numpadGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      marginBottom: 16,
    },
    numpadKey: {
      width: '31%',
      aspectRatio: 1.4,
      backgroundColor: colors.surfaceAlt,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 10,
    },
    numpadKeyText: { fontSize: 22, fontWeight: '700', color: colors.text },
    categoryListContent: { paddingBottom: 12 },
    groupSection: { marginBottom: 22 },
    groupTitle: {
      fontSize: 20,
      fontWeight: '800',
      marginBottom: 10,
      color: colors.text,
      textAlign: 'center',
    },
    categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
    categoryButton: {
      backgroundColor: colors.surface,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: 14,
      paddingHorizontal: 10,
      width: '31%',
      minHeight: 104,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: colors.shadow,
      shadowOpacity: 0.06,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 2,
    },
    categoryEmoji: { fontSize: 32, marginBottom: 4 },
    categoryHanzi: { fontSize: 16, fontWeight: '700', color: colors.text, textAlign: 'center' },
    categoryDe: { fontSize: 12, color: colors.textMuted, marginTop: 2, textAlign: 'center' },
    // Deutlicher Abstand zum Screen-Header (dessen "← Hauptmenü"-Button sonst zu nah an
    // diesem "← Kategorien"-Button liegt und ständig aus Versehen getroffen wird).
    backButton: { marginTop: 20, marginBottom: 12, paddingVertical: 4 },
    backButtonText: { fontSize: 16, color: colors.accent, fontWeight: '600' },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
    sectionEmoji: { fontSize: 40 },
    sectionTitle: { fontSize: 24, fontWeight: '800', color: colors.text },
    sectionHanzi: { fontSize: 15, color: colors.textMuted, marginTop: 1 },
    itemRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 14,
      paddingHorizontal: 14,
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
    },
    itemCodeBadge: {
      backgroundColor: colors.accentSurface,
      borderRadius: 8,
      paddingHorizontal: 8,
      paddingVertical: 4,
      marginRight: 10,
      minWidth: 34,
      alignItems: 'center',
    },
    itemCodeText: { fontSize: 13, fontWeight: '800', color: colors.accent },
    itemRowText: { flex: 1, paddingRight: 8 },
    itemHanzi: { fontSize: 18, fontWeight: '600', color: colors.text },
    itemDe: { fontSize: 13, color: colors.textMuted },
    itemPricePill: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    itemPrice: { fontSize: 15, fontWeight: '700', color: colors.text },
    itemAdd: { fontSize: 20, fontWeight: '700', color: colors.accent, marginLeft: 10 },
    cartPanel: {
      backgroundColor: colors.surface,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 14,
      paddingBottom: 14,
      shadowColor: colors.shadow,
      shadowOpacity: 0.12,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: -4 },
      elevation: 8,
    },
    cartHandle: {
      alignItems: 'center',
      paddingTop: 8,
      paddingBottom: 10,
    },
    cartHandleBar: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.borderStrong,
      marginBottom: 6,
    },
    cartHandleText: { fontSize: 15, fontWeight: '700', color: colors.textSecondary },
    cartItemsWrap: { overflow: 'hidden' },
    cartItemsList: { flex: 1 },
    cartLine: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.surfaceAlt,
    },
    cartLineTextWrap: { flex: 1, paddingRight: 8 },
    cartLineText: { fontSize: 15, color: colors.text },
    cartLineExtras: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
    cartLinePrice: { fontSize: 13, fontWeight: '700', color: colors.text, marginTop: 2 },
    cartTotalRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingTop: 10,
      marginTop: 4,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    cartTotalLabel: { fontSize: 16, fontWeight: '700', color: colors.text },
    cartTotalValue: { fontSize: 20, fontWeight: '800', color: colors.accent },
    cartTotalNote: { fontSize: 12, color: colors.warning, marginTop: 2 },
    // Öffnet den NoteDialog statt direkt einzugeben (siehe NoteDialog-Kommentar) — sieht
    // wie ein Eingabefeld aus, ist aber nur ein Button.
    noteField: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 8,
      paddingVertical: 4,
      marginTop: 4,
    },
    noteFieldText: { fontSize: 13, color: colors.text },
    // Schärfe-Leiste einer Warenkorb-Zeile (nur Hauptspeisen, siehe spiceableItemIds).
    spiceBarRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
    spiceBarIcon: { fontSize: 15, marginRight: 6 },
    spiceBar: {
      flex: 1,
      flexDirection: 'row',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      overflow: 'hidden',
    },
    spiceSegment: { flex: 1, paddingVertical: 6, alignItems: 'center', justifyContent: 'center' },
    spiceSegmentDivider: { borderLeftWidth: 1, borderLeftColor: colors.border },
    spiceSegmentText: { fontSize: 12, color: colors.textSecondary },
    spiceSegmentTextFilled: { color: '#fff', fontWeight: '700' },
    noteFieldPlaceholder: { fontSize: 13, color: colors.textFaint },
    // Stift-Button zum nachträglichen Ändern von Variante/Extras/Beschreibung einer
    // Warenkorb-Zeile (siehe handleEditCartLine) — nur sichtbar bei Items, die überhaupt
    // einen Dialog haben (isEditableMenuItem).
    cartLineEditButton: { paddingHorizontal: 8 },
    cartLineEditButtonText: { fontSize: 17, color: colors.textSecondary },
    removeText: {
      fontSize: 20,
      fontWeight: '700',
      color: colors.danger,
      width: 34,
      height: 34,
      lineHeight: 32,
      textAlign: 'center',
      borderRadius: 17,
      overflow: 'hidden',
      backgroundColor: colors.surfaceAlt,
      marginLeft: 6,
    },
    customEntryInput: {
      fontSize: 16,
      color: colors.text,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 12,
      marginBottom: 12,
    },
    noteDialogInput: { minHeight: 90, textAlignVertical: 'top' },
    submitButton: {
      backgroundColor: colors.accent,
      borderRadius: 14,
      paddingVertical: 16,
      alignItems: 'center',
      marginTop: 8,
    },
    submitButtonDisabled: { backgroundColor: colors.textFaint },
    submitButtonText: { color: colors.onAccent, fontSize: 17, fontWeight: '800' },
    // Mittig unten statt in der rechten Ecke — passt zur zentrierten Inhaltsspalte.
    cartBarMini: {
      position: 'absolute',
      bottom: 24,
      alignSelf: 'center',
      backgroundColor: colors.accent,
      borderRadius: 999,
      paddingHorizontal: 26,
      paddingVertical: 16,
      shadowColor: colors.shadow,
      shadowOpacity: 0.25,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
      elevation: 8,
    },
    cartBarMiniText: { color: '#fff', fontWeight: '700', fontSize: 17 },
    modalOverlay: {
      flex: 1,
      backgroundColor: colors.overlay,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    modalCard: {
      backgroundColor: colors.surface,
      borderRadius: 22,
      padding: 22,
      width: '100%',
      maxWidth: 360,
    },
    modalEmoji: { fontSize: 40, textAlign: 'center', marginBottom: 6 },
    modalTitle: { fontSize: 20, fontWeight: '700', textAlign: 'center', color: colors.text },
    modalSubtitle: { fontSize: 14, color: colors.textMuted, textAlign: 'center', marginBottom: 16 },
    variantOption: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: 14,
      paddingVertical: 14,
      alignItems: 'center',
      marginBottom: 10,
    },
    variantOptionHanzi: { fontSize: 17, fontWeight: '600', color: colors.text },
    variantOptionDe: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
    modalCancel: { paddingVertical: 10, alignItems: 'center', marginTop: 4 },
    modalCancelText: { fontSize: 15, color: colors.danger },
    leaveConfirmButton: {
      backgroundColor: '#b91c1c',
      borderRadius: 14,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: 4,
    },
    leaveConfirmCancelText: { fontSize: 15, color: colors.textMuted },
    optionsSection: { marginBottom: 16 },
    optionsSectionTitle: { fontSize: 14, fontWeight: '700', color: colors.textSecondary, marginBottom: 8 },
    variantRow: { flexDirection: 'row', gap: 10 },
    variantChoice: {
      flex: 1,
      backgroundColor: colors.surfaceAlt,
      borderRadius: 14,
      paddingVertical: 14,
      alignItems: 'center',
      borderWidth: 2,
      borderColor: 'transparent',
    },
    variantChoiceActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    variantChoiceHanzi: { fontSize: 17, fontWeight: '600', color: colors.text },
    variantChoiceDe: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
    variantChoiceTextActive: { color: '#fff' },
    extraRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.surfaceAlt,
    },
    extraLabel: { flex: 1 },
    extraHanzi: { fontSize: 15, fontWeight: '600', color: colors.text },
    extraDe: { fontSize: 12, color: colors.textMuted },
    stepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    stepperButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.accentSurface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepperButtonText: { fontSize: 18, fontWeight: '700', color: colors.text },
    stepperButtonTextDisabled: { color: colors.borderStrong },
    stepperValue: { fontSize: 16, fontWeight: '600', minWidth: 20, textAlign: 'center', color: colors.text },
  });
