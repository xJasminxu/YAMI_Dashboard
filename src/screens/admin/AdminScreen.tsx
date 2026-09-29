import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { compareItemCode } from '../../hooks/useMenu';
import { ACTIVITY_RETENTION_DAYS, purgeExpiredActivity, retentionCutoffIso } from '../../lib/activityLog';
import { ADMIN_PIN } from '../../lib/adminPin';
import { formatDateTime } from '../../lib/datetime';
import { categoryEmoji, titleCase } from '../../lib/emoji';
import { formatPrice } from '../../lib/pricing';
import { supabase } from '../../lib/supabase';
import type { ActivityKind, ActivityLogEntry, Category, ExtraOption, MenuItem, VariantOption } from '../../types/database';
import type { ThemeColors } from '../../theme/colors';
import { useThemedStyles } from '../../theme/useThemedStyles';

type AdminStyles = ReturnType<typeof createStyles>;
type Tab = 'menu' | 'log';

// Admin-Modus (Hauptmenü → 🔐 Admin, PIN-geschützt wie Tagesabschluss/Tisch löschen):
//  - "Speisekarte": Gerichte anlegen, Namen/Code/Preise (inkl. Varianten- und Extra-Preise)
//    ändern, Gerichte ausblenden/wiederherstellen. Ausblenden statt echt löschen, weil
//    menu_items von bereits bestellten Positionen referenziert wird (siehe schema.sql).
//  - "Protokoll": gelöschte Tische, entfernte Positionen und angewendete Rabatte der
//    letzten 3 Tage (activity_log, siehe lib/activityLog.ts) — ältere Einträge werden
//    endgültig gelöscht.
export default function AdminScreen() {
  const styles = useThemedStyles(createStyles);
  const [unlocked, setUnlocked] = useState(false);
  const [tab, setTab] = useState<Tab>('menu');

  if (!unlocked) {
    return <PinGate onUnlock={() => setUnlocked(true)} styles={styles} />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.tabBar}>
        <TouchableOpacity style={[styles.tab, tab === 'menu' && styles.tabActive]} onPress={() => setTab('menu')}>
          <Text style={[styles.tabText, tab === 'menu' && styles.tabTextActive]}>🍜 Speisekarte</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === 'log' && styles.tabActive]} onPress={() => setTab('log')}>
          <Text style={[styles.tabText, tab === 'log' && styles.tabTextActive]}>📜 Protokoll</Text>
        </TouchableOpacity>
      </View>
      {tab === 'menu' ? <MenuEditor styles={styles} /> : <ActivityLog styles={styles} />}
    </View>
  );
}

// ---------------------------------------------------------------------------
// PIN
// ---------------------------------------------------------------------------

function PinGate({ onUnlock, styles }: { onUnlock: () => void; styles: AdminStyles }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  function submit() {
    if (pin === ADMIN_PIN) {
      onUnlock();
    } else {
      setError(true);
      setPin('');
    }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, styles.centered]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.pinCard}>
        <Text style={styles.pinEmoji}>🔐</Text>
        <Text style={styles.pinTitle}>Admin-Modus</Text>
        <Text style={styles.pinSub}>PIN eingeben</Text>
        <TextInput
          style={styles.pinInput}
          value={pin}
          onChangeText={(text) => {
            setError(false);
            setPin(text.replace(/[^0-9]/g, ''));
          }}
          onSubmitEditing={submit}
          placeholder="••••"
          placeholderTextColor={styles.placeholder.color as string}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={4}
          autoFocus
        />
        {error && <Text style={styles.errorText}>Falsche PIN.</Text>}
        <TouchableOpacity
          style={[styles.primaryButton, !pin && styles.primaryButtonDisabled]}
          onPress={submit}
          disabled={!pin}
        >
          <Text style={styles.primaryButtonText}>Entsperren</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ---------------------------------------------------------------------------
// Speisekarte
// ---------------------------------------------------------------------------

interface EditorState {
  mode: 'new' | 'edit';
  category: Category;
  item: MenuItem | null;
}

function parsePrice(text: string): number | null | 'invalid' {
  const normalized = text.trim().replace(',', '.');
  if (!normalized) return null;
  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value) || value < 0) return 'invalid';
  return Math.round(value * 100) / 100;
}

