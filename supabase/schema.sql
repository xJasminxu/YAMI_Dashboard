-- YAMI Dashboard — Schema
-- Auszuführen im Supabase-Projekt (SQL Editor) oder via `supabase db push`.
--
-- Diese Datei ist inzwischen ein "lebendes" Migrationsskript: sie wird gegen ein
-- bestehendes Projekt erneut eingespielt, wenn sich das Schema ändert, nicht nur einmal
-- gegen eine leere Datenbank. Deshalb ist jede Anweisung bewusst idempotent gehalten
-- (create ... if not exists, alter ... add column if not exists, drop policy if exists
-- vor jedem create policy, etc.) — beliebig oft erneut ausführbar, ohne Fehler wegen
-- bereits existierender Objekte. Neue Spalten an bestehenden Tabellen NICHT nur in den
-- ursprünglichen "create table"-Block schreiben (der greift nur bei der allerersten
-- Ausführung) — stattdessen eine eigene "alter table ... add column if not exists"-
-- Anweisung ergänzen (siehe kitchen_station unten als Beispiel).

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- categories
-- Eine Kategorie ist ein Menü-Button in der Bestellaufnahme (z.B. "Ramen").
-- target_device bestimmt, welches Gerät (Küche/Bar) diese Kategorie sieht.
-- sort_order bestimmt die Reihenfolge auf dem Küchen-/Bar-Ticket
-- (NICHT die Button-Reihenfolge in der Bestellaufnahme).
-- ---------------------------------------------------------------------------
create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name_hanzi text not null,
  name_de text not null,
  menu_group text not null check (menu_group in ('essen', 'getraenke', 'nachspeisen')),
  target_device text not null check (target_device in ('kitchen', 'bar')),
  sort_order int not null,
  created_at timestamptz not null default now(),
  unique (name_de) -- ermöglicht idempotentes Seeding via ON CONFLICT
);

-- Migration: name_hanzi war ursprünglich not null, ist aber an der Bar (Getränke +
-- Nachspeisen) gar nicht nötig — dort wird auf Deutsch gearbeitet, Hanzi ist primär für
-- die Küche (siehe seed.sql, wo Bar-Kategorien jetzt name_hanzi=null bekommen).
-- "drop not null" ist idempotent: ist die Spalte schon nullable, passiert einfach nichts.
alter table categories alter column name_hanzi drop not null;

-- Migration: kitchen_station-Spalte (nachträglich hinzugefügt). Nur für
-- target_device='kitchen' relevant: steuert die Zwei-Spalten-Ansicht auf dem Küchen-
-- Screen (Vorspeise-Spalte links, Hauptspeise+Barbecue-Spalte rechts), damit eine neu
-- eingegangene Bestellung mit ihren Vorspeisen nicht hinter einer bereits laufenden
-- großen Bestellung "versteckt" ist (siehe DeviceTicketBoard.tsx). Bei Bar-Kategorien
-- immer null, dort gibt es keine Spalten-Aufteilung.
alter table categories add column if not exists kitchen_station text
  check (kitchen_station in ('vorspeise', 'hauptspeise', 'barbecue'));

-- Migration: is_discount-Spalte (nachträglich hinzugefügt). Markiert die "Rabatt"-
-- Kategorie (siehe seed.sql) — ihre Positionen sind Preis-Abzüge, die die Bedienung im
-- Bestell-Screen mit Beschreibung + Betrag hinzufügt, keine zuzubereitenden Gerichte/
-- Getränke. DeviceTicketBoard.tsx blendet Positionen aus is_discount-Kategorien deshalb
-- aus den Küchen-/Bar-Tickets aus; in der Tischübersicht/vorläufigen Abrechnung
-- (TableBillingScreen.tsx etc.) bleiben sie sichtbar, damit der Rabatt vom Gesamtbetrag
-- abgezogen wird.
alter table categories add column if not exists is_discount boolean not null default false;

