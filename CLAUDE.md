# YAMI Dashboard — Restaurant-Bestellsystem

## Zweck

Digitalisierung der Bestellaufnahme in einem Restaurant. Ersetzt Zettel & Stift für den
Weg Bedienung → Küche/Bar. **Kein** Zusammenhang mit dem bestehenden Kassensystem — diese
App macht keine Preise, keine Rechnungen, keine Zahlungen. Sie sorgt nur dafür, dass eine
aufgenommene Bestellung sofort und übersichtlich bei Küche bzw. Bar ankommt, auf Chinesisch
(Hanzi, primär) mit Deutsch (sekundär), weil die Küchenmitarbeiter kein Deutsch sprechen.

Aktuelles Problem, das gelöst wird: Bestellungen werden auf Papier aufgenommen, dann manuell
in einer Kasse eingetippt, die nicht an die aktuelle Speisekarte angepasst ist → doppelte
Arbeit, Fehleranfälligkeit, keine Übersicht für die Küche, keine chinesische Beschriftung.

## Tech-Stack (entschieden)

- **Frontend:** React Native mit Expo, TypeScript
- **Backend/Realtime:** Supabase (Postgres + Realtime Subscriptions). Noch kein Supabase-
  Projekt angelegt — Schema liegt unter `supabase/schema.sql` bereit zum Ausführen, sobald
  ein Projekt existiert.
- **Navigation:** React Navigation
- **State/Data-Fetching:** Supabase JS Client + Realtime-Channel-Subscriptions, kein
  zusätzliches State-Management-Framework nötig (Datenmenge ist klein).

## Architekturprinzip: eine Codebase, drei/vier Rollen

Kein separates Repo pro Gerät. Eine App, beim Start (oder per Einstellung) wählt man die
Rolle des Geräts:

1. **Bestellung** (Bedienung nimmt auf) — Kategorien als Buttons, Warenkorb, Tisch wählen,
   Bestellung abschicken.
2. **Küche** — zeigt nur Items mit `target_device = 'kitchen'`.
3. **Bar** — zeigt nur Items mit `target_device = 'bar'`.
4. **Status** (optional, für Bedienungen) — Übersicht aller offenen Tische mit Fortschritt
   (z.B. "Tisch 4: 2/5 fertig"), gespeist aus denselben Realtime-Daten wie Küche/Bar.

Rollenwahl bestimmt nur Filter + Sortierung + UI-Layout, nicht das Datenmodell.

## Kategorien (Menü-Buttons in der Bestellaufnahme)

```
Essen
 - Kleinigkeiten
 - Fried Chicken
 - Warme Speisen
 - Ramen
 - Suppen
 - Nudeln
 - Korean BBQ

Getränke
 - Softgetränke  
 - Bier
 - Cocktails
 - alkoholfreie Cocktails

Nachspeisen
 - Mochi Eis
 - Eis
 - Eisschnee
```

Jede Kategorie hat einen `target_device` (`kitchen` oder `bar`) und einen `sort_order`, der
NICHT die Button-Reihenfolge in der Bestellaufnahme ist, sondern die Sortierung auf dem
Küchen-/Bar-Ticket bestimmt (siehe unten). Alle Items einer Kategorie erben `target_device`
und tragen zusätzlich Name auf Hanzi (primär) und Deutsch (sekundär).

## Sortierlogik auf den Ticket-Ansichten

**Küche:** Vorspeise → Hauptspeise → Barbecue
- Vorspeise: kleinigkeiten, fried chicken
- Hauptspeise: warme speisen, ramen, nudeln, suppen
- Barbecue: korean bbq

(Diese Gruppierung ist eine Annahme basierend auf der Kategorienliste — mit Nutzer
gegenchecken, insbesondere ob "suppen" wirklich als Vorspeise gilt.)

**Bar:** Softgetränke → Bier → Cocktails → Spirituosen → Kaffee/Matcha → Nachspeise
(siehe offene Frage oben zu Softgetränke/Bier)

Sortierung ist rein `sort_order`-Feld auf der `categories`-Tabelle, client-seitig angewendet.
Kein Backend-Logik nötig.

## Status-Workflow

1. Bedienung erstellt Bestellung → Zeilen in `order_items` mit `status = 'offen'`.
2. Küche/Bar sehen live (Realtime-Subscription) neue Zeilen, gefiltert nach `target_device`.
3. Tippen auf ein Item → `status = 'fertig'` (durchgestrichen dargestellt), `done_at` gesetzt.
4. Sobald alle Items einer Bestellung **für das jeweilige Gerät** fertig sind, wandert die
   Bestellung im UI (nicht in der DB als separate Tabelle) aus "offen" in "fertig" und landet
   in "Vergangene Bestellungen (Küche)" bzw. "(Bar)". Diese Berechnung passiert client-seitig
   aus dem Realtime-Stream — kein Extra-Feld/Trigger nötig, außer man will Performance später
   optimieren (dann `kitchen_done`/`bar_done` Spalten auf `orders` pflegen, die per Trigger
   gesetzt werden, sobald alle zugehörigen `order_items` fertig sind).

Wichtig: Küche und Bar haben unabhängige "fertig"-Zustände für dieselbe Bestellung (ein Tisch
kann in der Küche fertig sein, an der Bar aber noch nicht, oder umgekehrt).

## Datenmodell

Siehe `supabase/schema.sql` für die vollständige Definition. Kurzfassung:

- `categories` — name_hanzi, name_de, menu_group (essen/getraenke/nachspeisen), target_device
  (kitchen/bar), sort_order
- `menu_items` — category_id, name_hanzi, name_de, active
- `tables` — number
- `orders` — table_id, created_at
- `order_items` — order_id, menu_item_id, status (offen/fertig), created_at, done_at

Keine Preise, keine Nutzer-/Auth-Tabellen im ersten Wurf (Geräte sind vertrauenswürdig,
kein Login nötig für v1).

## Empfohlene Bau-Reihenfolge

1. Expo-Projekt mit TypeScript scaffolden (`npx create-expo-app`), Supabase-Client
   einrichten, `.env` mit Projekt-URL/Key.
2. Supabase-Projekt anlegen, `supabase/schema.sql` ausführen, `supabase/seed.sql` (nach
   Klärung der offenen Fragen) einspielen.
3. Rollenauswahl-Screen (Bestellung/Küche/Bar/Status).
4. Bestell-Screen: Kategorie-Buttons (gruppiert essen/getränke/nachspeisen) → Item-Auswahl
   → Warenkorb → Tisch wählen → absenden.
5. Küchen-Screen: Tabs "offen"/"fertig", Karten pro Tisch, Items sortiert nach
   Vorspeise/Hauptspeise/Barbecue, Antippen zum Durchstreichen.
6. Bar-Screen: gleiche Mechanik, andere Kategorien/Sortierung.
7. "Vergangene Bestellungen"-Ansichten für Küche und Bar.
8. (Optional) Status-Screen für Bedienungen.

## Nicht-Ziele (bewusst weggelassen für v1)

- Keine Kassenintegration, keine Preise, keine Zahlungen
- Kein Nutzer-Login/Rollen-Auth (kann später ergänzt werden)
- Keine Offline-Fähigkeit in v1 (spätere Überlegung: lokaler Server statt Cloud-Supabase,
  falls Internetverbindung im Restaurant unzuverlässig ist)