function priceToText(price: number | null | undefined): string {
  return price === null || price === undefined ? '' : price.toFixed(2).replace('.', ',');
}

function itemPriceSummary(item: MenuItem): string {
  if (item.price !== null) return formatPrice(item.price);
  const variantPrices = (item.variant_options ?? [])
    .map((v) => v.price)
    .filter((p): p is number => typeof p === 'number');
  if (variantPrices.length > 0) return `ab ${formatPrice(Math.min(...variantPrices))}`;
  return 'kein Preis';
}

function MenuEditor({ styles }: { styles: AdminStyles }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [categoriesRes, itemsRes] = await Promise.all([
      supabase.from('categories').select('*').order('sort_order', { ascending: true }),
      supabase.from('menu_items').select('*').order('created_at', { ascending: true }),
    ]);
    if (categoriesRes.error || itemsRes.error) {
      setError(categoriesRes.error?.message ?? itemsRes.error?.message ?? 'Unbekannter Fehler');
    } else {
      setError(null);
      // Rabatt-Kategorie ist kein Speisekarten-Eintrag (siehe OrderScreen), "Diverses"-
      // Sammelposten (is_custom_entry) haben keinen festen Preis — beide nicht editierbar.
      setCategories((categoriesRes.data as Category[]).filter((c) => !c.is_discount));
      setItems((itemsRes.data as MenuItem[]).filter((i) => !i.is_custom_entry));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const query = search.trim().toLowerCase();

  const grouped = useMemo(() => {
    return categories
      .map((category) => {
        const all = items
          .filter((item) => item.category_id === category.id)
          .filter((item) => {
            if (!query) return true;
            return [item.name_de, item.name_hanzi ?? '', item.item_code ?? '']
              .some((field) => field.toLowerCase().includes(query));
          })
          .sort(compareItemCode);
        return {
          category,
          active: all.filter((item) => item.active),
          hidden: all.filter((item) => !item.active),
        };
      })
      .filter((group) => !query || group.active.length + group.hidden.length > 0);
  }, [categories, items, query]);

  function toggleCategory(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function setActive(item: MenuItem, active: boolean) {
    setBusyItemId(item.id);
    const { error: updateError } = await supabase.from('menu_items').update({ active }).eq('id', item.id);
    setBusyItemId(null);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, active } : i)));
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="🔎 Gericht, Code oder Hanzi suchen"
          placeholderTextColor={styles.placeholder.color as string}
        />
        <Text style={styles.hint}>
          Änderungen gelten sofort. Die Bestellung-Ansicht zeigt sie nach dem nächsten Öffnen. Preisänderungen
          wirken nicht auf bereits aufgenommene Bestellungen.
        </Text>
        {error && <Text style={styles.errorText}>{error}</Text>}

        {grouped.map(({ category, active, hidden }) => {
          const open = !!query || expanded.has(category.id);
          return (
            <View key={category.id} style={styles.categoryCard}>
              <TouchableOpacity style={styles.categoryHeader} onPress={() => toggleCategory(category.id)}>
                <Text style={styles.categoryEmoji}>{categoryEmoji(category.name_de, category.menu_group)}</Text>
                <View style={styles.categoryTitleWrap}>
                  <Text style={styles.categoryTitle}>{titleCase(category.name_de)}</Text>
                  <Text style={styles.categorySub}>
                    {active.length} aktiv{hidden.length > 0 ? ` · ${hidden.length} ausgeblendet` : ''}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.addButton}
                  onPress={() => setEditor({ mode: 'new', category, item: null })}
                  accessibilityLabel={`Neues Gericht in ${category.name_de}`}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.addButtonText}>＋</Text>
                </TouchableOpacity>
                <Text style={styles.chevron}>{open ? '▾' : '▸'}</Text>
              </TouchableOpacity>

              {open && (
                <View>
                  {active.length === 0 && hidden.length === 0 && (
                    <Text style={styles.emptyText}>Noch keine Gerichte — mit ＋ anlegen.</Text>
                  )}
                  {active.map((item) => (
                    <MenuItemRow
                      key={item.id}
                      item={item}
                      busy={busyItemId === item.id}
                      onEdit={() => setEditor({ mode: 'edit', category, item })}
                      onToggleActive={() => setActive(item, false)}
                      styles={styles}
                    />
                  ))}
                  {hidden.length > 0 && <Text style={styles.hiddenLabel}>🙈 Ausgeblendet</Text>}
                  {hidden.map((item) => (
                    <MenuItemRow
                      key={item.id}
                      item={item}
                      busy={busyItemId === item.id}
                      onEdit={() => setEditor({ mode: 'edit', category, item })}
                      onToggleActive={() => setActive(item, true)}
                      styles={styles}
                    />
                  ))}
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      <ItemEditorDialog
        state={editor}
        onClose={() => setEditor(null)}
        onSaved={(saved) => {
          setItems((prev) => {
            const exists = prev.some((i) => i.id === saved.id);
            return exists ? prev.map((i) => (i.id === saved.id ? saved : i)) : [...prev, saved];
          });
          setExpanded((prev) => new Set(prev).add(saved.category_id));
          setEditor(null);
        }}
        styles={styles}
      />
    </>
  );
}

function MenuItemRow({
  item,
  busy,
  onEdit,
  onToggleActive,
  styles,
}: {
  item: MenuItem;
  busy: boolean;
  onEdit: () => void;
  onToggleActive: () => void;
  styles: AdminStyles;
}) {
  return (
    <View style={[styles.itemRow, !item.active && styles.itemRowHidden]}>
      <TouchableOpacity style={styles.itemMain} onPress={onEdit} accessibilityLabel={`${item.name_de} bearbeiten`}>
        {item.item_code && (
          <View style={styles.codeBadge}>
            <Text style={styles.codeBadgeText}>{item.item_code}</Text>
          </View>
        )}
        <View style={styles.itemText}>
          <Text style={styles.itemName} numberOfLines={1}>
            {item.name_hanzi ?? item.name_de}
          </Text>
          {item.name_hanzi && (
            <Text style={styles.itemSub} numberOfLines={1}>
              {item.name_de}
            </Text>
          )}
        </View>
        <Text style={[styles.itemPrice, item.price === null && !item.variant_options?.length && styles.itemPriceMissing]}>
          {itemPriceSummary(item)}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.iconButton}
        onPress={onEdit}
        accessibilityLabel="Bearbeiten"
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <Text style={styles.iconButtonText}>✏️</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.iconButton, item.active ? styles.iconButtonDanger : styles.iconButtonRestore]}
        onPress={onToggleActive}
        disabled={busy}
        accessibilityLabel={item.active ? 'Aus der Speisekarte entfernen' : 'Wiederherstellen'}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        {busy ? <ActivityIndicator size="small" /> : <Text style={styles.iconButtonText}>{item.active ? '🗑️' : '↩️'}</Text>}
      </TouchableOpacity>
    </View>
  );
}

