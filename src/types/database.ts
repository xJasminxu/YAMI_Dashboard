// Spiegelt supabase/schema.sql. Bei Schema-Änderungen synchron halten.

export type MenuGroup = 'essen' | 'getraenke' | 'nachspeisen';
export type TargetDevice = 'kitchen' | 'bar';
export type OrderItemStatus = 'offen' | 'fertig';
// Nur bei target_device='kitchen' gesetzt — steuert die Zwei-Spalten-Ansicht auf dem
// Küchen-Screen (siehe DeviceTicketBoard.tsx). Bei Bar-Kategorien immer null.
export type KitchenStation = 'vorspeise' | 'hauptspeise' | 'barbecue';
// Zahlungsart einer in TableBillingScreen.tsx als bezahlt markierten Position — nur zur
// Orientierung, welcher Anteil später gegen Kartenleser/Kasse abgeglichen wird.
export type PaymentMethod = 'karte' | 'bargeld';

export interface Category {
  id: string;
  // null bei Bar-Kategorien (Getränke/Nachspeisen) — dort wird auf Deutsch gearbeitet,
  // Hanzi ist primär für die Küche.
  name_hanzi: string | null;
  name_de: string;
  menu_group: MenuGroup;
  target_device: TargetDevice;
  sort_order: number;
  kitchen_station: KitchenStation | null;
  // true = Rabatt-Kategorie (siehe seed.sql) — Preis-Abzug statt zuzubereitendem
  // Gericht/Getränk. DeviceTicketBoard.tsx blendet ihre Positionen deshalb aus.
  is_discount: boolean;
  created_at: string;
}

export interface VariantOption {
  name_hanzi: string;
  name_de: string;
  price?: number;
}

export interface ExtraOption {
  name_hanzi: string;
  name_de: string;
  price?: number;
}

export interface SelectedExtra {
  name_hanzi: string;
  name_de: string;
  quantity: number;
  price: number | null;
}

export interface MenuItem {
  id: string;
  category_id: string;
  name_hanzi: string | null;
  name_de: string;
  item_code: string | null;
  active: boolean;
  price: number | null;
  variant_options: VariantOption[] | null;
  extra_options: ExtraOption[] | null;
  is_custom_entry: boolean;
  created_at: string;
}

export interface RestaurantTable {
  id: string;
  number: number;
  // Freitext-Notiz zum Tisch (z.B. "wartet auf Rechnung", "Allergie Erdnuss"), editierbar
  // in TableOverviewScreen.tsx — unabhängig von einzelnen Bestellrunden, siehe schema.sql.
  note: string | null;
}

export interface Order {
  id: string;
  table_id: string;
  created_at: string;
  // null = Bestellung läuft noch. Gesetzt beim "Tisch abschließen" in
  // TableBillingScreen.tsx (siehe schema.sql) — der Tisch bleibt dabei erhalten,
  // verschwindet aber aus Küche/Bar/Status/Tischübersicht und landet dort stattdessen
  // unter "Vergangene Tische". Echt gelöscht wird eine Bestellung erst beim
  // Tagesabschluss (RoleSelectScreen.tsx).
  closed_at: string | null;
}

export interface OrderItem {
  id: string;
  order_id: string;
  menu_item_id: string;
  status: OrderItemStatus;
  variant_hanzi: string | null;
  variant_de: string | null;
  extras: SelectedExtra[] | null;
  // Preis-Snapshot zum Bestellzeitpunkt (siehe schema.sql), für die vorläufige
  // Abrechnung in der Tischübersicht. Bei Items ohne hinterlegten Preis null.
  unit_price: number | null;
  note: string | null;
  created_at: string;
  done_at: string | null;
  // null = in der vorläufigen Abrechnung noch nicht als bezahlt markiert (siehe
  // TableBillingScreen.tsx). In der DB statt nur lokalem Screen-Zustand, damit die
  // Zahlungsart auch nach "Tisch abschließen" unter "Vergangene Tische" erhalten bleibt.
  paid_method: PaymentMethod | null;
}
