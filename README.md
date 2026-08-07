# YAMI Dashboard

Digitales Bestellsystem für die Kommunikation Bedienung → Küche/Bar. Kein Zusammenhang mit
dem bestehenden Kassensystem. 


## Troubleshooting: Schema-Änderungen auf einem bestehenden Supabase-Projekt

`schema.sql` nutzt überall `create table if not exists` — das ist super für ein neues
Projekt, greift aber NICHT mehr, sobald die Tabelle schon existiert. Neue Spalten,
Constraints oder Policies, die später zu `schema.sql` hinzukommen, landen dann nie
automatisch in einer bereits laufenden Datenbank. Symptome: "could not find the 'x'
column ... in the schema cache", "new row violates row-level security policy", oder
"there is no unique or exclusion constraint matching the ON CONFLICT specification".

Fix: den neuen Teil von `schema.sql` (fehlende Spalte, Constraint oder Policy) einmalig
manuell im SQL Editor nachziehen, z.B. `alter table ... add column if not exists ...`
oder `alter table ... add constraint ...`. Bei Unique-Constraints vorher prüfen, ob
wegen eines früheren, nicht-idempotenten `seed.sql`-Laufs schon Duplikate in der Tabelle
stehen — die blockieren den Constraint. Da es sich um ein Vor-Launch-Projekt ohne echte
Bestelldaten handelt, ist im Zweifel `truncate table order_items, orders, menu_items,
categories, tables restart identity cascade;` gefolgt von einem kompletten `schema.sql`+
`seed.sql`-Lauf der schnellste, sichere Reset.

Nach jeder Schema-Änderung: in Supabase unter Project Settings → API → "Reload schema
cache" klicken (oder `NOTIFY pgrst, 'reload schema';` im SQL Editor), falls die App die
neue Spalte trotz korrektem Schema nicht sieht.

## Projektstruktur

```
App.tsx            # Einstieg: NavigationContainer + RootNavigator
src/
  lib/
    supabase.ts     # Supabase-Client (liest EXPO_PUBLIC_SUPABASE_* aus .env)
  types/
    database.ts     # Spiegelt supabase/schema.sql
    role.ts          # Geräte-Rollen (order/kitchen/bar/status)
  navigation/
    RootNavigator.tsx
    types.ts
  screens/
    RoleSelectScreen.tsx
    order/OrderScreen.tsx          # Kategorien → Items → Warenkorb → Tisch → senden
    kitchen/KitchenScreen.tsx      # nutzt DeviceTicketBoard (target_device='kitchen')
    bar/BarScreen.tsx              # nutzt DeviceTicketBoard (target_device='bar')
    status/StatusScreen.tsx        # Tisch-Fortschritt über Küche+Bar kombiniert
  components/
    DeviceTicketBoard.tsx  # geteilte Offen/Fertig-Ticket-Ansicht für Küche & Bar
  hooks/
    useMenu.ts             # Kategorien + aktive Items für die Bestellaufnahme
    useDeviceOrders.ts     # Realtime order_items gefiltert nach target_device
supabase/
  schema.sql
  seed.sql
```