function ItemEditorDialog({
  state,
  onClose,
  onSaved,
  styles,
}: {
  state: EditorState | null;
  onClose: () => void;
  onSaved: (item: MenuItem) => void;
  styles: AdminStyles;
}) {
  const [nameHanzi, setNameHanzi] = useState('');
  const [nameDe, setNameDe] = useState('');
  const [code, setCode] = useState('');
  const [priceText, setPriceText] = useState('');
  const [variantPrices, setVariantPrices] = useState<string[]>([]);
  const [extraPrices, setExtraPrices] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bei jedem neu geöffneten Dialog die Felder aus dem Gericht (bzw. leer) befüllen —
  // gleiches Muster wie die Dialoge in OrderScreen.tsx.
  const stateKey = state ? `${state.mode}:${state.item?.id ?? state.category.id}` : null;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  if (stateKey !== loadedKey) {
    setLoadedKey(stateKey);
    const item = state?.item ?? null;
    setNameHanzi(item?.name_hanzi ?? '');
    setNameDe(item?.name_de ?? '');
    setCode(item?.item_code ?? '');
    setPriceText(priceToText(item?.price));
    setVariantPrices((item?.variant_options ?? []).map((v) => priceToText(v.price)));
    setExtraPrices((item?.extra_options ?? []).map((e) => priceToText(e.price)));
    setError(null);
    setSaving(false);
  }

  if (!state) return null;

  const item = state.item;
  const variants = item?.variant_options ?? [];
  const extras = item?.extra_options ?? [];
  const hasVariants = variants.length > 0;

  async function save() {
    if (!state) return;
    const trimmedDe = nameDe.trim();
    if (!trimmedDe) {
      setError('Bitte einen deutschen Namen eingeben.');
      return;
    }

    const price = hasVariants ? null : parsePrice(priceText);
    if (price === 'invalid') {
      setError('Preis ist ungültig (z.B. 12,90).');
      return;
    }

    const newVariants: VariantOption[] = [];
    for (let i = 0; i < variants.length; i += 1) {
      const parsed = parsePrice(variantPrices[i] ?? '');
      if (parsed === 'invalid') {
        setError(`Preis für "${variants[i].name_de}" ist ungültig.`);
        return;
      }
      const { price: _old, ...rest } = variants[i];
      newVariants.push(parsed === null ? rest : { ...rest, price: parsed });
    }

    const newExtras: ExtraOption[] = [];
    for (let i = 0; i < extras.length; i += 1) {
      const parsed = parsePrice(extraPrices[i] ?? '');
      if (parsed === 'invalid') {
        setError(`Preis für Extra "${extras[i].name_de}" ist ungültig.`);
        return;
      }
      const { price: _old, ...rest } = extras[i];
      newExtras.push(parsed === null ? rest : { ...rest, price: parsed });
    }

    const payload = {
      name_hanzi: nameHanzi.trim() || null,
      name_de: trimmedDe,
      item_code: code.trim() || null,
      price,
      ...(hasVariants ? { variant_options: newVariants } : {}),
      ...(extras.length > 0 ? { extra_options: newExtras } : {}),
    };

    setSaving(true);
    setError(null);

    const result =
      state.mode === 'new'
        ? await supabase
            .from('menu_items')
            .insert({ ...payload, category_id: state.category.id, active: true })
            .select()
            .single()
        : await supabase.from('menu_items').update(payload).eq('id', item!.id).select().single();

    setSaving(false);

    if (result.error || !result.data) {
      const message = result.error?.message ?? 'Speichern fehlgeschlagen.';
      setError(
        message.includes('duplicate') || message.includes('unique')
          ? 'In dieser Kategorie gibt es schon ein Gericht mit diesem Namen (evtl. ausgeblendet — dort mit ↩️ wiederherstellen).'
          : message
      );
      return;
    }

    onSaved(result.data as MenuItem);
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.modalCard}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.modalEmoji}>
              {state.mode === 'new' ? '✨' : '✏️'} {categoryEmoji(state.category.name_de, state.category.menu_group)}
            </Text>
            <Text style={styles.modalTitle}>
              {state.mode === 'new' ? `Neu in ${titleCase(state.category.name_de)}` : 'Gericht bearbeiten'}
            </Text>

            <Text style={styles.fieldLabel}>Name (Deutsch) *</Text>
            <TextInput
              style={styles.input}
              value={nameDe}
              onChangeText={setNameDe}
              placeholder="z.B. Tonkotsu Ramen"
              placeholderTextColor={styles.placeholder.color as string}
            />
            <Text style={styles.fieldLabel}>Name (Hanzi) — für die Küche</Text>
            <TextInput
              style={styles.input}
              value={nameHanzi}
              onChangeText={setNameHanzi}
              placeholder="z.B. 豚骨拉面 (optional)"
              placeholderTextColor={styles.placeholder.color as string}
            />
            <View style={styles.fieldRow}>
              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>Code</Text>
                <TextInput
                  style={styles.input}
                  value={code}
                  onChangeText={setCode}
                  placeholder="z.B. R7"
                  placeholderTextColor={styles.placeholder.color as string}
                  autoCapitalize="characters"
                />
              </View>
              {!hasVariants && (
                <View style={styles.fieldHalf}>
                  <Text style={styles.fieldLabel}>Preis (€)</Text>
                  <TextInput
                    style={[styles.input, styles.priceInput]}
                    value={priceText}
                    onChangeText={setPriceText}
                    placeholder="0,00"
                    placeholderTextColor={styles.placeholder.color as string}
                    keyboardType="decimal-pad"
                  />
                </View>
              )}
            </View>

            {hasVariants && (
              <>
                <Text style={styles.sectionLabel}>Preis je Variante</Text>
                {variants.map((variant, index) => (
                  <View key={variant.name_de} style={styles.optionPriceRow}>
                    <Text style={styles.optionName} numberOfLines={1}>
                      {variant.name_hanzi ? `${variant.name_hanzi} · ` : ''}
                      {variant.name_de}
                    </Text>
                    <TextInput
                      style={[styles.input, styles.optionPriceInput]}
                      value={variantPrices[index] ?? ''}
                      onChangeText={(text) =>
                        setVariantPrices((prev) => prev.map((p, i) => (i === index ? text : p)))
                      }
                      placeholder="0,00"
                      placeholderTextColor={styles.placeholder.color as string}
                      keyboardType="decimal-pad"
                    />
                  </View>
                ))}
              </>
            )}

            {extras.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>Preis je Extra</Text>
                {extras.map((extra, index) => (
                  <View key={extra.name_de} style={styles.optionPriceRow}>
                    <Text style={styles.optionName} numberOfLines={1}>
                      ➕ {extra.name_hanzi ? `${extra.name_hanzi} · ` : ''}
                      {extra.name_de}
                    </Text>
                    <TextInput
                      style={[styles.input, styles.optionPriceInput]}
                      value={extraPrices[index] ?? ''}
                      onChangeText={(text) => setExtraPrices((prev) => prev.map((p, i) => (i === index ? text : p)))}
                      placeholder="0,00"
                      placeholderTextColor={styles.placeholder.color as string}
                      keyboardType="decimal-pad"
                    />
                  </View>
                ))}
              </>
            )}

            {error && <Text style={styles.errorText}>{error}</Text>}
            <TouchableOpacity
              style={[styles.primaryButton, (saving || !nameDe.trim()) && styles.primaryButtonDisabled]}
              onPress={save}
              disabled={saving || !nameDe.trim()}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>{state.mode === 'new' ? '✨ Anlegen' : '💾 Speichern'}</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelButton} onPress={onClose} disabled={saving}>
              <Text style={styles.cancelButtonText}>Abbrechen</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Protokoll