-- ---------------------------------------------------------------------------
-- menu_items
-- Konkrete Gerichte/Getränke innerhalb einer Kategorie.
-- ---------------------------------------------------------------------------
create table if not exists menu_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories(id) on delete restrict,
  name_hanzi text, -- nullable: manche Getränke (Markennamen wie "Jägermeister") haben keine Hanzi-Übersetzung
  name_de text not null,
  item_code text, -- Code von der gedruckten Speisekarte (z.B. "R1", "K4a"), optional
  active boolean not null default true,
  -- Preis in Euro. Nur zur Referenz für die Bedienung/Gäste — diese App macht weiterhin
  -- keine Rechnungen/Zahlungen, das bleibt Aufgabe des bestehenden Kassensystems.
  -- null, wenn für dieses Item noch kein Preis vorliegt.
  -- Bei Items mit variant_options, deren Preis von der Variante abhängt (z.B. Fried
  -- Chicken 4/8 Stück), bleibt price hier null — der Preis steckt dann im jeweiligen
  -- variant_options-Eintrag (siehe unten).
  price numeric(6,2),
  -- Auswahl-Varianten (z.B. Rind/Huhn bei Ajitama-Ramen, oder 4/8 Stück bei Fried Chicken
  -- inkl. eigenem Preis pro Variante). null/leer = kein Dialog beim Bestellen.
  -- Form: [{"name_hanzi": "牛肉", "name_de": "Rind"}, ...] oder mit "price": 6.40
  variant_options jsonb,
  -- Extras mit +/- Mengenauswahl im selben Bestell-Dialog (z.B. Ajitama Eier, Mais bei
  -- Ramen), jeweils mit eigenem Preis pro Portion/Einheit.
  -- Form: [{"name_hanzi": "玉米", "name_de": "Mais", "price": 1.00}, ...]
  extra_options jsonb,
  -- true = "Diverses"-Sammelposten (ein Item pro diverses-Kategorie). Statt der
  -- normalen Varianten/Extras-Auswahl öffnet OrderScreen.tsx hierfür einen Dialog
  -- mit Freitext-Beschreibung + manuell eingegebenem Preis.
  is_custom_entry boolean not null default false,
  created_at timestamptz not null default now(),
  unique (category_id, name_de) -- ermöglicht idempotentes Seeding via ON CONFLICT
);

create index if not exists menu_items_category_id_idx on menu_items(category_id);

-- ---------------------------------------------------------------------------
-- tables (Restauranttische)
-- ---------------------------------------------------------------------------
create table if not exists tables (
  id uuid primary key default gen_random_uuid(),
  number int not null unique
);

-- ---------------------------------------------------------------------------
-- orders
-- Eine "Bestellrunde" für einen Tisch. Mehrere Bestellungen pro Tisch über den
-- Abend hinweg sind möglich (z.B. Nachbestellung).
-- ---------------------------------------------------------------------------
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references tables(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists orders_table_id_idx on orders(table_id);

-- Migration: closed_at-Spalte (nachträglich hinzugefügt). null = Bestellung läuft noch
-- (zählt für Küche/Bar/Status/Tischübersicht als "aktueller Tisch"). Gesetzt, sobald die
-- Bedienung in TableBillingScreen.tsx "Tisch abschließen" antippt — der Tisch verschwindet
-- dadurch aus Küche/Bar/Status und ist sofort wieder frei für neue Gäste (neue orders-Zeile
-- für dieselbe Tischnummer bekommt wieder closed_at=null), OHNE dass die Bestellung
-- gelöscht wird. TableOverviewScreen.tsx zeigt geschlossene Bestellungen weiterhin unter
-- "Vergangene Tische" an, damit man sie bei Rückfragen noch nachschlagen kann. Ein
-- echtes Löschen (delete auf orders) passiert nur noch beim Tagesabschluss
-- (RoleSelectScreen.tsx), unabhängig von closed_at.
alter table orders add column if not exists closed_at timestamptz;
create index if not exists orders_closed_at_idx on orders(closed_at);

-- ---------------------------------------------------------------------------
-- order_items
-- Einzelne Position innerhalb einer Bestellung. status wird von Küche/Bar
-- beim Antippen (Durchstreichen) auf 'fertig' gesetzt.
-- ---------------------------------------------------------------------------
create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  menu_item_id uuid not null references menu_items(id) on delete restrict,
  status text not null default 'offen' check (status in ('offen', 'fertig')),
  -- gewählte Variante (z.B. "Rind"), falls menu_items.variant_options gesetzt war. Sonst null.
  variant_hanzi text,
  variant_de text,
  -- gewählte Extras + Menge, falls menu_items.extra_options gesetzt war. Sonst null.
  -- Form: [{"name_hanzi": "玉米", "name_de": "Mais", "quantity": 2, "price": 1.00}, ...]
  extras jsonb,
  -- Preis für eine Portion Grundgericht/-getränk zum Zeitpunkt der Bestellung
  -- (Variantenpreis falls vorhanden, sonst menu_items.price), als Snapshot
  -- gespeichert statt live aus menu_items gelesen — sonst würde eine spätere
  -- Preisänderung in der Speisekarte rückwirkend alte Bestellungen verändern.
  -- Rein Referenz für die vorläufige Abrechnung in der App (siehe Tischübersicht),
  -- keine Rechnungsstellung — die tatsächliche Rechnung druckt die Kasse.
  unit_price numeric(6,2),
  -- Freitext-Notiz der Bedienung zu dieser Position (z.B. "ohne Zwiebeln", "Allergie").
  note text,
  created_at timestamptz not null default now(),
  done_at timestamptz
);

