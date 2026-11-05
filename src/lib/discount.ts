import { formatPrice } from './pricing';
import { logActivity } from './activityLog';
import { supabase } from './supabase';

// Bucht einen Rabatt direkt auf einen offenen Tisch — aufgerufen aus der Tischübersicht
// (🏷️ je Tischkarte) und der Abrechnung (TableBillingScreen.tsx), früher lief das über
// den Warenkorb in der Bestellaufnahme. Technisch unverändert: eine order_items-Zeile auf
// dem Item der Rabatt-Kategorie (categories.is_discount, siehe seed.sql), Beschreibung in
// variant_de/variant_hanzi, Betrag als NEGATIVER unit_price. Direkt als "fertig" angelegt —
// ein Rabatt ist nichts zum Zubereiten (Küche/Bar blenden is_discount ohnehin aus, ohne
// done_at würde er aber z.B. die Fortschritts-Zählung im Status-Screen verfälschen).
// Hängt sich an die offene Bestellung des Tisches, oder legt eine neue an, falls (z.B.
// nach Tischwechsel) gerade keine läuft. Liefert eine Fehlermeldung oder null.
export async function applyTableDiscount({
  tableNumber,
  description,
  amount,
}: {
  tableNumber: number;
  description: string;
  amount: number;
}): Promise<string | null> {
  const value = Math.round(Math.abs(amount) * 100) / 100;
  if (!value) return 'Bitte einen Betrag größer 0 eingeben.';
  const label = description.trim() || 'Rabatt';

  const { data: rabattItem, error: itemError } = await supabase
    .from('menu_items')
    .select('id, category:categories!inner(is_discount)')
    .eq('category.is_discount', true)
    .limit(1)
    .maybeSingle();
  if (itemError) return itemError.message;
  if (!rabattItem) return 'Keine Rabatt-Kategorie in der Speisekarte gefunden (siehe seed.sql).';

  const { data: table, error: tableError } = await supabase
    .from('tables')
    .upsert({ number: tableNumber }, { onConflict: 'number' })
    .select()
    .single();
  if (tableError || !table) return tableError?.message ?? 'Tisch nicht gefunden.';

  const { data: openOrder, error: orderError } = await supabase
    .from('orders')
    .select('id')
    .eq('table_id', table.id)
    .is('closed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (orderError) return orderError.message;

  let orderId = openOrder?.id as string | undefined;
  if (!orderId) {
    const { data: newOrder, error: createError } = await supabase
      .from('orders')
      .insert({ table_id: table.id })
      .select('id')
      .single();
    if (createError || !newOrder) return createError?.message ?? 'Bestellung konnte nicht angelegt werden.';
    orderId = newOrder.id;
  }

  const { error: insertError } = await supabase.from('order_items').insert({
    order_id: orderId,
    menu_item_id: rabattItem.id,
    variant_hanzi: label,
    variant_de: label,
    unit_price: -value,
    status: 'fertig',
    done_at: new Date().toISOString(),
  });
  if (insertError) return insertError.message;

  logActivity({
    kind: 'discount_applied',
    tableNumber,
    summary: `Rabatt: ${label} (−${formatPrice(value)})`,
    amount: -value,
  });
  return null;
}
