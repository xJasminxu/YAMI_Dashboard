-- YAMI Dashboard — Schema
-- Auszuführen in einem neuen Supabase-Projekt (SQL Editor) oder via `supabase db push`.

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
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- menu_items
-- Konkrete Gerichte/Getränke innerhalb einer Kategorie.
-- ---------------------------------------------------------------------------
create table if not exists menu_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories(id) on delete restrict,
  name_hanzi text not null,
  name_de text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
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
  created_at timestamptz not null default now(),
  done_at timestamptz
);

create index if not exists order_items_order_id_idx on order_items(order_id);
create index if not exists order_items_status_idx on order_items(status);

-- ---------------------------------------------------------------------------
-- Realtime: order_items und orders für Live-Updates auf Küche/Bar aktivieren.
-- (In Supabase: Database → Replication → Tabellen zur "supabase_realtime"
-- Publication hinzufügen, oder per SQL wie unten.)
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table order_items;
alter publication supabase_realtime add table orders;

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

create policy "allow all read categories" on categories for select using (true);
create policy "allow all read menu_items" on menu_items for select using (true);
create policy "allow all read tables" on tables for select using (true);

create policy "allow all read orders" on orders for select using (true);
create policy "allow all write orders" on orders for insert with check (true);

create policy "allow all read order_items" on order_items for select using (true);
create policy "allow all write order_items" on order_items for insert with check (true);
create policy "allow all update order_items" on order_items for update using (true);