create index if not exists order_items_order_id_idx on order_items(order_id);
create index if not exists order_items_status_idx on order_items(status);

-- Migration: paid_method-Spalte (nachträglich hinzugefügt). null = Position ist in der
-- vorläufigen Abrechnung (TableBillingScreen.tsx) noch nicht als bezahlt markiert.
-- Gesetzt, sobald die Bedienung eine Auswahl per "Bezahlt" mit Karte oder Bargeld
-- markiert — bewusst in der DB statt nur als lokaler Screen-Zustand, damit die
-- Zahlungsart auch nach "Tisch abschließen" beim späteren Nachschlagen unter
-- "Vergangene Tische" noch sichtbar ist. Keine Buchung/Rechnung — dient weiterhin nur
-- der Orientierung, welcher Anteil später gegen Kartenleser/Kasse abgeglichen wird.
alter table order_items add column if not exists paid_method text
  check (paid_method in ('karte', 'bargeld'));

-- ---------------------------------------------------------------------------
-- Realtime: order_items und orders für Live-Updates auf Küche/Bar aktivieren.
-- (In Supabase: Database → Replication → Tabellen zur "supabase_realtime"
-- Publication hinzufügen, oder per SQL wie unten.)
-- "alter publication ... add table" hat kein "if not exists" — würde beim erneuten
-- Ausführen mit "relation is already member of publication" fehlschlagen, deshalb der
-- Existenz-Check über pg_publication_tables.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'order_items'
  ) then
    alter publication supabase_realtime add table order_items;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table orders;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- Für v1 (keine Nutzer-Logins, vertrauenswürdige Geräte im Restaurant-WLAN):
-- RLS aktivieren, aber mit offenen Policies für die Nutzung des anon-Keys.
-- Das ist bewusst permissiv — sobald es einen Login/Rollen-Konzept gibt,
-- sollten diese Policies verschärft werden.
-- ---------------------------------------------------------------------------
alter table categories enable row level security;
alter table menu_items enable row level security;
alter table tables enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;

-- "create policy" hat kein "if not exists" — jeweils vorher per "drop policy if
-- exists" räumen, damit dieser Block beliebig oft erneut ausführbar ist.
drop policy if exists "allow all read categories" on categories;
create policy "allow all read categories" on categories for select using (true);

drop policy if exists "allow all read menu_items" on menu_items;
create policy "allow all read menu_items" on menu_items for select using (true);

drop policy if exists "allow all read tables" on tables;
create policy "allow all read tables" on tables for select using (true);
drop policy if exists "allow all write tables" on tables;
create policy "allow all write tables" on tables for insert with check (true);
drop policy if exists "allow all update tables" on tables;
create policy "allow all update tables" on tables for update using (true);

drop policy if exists "allow all read orders" on orders;
create policy "allow all read orders" on orders for select using (true);
drop policy if exists "allow all write orders" on orders;
create policy "allow all write orders" on orders for insert with check (true);
drop policy if exists "allow all update orders" on orders;
create policy "allow all update orders" on orders for update using (true); -- für "Tisch abschließen" (closed_at)
drop policy if exists "allow all delete orders" on orders;
create policy "allow all delete orders" on orders for delete using (true); -- für Tagesabschluss

drop policy if exists "allow all read order_items" on order_items;
create policy "allow all read order_items" on order_items for select using (true);
drop policy if exists "allow all write order_items" on order_items;
create policy "allow all write order_items" on order_items for insert with check (true);
drop policy if exists "allow all update order_items" on order_items;
create policy "allow all update order_items" on order_items for update using (true);
drop policy if exists "allow all delete order_items" on order_items;
create policy "allow all delete order_items" on order_items for delete using (true); -- für Tagesabschluss (Cascade von orders)
