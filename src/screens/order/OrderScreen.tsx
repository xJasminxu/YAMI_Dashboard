import { useMemo, useState } from 'react';
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
import { useMenu } from '../../hooks/useMenu';
import { supabase } from '../../lib/supabase';
import type { MenuGroup, MenuItem, VariantOption } from '../../types/database';

const MENU_GROUP_LABELS: Record<MenuGroup, string> = {
  essen: 'Essen',
  getraenke: 'Getränke',
  nachspeisen: 'Nachspeisen',
};

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
  quantity: number;
}

function extrasSignature(extras: CartExtra[]) {
  return extras
    .map((e) => `${e.nameDe}x${e.quantity}`)
    .sort()
    .join('|');
}

function cartKeyFor(menuItemId: string, variantDe: string | null, extras: CartExtra[]) {
  return `${menuItemId}::${variantDe ?? ''}::${extrasSignature(extras)}`;
}

// Preis für eine Bestellzeile (eine Portion): Variantenpreis falls vorhanden, sonst
// der Item-Grundpreis, plus alle Extras mit ihrer jeweiligen Menge.
function lineUnitTotal(line: Pick<CartLine, 'unitPrice' | 'extras'>): number | null {
  const extrasSum = line.extras.reduce((sum, e) => sum + (e.price ?? 0) * e.quantity, 0);
  if (line.unitPrice === null && line.extras.every((e) => e.price === null)) return null;
  return (line.unitPrice ?? 0) + extrasSum;
}

function formatPrice(amount: number) {
  return `${amount.toFixed(2).replace('.', ',')} €`;
}

// Preis-Anzeige für die Item-Liste: fixer Preis, "ab X€" wenn der Preis erst per
// Variante feststeht (z.B. Fried Chicken 4/8 Stück), oder nichts, falls noch kein
// Preis hinterlegt ist.
function itemPriceLabel(item: MenuItem): string | null {
  if (item.price !== null) return formatPrice(item.price);
  const variantPrices = (item.variant_options ?? []).map((v) => v.price).filter((p): p is number => p !== undefined);
  if (variantPrices.length > 0) return `ab ${formatPrice(Math.min(...variantPrices))}`;
  return null;
}