// ---------------------------------------------------------------------------

const KIND_META: Record<ActivityKind, { icon: string; label: string }> = {
  table_deleted: { icon: '🗑️', label: 'Tisch gelöscht' },
  item_deleted: { icon: '❌', label: 'Position entfernt' },
  discount_applied: { icon: '🏷️', label: 'Rabatt' },
};

function expiresIn(createdAt: string): string {
  const expiresAt = new Date(createdAt).getTime() + ACTIVITY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const hours = Math.max(0, Math.round((expiresAt - Date.now()) / (60 * 60 * 1000)));
  if (hours >= 24) return `noch ${Math.floor(hours / 24)} T ${hours % 24} h`;
  return `noch ${hours} h`;
}

function ActivityLog({ styles }: { styles: AdminStyles }) {
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ActivityKind | 'all'>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Zuerst Abgelaufenes endgültig löschen (Fallback ohne pg_cron), danach nur noch die
    // letzten 3 Tage laden — so taucht ein abgelaufener Eintrag auch dann nicht auf, falls
    // das Löschen selbst mal nicht klappt.
    await purgeExpiredActivity().catch(() => {});
    const { data, error: loadError } = await supabase
      .from('activity_log')
      .select('*')
      .gte('created_at', retentionCutoffIso())
      .order('created_at', { ascending: false });
    if (loadError) setError(loadError.message);
    else {
      setError(null);
      setEntries((data ?? []) as ActivityLogEntry[]);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = filter === 'all' ? entries : entries.filter((e) => e.kind === filter);

  const discountTotal = entries
    .filter((e) => e.kind === 'discount_applied')
    .reduce((sum, e) => sum + (e.amount ?? 0), 0);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <View style={styles.logHeader}>
        <Text style={styles.logRetention}>
          ⏱️ Einträge werden nach {ACTIVITY_RETENTION_DAYS} Tagen automatisch endgültig gelöscht.
        </Text>
        <TouchableOpacity
          style={styles.refreshButton}
          onPress={() => {
            setRefreshing(true);
            load();
          }}
          accessibilityLabel="Aktualisieren"
        >
          {refreshing ? <ActivityIndicator size="small" /> : <Text style={styles.iconButtonText}>🔄</Text>}
        </TouchableOpacity>
      </View>

      <View style={styles.filterRow}>
        {(['all', 'table_deleted', 'item_deleted', 'discount_applied'] as const).map((kind) => {
          const count = kind === 'all' ? entries.length : entries.filter((e) => e.kind === kind).length;
          const active = filter === kind;
          return (
            <TouchableOpacity
              key={kind}
              style={[styles.filterChip, active && styles.filterChipActive]}
              onPress={() => setFilter(kind)}
            >
              <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                {kind === 'all' ? 'Alle' : `${KIND_META[kind].icon} ${KIND_META[kind].label}`} ({count})
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {discountTotal !== 0 && (filter === 'all' || filter === 'discount_applied') && (
        <Text style={styles.logSummary}>🏷️ Rabatte gesamt (3 Tage): {formatPrice(discountTotal)}</Text>
      )}

      {error && <Text style={styles.errorText}>{error}</Text>}
      {visible.length === 0 && <Text style={styles.emptyText}>Keine Einträge in den letzten {ACTIVITY_RETENTION_DAYS} Tagen.</Text>}

      {visible.map((entry) => {
        const meta = KIND_META[entry.kind];
        const hasDetails = !!entry.details && entry.details.length > 0;
        const open = openId === entry.id;
        return (
          <TouchableOpacity
            key={entry.id}
            style={styles.logCard}
            onPress={() => hasDetails && setOpenId(open ? null : entry.id)}
            activeOpacity={hasDetails ? 0.7 : 1}
          >
            <View style={styles.logRow}>
              <Text style={styles.logIcon}>{meta.icon}</Text>
              <View style={styles.logText}>
                <Text style={styles.logSummaryText}>{entry.summary}</Text>
                <Text style={styles.logMeta}>
                  {formatDateTime(entry.created_at)}
                  {entry.table_number !== null ? ` · 🪑 Tisch ${entry.table_number}` : ''} · {expiresIn(entry.created_at)}
                </Text>
              </View>
              {entry.amount !== null && (
                <Text style={[styles.logAmount, entry.amount < 0 && styles.logAmountNegative]}>
                  {formatPrice(Number(entry.amount))}
                </Text>
              )}
            </View>
            {hasDetails && (
              <Text style={styles.logDetailsToggle}>
                {open ? '▾' : '▸'} {entry.details!.length} Positionen
              </Text>
            )}
            {open &&
              entry.details!.map((detail, index) => (
                <View key={index} style={styles.logDetailRow}>
                  <Text style={styles.logDetailName} numberOfLines={1}>
                    {detail.name}
                  </Text>
                  <Text style={styles.logDetailPrice}>{detail.price !== null ? formatPrice(detail.price) : '–'}</Text>
                </View>
              ))}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
    scroll: { flex: 1 },
    content: { padding: 16, width: '100%', maxWidth: 760, alignSelf: 'center', paddingBottom: 40 },
    placeholder: { color: colors.textFaint },
    errorText: { color: colors.danger, textAlign: 'center', marginVertical: 8 },
    emptyText: { textAlign: 'center', color: colors.textFaint, marginVertical: 20 },
    hint: { fontSize: 12, color: colors.textMuted, marginBottom: 12, lineHeight: 17 },
    // Tabs
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
    // PIN
    pinCard: {
      width: '85%',
      maxWidth: 340,
      backgroundColor: colors.surface,
      borderRadius: 22,
      padding: 24,
      borderWidth: 1,
      borderColor: colors.border,
    },
    pinEmoji: { fontSize: 44, textAlign: 'center' },
    pinTitle: { fontSize: 22, fontWeight: '800', color: colors.text, textAlign: 'center', marginTop: 6 },
    pinSub: { fontSize: 14, color: colors.textMuted, textAlign: 'center', marginBottom: 16 },
    pinInput: {
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: 12,
      paddingVertical: 12,
      fontSize: 24,
      letterSpacing: 8,
      textAlign: 'center',
      color: colors.text,
      marginBottom: 12,
    },
    // Buttons
    primaryButton: {
      backgroundColor: colors.accent,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: 8,
    },
    primaryButtonDisabled: { backgroundColor: colors.textFaint },
    primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '800' },
    cancelButton: { paddingVertical: 12, alignItems: 'center' },
    cancelButtonText: { fontSize: 15, color: colors.textMuted },
    iconButton: {
      width: 40,
      height: 40,
      borderRadius: 12,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 6,
    },
    iconButtonDanger: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
    iconButtonRestore: { backgroundColor: colors.successSurface },
    iconButtonText: { fontSize: 18 },
    // Speisekarte
    searchInput: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 15,
      color: colors.text,
      marginBottom: 8,
    },
    categoryCard: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 10,
      overflow: 'hidden',
    },
    categoryHeader: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 },
    categoryEmoji: { fontSize: 28 },
    categoryTitleWrap: { flex: 1 },
    categoryTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
    categorySub: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
    addButton: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    addButtonText: { color: '#fff', fontSize: 22, fontWeight: '800', lineHeight: 26 },
    chevron: { fontSize: 16, color: colors.textMuted, width: 16, textAlign: 'center' },
    hiddenLabel: {
      fontSize: 12,
      fontWeight: '800',
      color: colors.textMuted,
      paddingHorizontal: 12,
      paddingTop: 10,
      paddingBottom: 4,
    },
    itemRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    itemRowHidden: { opacity: 0.55 },
    itemMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
    codeBadge: {
      backgroundColor: colors.accentSurface,
      borderRadius: 8,
      paddingHorizontal: 8,
      paddingVertical: 3,
      minWidth: 38,
      alignItems: 'center',
    },
    codeBadgeText: { fontSize: 12, fontWeight: '800', color: colors.accent },
    itemText: { flex: 1 },
    itemName: { fontSize: 15, fontWeight: '700', color: colors.text },
    itemSub: { fontSize: 12, color: colors.textMuted },
    itemPrice: { fontSize: 14, fontWeight: '700', color: colors.text },
    itemPriceMissing: { color: colors.warning, fontWeight: '600' },
    // Editor
    modalOverlay: {
      flex: 1,
      backgroundColor: colors.overlay,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
    },
    modalCard: {
      backgroundColor: colors.surface,
      borderRadius: 22,
      padding: 20,
      width: '100%',
      maxWidth: 440,
      maxHeight: '92%',
    },
    modalEmoji: { fontSize: 32, textAlign: 'center' },
    modalTitle: { fontSize: 20, fontWeight: '800', color: colors.text, textAlign: 'center', marginBottom: 12 },
    fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 4, marginTop: 8 },
    sectionLabel: { fontSize: 13, fontWeight: '800', color: colors.textSecondary, marginTop: 16, marginBottom: 4 },
    input: {
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 16,
      color: colors.text,
      backgroundColor: colors.background,
    },
    priceInput: { textAlign: 'right', fontWeight: '700' },
    fieldRow: { flexDirection: 'row', gap: 10 },
    fieldHalf: { flex: 1 },
    optionPriceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
    optionName: { flex: 1, fontSize: 14, color: colors.text },
    optionPriceInput: { width: 96, textAlign: 'right', fontWeight: '700' },
    // Protokoll
    logHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
    logRetention: { flex: 1, fontSize: 12, color: colors.textMuted, lineHeight: 17 },
    refreshButton: {
      width: 40,
      height: 40,
      borderRadius: 12,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
    filterChip: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1.5,
      borderColor: 'transparent',
    },
    filterChipActive: { backgroundColor: colors.accentSurface, borderColor: colors.accent },
    filterChipText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
    filterChipTextActive: { color: colors.accent },
    logSummary: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginBottom: 10 },
    logCard: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 12,
      marginBottom: 8,
    },
    logRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    logIcon: { fontSize: 24 },
    logText: { flex: 1 },
    logSummaryText: { fontSize: 15, fontWeight: '700', color: colors.text },
    logMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
    logAmount: { fontSize: 15, fontWeight: '800', color: colors.text },
    logAmountNegative: { color: colors.danger },
    logDetailsToggle: { fontSize: 12, fontWeight: '700', color: colors.accent, marginTop: 8, marginLeft: 34 },
    logDetailRow: { flexDirection: 'row', justifyContent: 'space-between', marginLeft: 34, marginTop: 4 },
    logDetailName: { flex: 1, fontSize: 13, color: colors.textSecondary },
    logDetailPrice: { fontSize: 13, color: colors.textSecondary, marginLeft: 8 },
  });