export default function OrderScreen() {
  const { categories, loading, error } = useMenu();
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [tableNumber, setTableNumber] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [variantPromptItem, setVariantPromptItem] = useState<MenuItem | null>(null);
  const [optionsPromptItem, setOptionsPromptItem] = useState<MenuItem | null>(null);
  const [customEntryItem, setCustomEntryItem] = useState<MenuItem | null>(null);
  const [numpadOpen, setNumpadOpen] = useState(false);

  const groupedCategories = useMemo(() => {
    const groups: Record<MenuGroup, typeof categories> = { essen: [], getraenke: [], nachspeisen: [] };
    for (const category of categories) {
      groups[category.menu_group].push(category);
    }
    return groups;
  }, [categories]);

  const activeCategory = categories.find((c) => c.id === activeCategoryId) ?? null;
  const cartCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const cartTotal = cart.reduce((sum, line) => sum + (lineUnitTotal(line) ?? 0) * line.quantity, 0);
  const cartHasUnpricedItem = cart.some((line) => lineUnitTotal(line) === null);

  function addToCart(item: MenuItem, variant: VariantOption | null, extras: CartExtra[] = []) {
    const cartKey = cartKeyFor(item.id, variant?.name_de ?? null, extras);
    const unitPrice = variant?.price ?? item.price ?? null;
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
          quantity: 1,
        },
      ];
    });
  }

  function updateNote(cartKey: string, note: string) {
    setCart((prev) => prev.map((line) => (line.cartKey === cartKey ? { ...line, note } : line)));
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

  function chooseVariant(variant: VariantOption) {
    if (!variantPromptItem) return;
    addToCart(variantPromptItem, variant);
    setVariantPromptItem(null);
  }

  function confirmCustomEntry(description: string, price: number | null) {
    if (!customEntryItem) return;
    // Freitext-Beschreibung + Preis fahren huckepack auf dem Varianten-Mechanismus mit
    // (siehe addToCart) statt eines eigenen Datenpfads — Preis-Summierung, Warenkorb-
    // Anzeige und order_items-Insert funktionieren dadurch ohne Sonderfall.
    addToCart(customEntryItem, { name_hanzi: description, name_de: description, price: price ?? undefined });
    setCustomEntryItem(null);
  }

  function confirmOptions(variant: VariantOption | null, extras: CartExtra[]) {
    if (!optionsPromptItem) return;
    addToCart(optionsPromptItem, variant, extras.filter((e) => e.quantity > 0));
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
      setSubmitError(tableError?.message ?? 'Tisch konnte nicht angelegt werden.');
      setSubmitting(false);
      return;
    }

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({ table_id: table.id })
      .select()
      .single();

    if (orderError || !order) {
      setSubmitError(orderError?.message ?? 'Bestellung konnte nicht angelegt werden.');
      setSubmitting(false);
      return;
    }

    const rows = cart.flatMap((line) =>
      Array.from({ length: line.quantity }, () => ({
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
      }))
    );

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
        <Text style={styles.errorText}>Menü konnte nicht geladen werden: {error}</Text>
      </View>
    );
  }

  if (activeCategory) {
    return (
      <View style={styles.container}>
        <TouchableOpacity onPress={() => setActiveCategoryId(null)} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Kategorien</Text>
        </TouchableOpacity>
        <Text style={styles.sectionTitle}>{activeCategory.name_de}</Text>
        <FlatList
          data={activeCategory.items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.itemRow} onPress={() => handleItemPress(item)}>
              {item.item_code && (
                <View style={styles.itemCodeBadge}>
                  <Text style={styles.itemCodeText}>{item.item_code}</Text>
                </View>
              )}
              <View style={styles.itemRowText}>
                <Text style={styles.itemHanzi}>{item.name_hanzi}</Text>
                <Text style={styles.itemDe}>{item.name_de}</Text>
              </View>
              {itemPriceLabel(item) && <Text style={styles.itemPrice}>{itemPriceLabel(item)}</Text>}
            </TouchableOpacity>
          )}
        />
        <CartBar cartCount={cartCount} onPress={() => setActiveCategoryId(null)} />
        <VariantDialog item={variantPromptItem} onChoose={chooseVariant} onCancel={() => setVariantPromptItem(null)} />
        <ItemOptionsDialog
          item={optionsPromptItem}
          onConfirm={confirmOptions}
          onCancel={() => setOptionsPromptItem(null)}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.tableInput} onPress={() => setNumpadOpen(true)}>
        <Text style={tableNumber ? styles.tableInputValue : styles.tableInputPlaceholder}>
          {tableNumber || 'Tischnummer eingeben'}
        </Text>
      </TouchableOpacity>
      <NumpadDialog
        visible={numpadOpen}
        value={tableNumber}
        onChange={setTableNumber}
        onDone={() => setNumpadOpen(false)}
      />

      <FlatList
        data={(Object.keys(groupedCategories) as MenuGroup[]).filter((g) => groupedCategories[g].length > 0)}
        keyExtractor={(group) => group}
        renderItem={({ item: group }) => (
          <View style={styles.groupSection}>
            <Text style={styles.groupTitle}>{MENU_GROUP_LABELS[group]}</Text>
            <View style={styles.categoryGrid}>
              {groupedCategories[group].map((category) => {
                // Kategorien mit genau einem "Diverses"-Item (siehe seed.sql) verhalten sich
                // wie ein eigener Button: direkt den Freitext-Dialog öffnen statt erst in
                // eine Ein-Item-Liste zu navigieren.
                const soleCustomItem =
                  category.items.length === 1 && category.items[0].is_custom_entry ? category.items[0] : null;
                return (
                  <TouchableOpacity
                    key={category.id}
                    style={styles.categoryButton}
                    onPress={() =>
                      soleCustomItem ? setCustomEntryItem(soleCustomItem) : setActiveCategoryId(category.id)
                    }
                  >
                    <Text style={styles.categoryHanzi}>{category.name_hanzi}</Text>
                    <Text style={styles.categoryDe}>{category.name_de}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}
      />

      {cart.length > 0 && (
        <View style={styles.cartPanel}>
          <FlatList
            data={cart}
            keyExtractor={(line) => line.cartKey}
            renderItem={({ item: line }) => (
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
                    <Text style={styles.cartLinePrice}>{formatPrice(lineUnitTotal(line)! * line.quantity)}</Text>
                  )}
                  <TextInput
                    style={styles.noteInput}
                    placeholder="Notiz…"
                    value={line.note}
                    onChangeText={(text) => updateNote(line.cartKey, text)}
                  />
                </View>
                <TouchableOpacity onPress={() => removeFromCart(line.cartKey)}>
                  <Text style={styles.removeText}>−</Text>
                </TouchableOpacity>
              </View>
            )}
          />
          {submitError && <Text style={styles.errorText}>{submitError}</Text>}
          <View style={styles.cartTotalRow}>
            <Text style={styles.cartTotalLabel}>
              Summe{cartHasUnpricedItem ? ' (unvollständig, s.u.)' : ''}
            </Text>
            <Text style={styles.cartTotalValue}>{formatPrice(cartTotal)}</Text>
          </View>
          {cartHasUnpricedItem && (
            <Text style={styles.cartTotalNote}>Enthält Positionen ohne hinterlegten Preis.</Text>
          )}
          <TouchableOpacity
            style={[styles.submitButton, (!tableNumber || submitting) && styles.submitButtonDisabled]}
            onPress={submitOrder}
            disabled={!tableNumber || submitting}
          >
            <Text style={styles.submitButtonText}>
              {submitting ? 'Wird gesendet…' : `Bestellung senden (${cartCount})`}
            </Text>
          </TouchableOpacity>
        </View>
      )}
      <CustomEntryDialog
        item={customEntryItem}
        onConfirm={confirmCustomEntry}
        onCancel={() => setCustomEntryItem(null)}
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
}: {
  visible: boolean;
  value: string;
  onChange: (value: string) => void;
  onDone: () => void;
}) {
  function press(key: (typeof NUMPAD_KEYS)[number]) {
    if (key === 'clear') {
      onChange('');
    } else if (key === 'back') {
      onChange(value.slice(0, -1));
    } else if (value.length < MAX_TABLE_NUMBER_LENGTH) {
      onChange(value + key);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDone}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Tischnummer</Text>
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
            <Text style={styles.submitButtonText}>Fertig</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function CartBar({ cartCount, onPress }: { cartCount: number; onPress: () => void }) {
  if (cartCount === 0) return null;
  return (
    <TouchableOpacity style={styles.cartBarMini} onPress={onPress}>
      <Text style={styles.cartBarMiniText}>{cartCount} im Warenkorb · Zur Bestellung →</Text>
    </TouchableOpacity>
  );
}

function VariantDialog({
  item,
  onChoose,
  onCancel,
}: {
  item: MenuItem | null;
  onChoose: (variant: VariantOption) => void;
  onCancel: () => void;
}) {
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
            <Text style={styles.modalCancelText}>Abbrechen</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// Dialog für "Diverses"-Items (menu_items.is_custom_entry): Bedienung trägt Beschreibung
// + Preis frei ein, statt aus einer festen Speisekarten-Position zu wählen.
function CustomEntryDialog({
  item,
  onConfirm,
  onCancel,
}: {
  item: MenuItem | null;
  onConfirm: (description: string, price: number | null) => void;
  onCancel: () => void;
}) {
  const [description, setDescription] = useState('');
  const [priceText, setPriceText] = useState('');
  const [priceNumpadOpen, setPriceNumpadOpen] = useState(false);

  // Bei jedem neu geöffneten Item die lokale Eingabe zurücksetzen.
  const itemId = item?.id ?? null;
  const [resetForItemId, setResetForItemId] = useState<string | null>(null);
  if (itemId !== resetForItemId) {
    setResetForItemId(itemId);
    setDescription('');
    setPriceText('');
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
            placeholder="Beschreibung"
            value={description}
            onChangeText={setDescription}
            autoFocus
          />
          <TouchableOpacity style={styles.customEntryInput} onPress={() => setPriceNumpadOpen(true)}>
            <Text style={priceText ? styles.tableInputValue : styles.tableInputPlaceholder}>
              {priceText ? `${priceText} €` : 'Preis eingeben'}
            </Text>
          </TouchableOpacity>
          <PriceNumpadDialog
            visible={priceNumpadOpen}
            value={priceText}
            onChange={setPriceText}
            onDone={() => setPriceNumpadOpen(false)}
          />
          <TouchableOpacity
            style={[styles.submitButton, !canConfirm && styles.submitButtonDisabled]}
            onPress={handleConfirm}
            disabled={!canConfirm}
          >
            <Text style={styles.submitButtonText}>Zum Warenkorb hinzufügen</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.modalCancel} onPress={onCancel}>
            <Text style={styles.modalCancelText}>Abbrechen</Text>
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
}: {
  visible: boolean;
  value: string;
  onChange: (value: string) => void;
  onDone: () => void;
}) {
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
          <Text style={styles.modalTitle}>Preis</Text>
          <Text style={styles.numpadDisplay}>{value ? `${value} €` : '—'}</Text>
          <View style={styles.numpadGrid}>
            {PRICE_NUMPAD_KEYS.map((key) => (
              <TouchableOpacity key={key} style={styles.numpadKey} onPress={() => press(key)}>
                <Text style={styles.numpadKeyText}>{key === 'back' ? '⌫' : key}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={styles.submitButton} onPress={onDone}>
            <Text style={styles.submitButtonText}>Fertig</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// Kombinierter Dialog für Items mit variant_options (Pflichtauswahl, z.B. Rind/Huhn)
// und/oder extra_options (optionale Extras mit +/- Menge, z.B. bei Ajitama-Ramen).
function ItemOptionsDialog({
  item,
  onConfirm,
  onCancel,
}: {
  item: MenuItem | null;
  onConfirm: (variant: VariantOption | null, extras: CartExtra[]) => void;
  onCancel: () => void;
}) {
  const [selectedVariant, setSelectedVariant] = useState<VariantOption | null>(null);
  const [extraQuantities, setExtraQuantities] = useState<Record<string, number>>({});

  // Bei jedem neu geöffneten Item die lokale Auswahl zurücksetzen.
  const itemId = item?.id ?? null;
  const [resetForItemId, setResetForItemId] = useState<string | null>(null);
  if (itemId !== resetForItemId) {
    setResetForItemId(itemId);
    setSelectedVariant(null);
    setExtraQuantities({});
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
              <Text style={styles.optionsSectionTitle}>Extras</Text>
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
            <Text style={styles.submitButtonText}>Zum Warenkorb hinzufügen</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.modalCancel} onPress={onCancel}>
            <Text style={styles.modalCancelText}>Abbrechen</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 16 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { color: '#b91c1c' },
  tableInput: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 16,
  },
  tableInputValue: { fontSize: 16, color: '#111827', fontWeight: '600' },
  tableInputPlaceholder: { fontSize: 16, color: '#9ca3af' },
  numpadDisplay: {
    fontSize: 32,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 16,
    color: '#111827',
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
    backgroundColor: '#f3f4f6',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  numpadKeyText: { fontSize: 22, fontWeight: '700', color: '#1f2937' },
  groupSection: { marginBottom: 20 },
  groupTitle: { fontSize: 20, fontWeight: '700', marginBottom: 8 },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryButton: {
    backgroundColor: '#f3f4f6',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    minWidth: '30%',
    alignItems: 'center',
  },
  categoryHanzi: { fontSize: 16, fontWeight: '600' },
  categoryDe: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  backButton: { marginBottom: 8 },
  backButtonText: { fontSize: 16, color: '#2563eb' },
  sectionTitle: { fontSize: 22, fontWeight: '700', marginBottom: 12 },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  itemCodeBadge: {
    backgroundColor: '#e5e7eb',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 10,
    minWidth: 34,
    alignItems: 'center',
  },
  itemCodeText: { fontSize: 13, fontWeight: '700', color: '#374151' },
  itemRowText: { flex: 1, paddingRight: 8 },
  itemHanzi: { fontSize: 18, fontWeight: '600' },
  itemDe: { fontSize: 13, color: '#6b7280' },
  itemPrice: { fontSize: 15, fontWeight: '600', color: '#1f2937' },
  cartPanel: {
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingTop: 12,
    maxHeight: 260,
  },
  cartLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  cartLineTextWrap: { flex: 1, paddingRight: 8 },
  cartLineText: { fontSize: 15 },
  cartLineExtras: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  cartLinePrice: { fontSize: 13, fontWeight: '700', color: '#1f2937', marginTop: 2 },
  cartTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 10,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  cartTotalLabel: { fontSize: 16, fontWeight: '700' },
  cartTotalValue: { fontSize: 18, fontWeight: '800' },
  cartTotalNote: { fontSize: 12, color: '#b45309', marginTop: 2 },
  noteInput: {
    fontSize: 13,
    color: '#1f2937',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginTop: 4,
  },
  removeText: { fontSize: 20, color: '#b91c1c', paddingHorizontal: 12 },
  customEntryInput: {
    fontSize: 16,
    color: '#1f2937',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  submitButton: {
    backgroundColor: '#16a34a',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  submitButtonDisabled: { backgroundColor: '#9ca3af' },
  submitButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cartBarMini: {
    position: 'absolute',
    bottom: 16,
    right: 16,
    backgroundColor: '#16a34a',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  cartBarMiniText: { color: '#fff', fontWeight: '700' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 20,
    width: '100%',
    maxWidth: 360,
  },
  modalTitle: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  modalSubtitle: { fontSize: 14, color: '#6b7280', textAlign: 'center', marginBottom: 16 },
  variantOption: {
    backgroundColor: '#f3f4f6',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  variantOptionHanzi: { fontSize: 17, fontWeight: '600' },
  variantOptionDe: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  modalCancel: { paddingVertical: 10, alignItems: 'center', marginTop: 4 },
  modalCancelText: { fontSize: 15, color: '#b91c1c' },
  optionsSection: { marginBottom: 16 },
  optionsSectionTitle: { fontSize: 14, fontWeight: '700', color: '#374151', marginBottom: 8 },
  variantRow: { flexDirection: 'row', gap: 10 },
  variantChoice: {
    flex: 1,
    backgroundColor: '#f3f4f6',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  variantChoiceActive: { backgroundColor: '#16a34a', borderColor: '#15803d' },
  variantChoiceHanzi: { fontSize: 17, fontWeight: '600' },
  variantChoiceDe: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  variantChoiceTextActive: { color: '#fff' },
  extraRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  extraLabel: { flex: 1 },
  extraHanzi: { fontSize: 15, fontWeight: '600' },
  extraDe: { fontSize: 12, color: '#6b7280' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepperButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperButtonText: { fontSize: 18, fontWeight: '700', color: '#1f2937' },
  stepperButtonTextDisabled: { color: '#d1d5db' },
  stepperValue: { fontSize: 16, fontWeight: '600', minWidth: 20, textAlign: 'center' },
});
