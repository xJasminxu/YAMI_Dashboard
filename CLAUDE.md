# YAMI Dashboard — Restaurant-Bestellsystem

## Zweck

Digitalisierung der Bestellaufnahme in einem Restaurant. Ersetzt Zettel & Stift für den
Weg Bedienung → Küche/Bar. **Kein** Zusammenhang mit dem bestehenden Kassensystem — diese
App macht keine Rechnungen und keine Zahlungen, das bleibt Aufgabe der Kasse. Preise werden
seit Kurzem als Referenz für Bedienung/Gäste in der Bestellaufnahme angezeigt (siehe
Datenmodell), aber nicht auf den Küchen-/Bar-Tickets — dort zählt nur, was zubereitet werden
muss. Die App sorgt vor allem dafür, dass eine aufgenommene Bestellung sofort und
übersichtlich bei Küche bzw. Bar ankommt, auf Chinesisch (Hanzi, primär) mit Deutsch
(sekundär), weil die Küchenmitarbeiter kein Deutsch sprechen.

Aktuelles Problem, das gelöst wird: Bestellungen werden auf Papier aufgenommen, dann manuell
in einer Kasse eingetippt, die nicht an die aktuelle Speisekarte angepasst ist → doppelte
Arbeit, Fehleranfälligkeit, keine Übersicht für die Küche, keine chinesische Beschriftung.

## Tech-Stack (entschieden)

- **Frontend:** React Native mit Expo, TypeScript
- **Backend/Realtime:** Supabase (Postgres + Realtime Subscriptions). Projekt existiert
  bereits; `supabase/schema.sql` wird als lebendes, idempotentes Migrationsskript erneut
  eingespielt, wenn sich das Schema ändert (siehe Kommentar am Dateianfang) — neue Spalten
  also nicht nur in den ursprünglichen `create table`-Block schreiben, sondern zusätzlich
  per `alter table ... add column if not exists` ergänzen, sonst greift die Änderung nicht
  bei einer bereits bestehenden Tabelle.
- **Navigation:** React Navigation
- **State/Data-Fetching:** Supabase JS Client + Realtime-Channel-Subscriptions, kein
  zusätzliches State-Management-Framework nötig (Datenmenge ist klein).

## Architekturprinzip: eine Codebase, fünf Rollen

Kein separates Repo pro Gerät. Eine App, beim Start (oder per Einstellung) wählt man die
Rolle des Geräts:

1. **Bestellung** (Bedienung nimmt auf) — Kategorien als Buttons, Warenkorb, Tisch wählen,
   Bestellung abschicken.
2. **Küche** — zeigt nur Items mit `target_device = 'kitchen'`. Sowohl der "Offen"- als auch
   der "Vergangene Bestellungen"-Tab sind in drei unabhängig scrollbare Spalten aufgeteilt
   (Vorspeise | Hauptspeise | Barbecue, siehe `categories.kitchen_station`), damit eine
   große laufende Bestellung nicht die Positionen einer anderen Spalte unter sich
   verschwinden lässt. Vorspeise und Hauptspeise sind standardmäßig gleich breit; Barbecue
   ist schmaler (kurze Gerichtenamen, nur eine Karte pro Zeile statt zwei) — anders als bei
   der Bar, wo stattdessen Getränke die breiteste Spalte ist (siehe unten). Diese Breiten
   sind aber nur der Startzustand: die Trennlinien zwischen den Spalten lassen sich per
   Drag verschieben (`DeviceTicketBoard.tsx`, `stationRatios`), falls z.B. eine Station an
   einem Abend besonders viel zu tun hat — die zuletzt eingestellte Aufteilung wird pro
   Gerät gemerkt. Zusätzlich lässt sich die Kartengröße über zwei "−"/"+"-Buttons neben der
   Stummschalt-Glocke umschalten, falls der Koch lieber mehr Gerichte auf einen Blick sehen
   will statt möglichst großer, aus der Distanz lesbarer Schrift. Innerhalb einer Station
   wandert eine einzelne abgehakte Position sofort von der Offen- in die Vergangene-
   Bestellungen-Karte, statt erst wenn ALLE Positionen dieser Station fertig sind — eine
   fertige Position blockiert so keinen Platz mehr in der Offen-Karte, den eine neu
   eingehende Bestellung bräuchte. Dieselbe Bestellung kann dadurch gleichzeitig als Offen-
   UND Vergangene-Bestellungen-Karte in derselben Station auftauchen (z.B. 2 von 3
   Hauptspeisen schon fertig, die dritte noch offen). Vorher gab es dafür nur eine einzige
   "Fertig"-Liste, die eine Bestellung erst zeigte, wenn wirklich ALLE Stationen komplett
   fertig waren — eine fertige Vorspeise blieb so lange nirgends sichtbar. Ein dritter Tab
   "Komplett" zeigt zusätzlich jedes Tisch-Ticket unfragmentiert als eine einzelne Karte mit
   allen Positionen aller Stationen zusammen (jede Position mit ihrem eigenen Offen/Fertig-
   Status) — für den Fall, dass jemand den kompletten Stand eines Tisches auf einen Blick
   braucht, statt ihn aus den einzelnen Stationen-Spalten zusammenzusuchen. Ein vierter Tab
   "Anzahl" fasst zusätzlich alle noch offenen
   Positionen jeder Station zu einer nach Menge sortierten Stückzahl-Liste zusammen (z.B.
   "5× Gyoza") statt einzelner Ticket-Karten, gruppiert nach Gericht + Variante (Extras
   fließen nicht mit ein) — damit die Küche bei vielen gleichen Bestellungen (z.B. mehrere
   Gyoza-Bestellungen gleichzeitig) direkt in einem Rutsch nachbraten kann, ohne selbst über
   die Ticket-Karten zu zählen. Abgehakt wird weiterhin nur über die Ticket-Karten im
   "Offen"-Tab (oder im "Komplett"-Tab), der "Anzahl"-Tab selbst ist reine Zähl-Hilfe ohne
   Tipp-Interaktion.
3. **Bar** — zeigt nur Items mit `target_device = 'bar'`. Statt eines umschaltbaren
   "Fertig"-Tabs stehen hier immer drei Spalten nebeneinander: Getränke | Nachspeisen |
   Vergangene Bestellungen (siehe `categories.menu_group`), aus demselben
   Grund wie bei der Küche — plus die Historie immer sichtbar, damit man nicht extra
   umschalten muss. Getränke ist standardmäßig die breiteste Spalte, Vergangene
   Bestellungen die schmalste — auch hier per Drag an den Trennlinien verschiebbar, siehe
   Küche oben. Ein "Offen"/"Anzahl"-Tab (Deutsch-only, ohne Hanzi-Zeile) schaltet zusätzlich
   um, ob Getränke und Nachspeisen als Ticket-Karten oder — analog zum Anzahl-Tab der Küche
   — als nach Menge sortierte Stückzahl-Liste (z.B. "5× Cola") angezeigt werden; die dritte
   Spalte (Vergangene Bestellungen) bleibt davon unberührt und zeigt in beiden Tabs
   weiterhin Ticket-Karten.
4. **Status** (optional, für Bedienungen) — Übersicht aller **offenen** Tische mit
   Fortschritt (z.B. "Tisch 4: 2/5 fertig"), gespeist aus denselben Realtime-Daten wie
   Küche/Bar.
5. **Tischübersicht** (für Bedienungen) — Übersicht **aller** Tische mit Bestellungen von
   heute (auch bereits fertige, anders als Status — die werden ja gerade erst abgerechnet).
   Tippen auf einen Tisch öffnet die Bestellübersicht mit vorläufiger Abrechnung: einzelne
   Positionen sind per Checkbox auswählbar (z.B. für getrennte Rechnungen), die Summe der
   Auswahl wird live berechnet. Rein zur Orientierung für die Bedienung — es wird nichts
   gebucht oder gespeichert; die verbindliche Rechnung druckt weiterhin die Kasse.
   "Vergangene Tische" (bereits per "Tisch abschließen" geschlossene Bestellungen, siehe
   Status-Workflow unten) werden NICHT pro Tischnummer zu einer Sammelkarte zusammengefasst
   — wird derselbe Tisch am selben Tag mehrfach besetzt und jeweils abgeschlossen (z.B.
   Tisch 3 dreimal), erscheint jede Besetzung als eigener Eintrag mit ihrer eigenen
   Abschlusszeit, sortiert nach Abschlusszeit (neueste zuerst). Grund: eine Sammelkarte mit
   summierter Rechnung über mehrere, komplett unabhängige Besetzungen war nicht
   nachvollziehbar. Technisch erkennbar an `orders.closed_at`: "Tisch abschließen" setzt
   ihn per einem einzigen Update auf alle zu diesem Zeitpunkt offenen orders derselben
   Tischnummer, alle orders einer Besetzung tragen also exakt denselben Zeitstempel — der
   dient als Gruppierungsschlüssel (Tischnummer + closed_at) statt nur der Tischnummer
   allein.

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
 - Alkoholfreie Getränke
 - Bier
 - Cocktails
 - Spirituosen (inkl. Soju, Makgeolli)
 - Wein (Rot: Merlot, Primitivo, Dornfelder; Weiß: Pinot, Chardonnay, Riesling —
   0,2L-Glas 5,90€ für beide, Flasche 28,00€ rot / 26,00€ weiß)
 - Kaffee/Tee/Matcha

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


**Bar:** Alkoholfreie Getränke → Bier → Cocktails → Spirituosen → Wein → Kaffee/Tee/Matcha
→ Nachspeise (Mochi Eis → Eis → Eisschnee). Soju und Makgeolli stehen unter Spirituosen
(die frühere eigene "Schnaps"-Kategorie wurde aufgelöst).

Sortierung ist rein `sort_order`-Feld auf der `categories`-Tabelle, client-seitig angewendet.
Kein Backend-Logik nötig.

## Mehr-Spalten-Ansicht (Küche: Stationen, Bar: Getränke/Nachspeisen)

Unabhängig von `sort_order` (das nur die Reihenfolge *innerhalb* einer Ticket-Karte
bestimmt) hat jede Küchen-Kategorie zusätzlich ein `kitchen_station`-Feld
(`vorspeise` | `hauptspeise` | `barbecue`), das dieselbe Vorspeise/Hauptspeise/Barbecue-
Gruppierung wie oben abbildet. `DeviceTicketBoard.tsx` nutzt es, um im "Offen"-Tab der
Küche drei separate Spalten zu rendern (Vorspeise | Hauptspeise | Barbecue), jede mit
eigenen Ticket-Karten und eigenem Fortschritt (eine Bestellung kann in der Vorspeise-Spalte
schon grün sein, während ihre Hauptspeise-Karte noch offen ist). Vorspeise und Hauptspeise
sind gleich breit (`stationColumn`, kein `stationColumnWide` wie bei der Bar) — auch wenn in
Hauptspeise (Ramen, Nudeln, Reisgerichte, Suppen) erfahrungsgemäß am meisten zusammenläuft,
soll keine der beiden Spalten auf Kosten der anderen wachsen. Barbecue daneben ist bewusst
schmaler (`stationColumnNarrow`, nur eine Karte pro Zeile statt zwei) — die
Gerichtenamen dort sind kurz, eine volle Drittel-Breite würde nur Leerraum verschenken.
Grund für die Aufteilung insgesamt: ohne sie verschwanden
Vorspeisen und Barbecue-Bestellungen leicht unter einer bereits laufenden großen
Hauptspeise-Bestellung, obwohl Vorspeisen oft sofort losgehen könnten und Barbecue eine
eigene Zubereitungsstation ist. Bar-Kategorien haben `kitchen_station = null` und sind von
dieser Aufteilung nicht betroffen.

Die Bar hat stattdessen dieselbe Mehr-Spalten-Idee, aber getrennt nach `menu_group`
(Getränke | Nachspeisen) statt nach `kitchen_station` — Bar-Kategorien haben kein
`kitchen_station`, aber `menu_group` ist ohnehin schon auf jeder Kategorie vorhanden, ein
eigenes Feld war dafür nicht nötig. Aus demselben Grund wie bei der Küche: ohne die
Trennung verschwinden neu eingegangene Getränke leicht unter einer bereits laufenden
großen Nachspeisen-Bestellung (oder umgekehrt); Getränke ist entsprechend die breitere der
beiden offenen Spalten. Anders als die Küche hat die Bar zusätzlich keinen umschaltbaren
"Fertig"-Tab mehr — Vergangene Bestellungen steht bei ihr immer als dritte, schmalere
Spalte direkt daneben, damit man dafür nicht extra umschalten muss. Alle offenen Spalten
(Küche wie Bar) zeigen ihre Ticket-Karten außerdem als Zwei-Spalten-Kartenraster
(`columns={2}` in `TicketList`) statt einer einzelnen tief scrollenden Liste, damit auf
einen Blick mehr offene Tickets sichtbar sind. Bei der Bar fällt eine Karte aus ihrer Spalte
raus, sobald alle Positionen *dieser* Spalte abgehakt sind (`itemsMatching`) — unabhängig
davon, ob die Bestellung insgesamt (in einer anderen Spalte) noch offen ist. Bei der Küche
geht das seit Kurzem noch granularer: dort fällt eine EINZELNE Position bereits beim
Abhaken sofort aus der Offen-Karte raus, nicht erst wenn alle Positionen dieser Station
fertig sind (`stationOpenOnly`), damit eine bereits fertige Position keinen Platz in der
Offen-Karte blockiert, den eine neu eingehende Bestellung bräuchte. Auch der "Vergangene
Bestellungen"-Tab ist bei der Küche in dieselben drei Stationen-Spalten aufgeteilt (nicht
mehr nur der "Offen"-Tab): sobald eine einzelne Position einer Station abgehakt wird,
erscheint sie im selben Moment als EIGENE Karte in der Vergangene-Bestellungen-Spalte
derselben Station (`stationDoneItems`) — nicht zusammen mit anderen fertigen Positionen
derselben Bestellung in einer Sammelkarte —, sortiert nach individueller Abhak-Zeit
(neueste zuerst), unabhängig vom Fortschritt der übrigen Positionen dieser Station oder
anderer Stationen. Grund für die Aufsplittung in einzelne Karten statt einer Sammelkarte:
Köche haken gelegentlich aus Versehen die falsche Position ab — als eigene, ganz oben
stehende Karte ist sofort erkennbar, welche das war, statt sie erst in einer Sammelkarte
mit mehreren Positionen suchen zu müssen, um sie durch erneutes Antippen zurück auf "offen"
zu setzen. Dieselbe Bestellung kann so gleichzeitig z.B. unter "Vergangene Bestellungen →
Hauptspeise" (die schon fertige Position, als eigene Karte) UND "Offen → Hauptspeise" (die
noch offene Position derselben Bestellung) auftauchen — beide siehe `DeviceTicketBoard.tsx`.

## Status-Workflow

1. Bedienung erstellt Bestellung → Zeilen in `order_items` mit `status = 'offen'`.
2. Küche/Bar sehen live (Realtime-Subscription) neue Zeilen, gefiltert nach `target_device`.
3. Tippen auf ein Item → `status = 'fertig'` (durchgestrichen dargestellt), `done_at` gesetzt.
4. Sobald alle Items einer Bestellung **für das jeweilige Gerät** fertig sind, wandert die
   Bestellung im UI (nicht in der DB als separate Tabelle) aus "offen" in "fertig" und landet
   in "Vergangene Bestellungen (Bar)". Bei der Küche passiert dieser Wechsel pro Position
   einzeln (siehe Mehr-Spalten-Ansicht oben): sobald EINE Position einer Bestellung
   abgehakt wird, erscheint genau diese Position sofort in "Vergangene Bestellungen →
   [Station]", auch wenn andere Positionen derselben Station oder derselben Bestellung noch
   offen sind. Diese Berechnung passiert client-seitig aus dem Realtime-Stream — kein
   Extra-Feld/Trigger nötig, außer man will Performance später optimieren (dann
   `kitchen_done`/`bar_done` Spalten auf `orders` pflegen, die per Trigger gesetzt werden,
   sobald alle zugehörigen `order_items` fertig sind).

Wichtig: Küche und Bar haben unabhängige "fertig"-Zustände für dieselbe Bestellung (ein Tisch
kann in der Küche fertig sein, an der Bar aber noch nicht, oder umgekehrt).

## Tagesabschluss

Button auf dem Rollenauswahl-Screen (mit Bestätigungsdialog, da destruktiv). Löscht per
`delete` auf `orders` alle Bestellungen des Tages — `order_items` hängt per `on delete cascade`
daran und wird automatisch mitgelöscht. Parallel dazu wird `tables.note` (siehe Datenmodell)
für alle Tische auf `null` gesetzt — anders als "Tisch abschließen" (dort bleibt die Notiz
bewusst erhalten), soll der Tagesabschluss wirklich bei null anfangen. `categories`,
`menu_items` und die Tische selbst (Tischnummern) bleiben unangetastet. Setzt damit
Küche/Bar/Status wieder auf "keine offenen Bestellungen" zurück, ohne die Speisekarte neu
einspielen zu müssen.

## Datenmodell

Siehe `supabase/schema.sql` für die vollständige Definition. Kurzfassung:

- `categories` — name_hanzi, name_de, menu_group (essen/getraenke/nachspeisen), target_device
  (kitchen/bar), sort_order
- `menu_items` — category_id, name_hanzi, name_de, item_code (optional, von der
  gedruckten Speisekarte, z.B. "R1"), active, price (Referenzpreis in Euro, optional —
  null bei Items ohne hinterlegten Preis oder wenn der Preis von der Variante abhängt),
  variant_options (Pflichtauswahl beim Bestellen, z.B. Rind/Huhn), extra_options
  (optionale Extras mit +/- Menge im selben Dialog, z.B. bei Ajitama-Ramen)
- `tables` — number
- `orders` — table_id, created_at
- `order_items` — order_id, menu_item_id, status (offen/fertig), variant_hanzi/variant_de
  (gewählte Variante), extras (gewählte Extras + Menge + Preis), unit_price (Preis-Snapshot
  der Grundposition zum Bestellzeitpunkt, siehe unten), note (Freitext der Bedienung),
  created_at, done_at

Modifier-Konzept (Varianten + Extras): manche `menu_items` verlangen beim Bestellen eine
Dialog-Auswahl statt direkt in den Warenkorb zu wandern. `variant_options` ist eine Pflicht-
Einfachauswahl (z.B. Rind/Huhn, oder 4/8 Stück bei Fried Chicken), `extra_options` sind
optionale Zusatz-Items mit +/- Menge (z.B. Ajitama Eier, Mais). Beides wird als JSON auf dem
`menu_items`-Eintrag gepflegt; die getroffene Auswahl landet 1:1 auf der zugehörigen
`order_items`-Zeile (nicht als eigene Zeilen), damit Küche/Bar Variante und Extras direkt
neben dem Gericht sehen. Sowohl `variant_options`- als auch `extra_options`-Einträge können
zusätzlich ein `price`-Feld tragen (z.B. Fried Chicken: 4 Stück / 8 Stück haben je einen
eigenen Preis) — dann bleibt `menu_items.price` selbst null, weil der Preis erst durch die
Variante feststeht.

Preise sind reine Referenz in der Bestellaufnahme (Item-Liste, Auswahl-Dialoge, Warenkorb
mit Zeilen- und Gesamtsumme) sowie in der Tischübersicht (vorläufige Abrechnung, siehe oben)
— es gibt keine Rechnungsstellung, keine Zahlungsabwicklung und keine Anzeige von Preisen auf
den Küchen-/Bar-Tickets.

Preis-Snapshot: `order_items.unit_price` und die `price`-Felder in `order_items.extras`
speichern den Preis zum Zeitpunkt der Bestellung, statt ihn live aus `menu_items` zu lesen.
Grund: eine spätere Preisänderung an der Speisekarte darf nicht rückwirkend die vorläufige
Abrechnung bereits laufender/vergangener Bestellungen verändern. Für Bestellungen, die vor
Einführung dieses Snapshots angelegt wurden, fällt die Tischübersicht auf `menu_items.price`
zurück.

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
9. Tischübersicht + vorläufige Abrechnung pro Tisch (Positionen per Checkbox auswählbar,
   Summe live berechnet).

## Nicht-Ziele (bewusst weggelassen für v1)

- Keine Kassenintegration, keine Rechnungsstellung, keine Zahlungen (Preise werden seit
  Kurzem nur zu Referenzzwecken in der Bestellaufnahme und der Tischübersicht angezeigt,
  siehe Datenmodell). Auch die "vorläufige Abrechnung" in der Tischübersicht ist reine
  Anzeige/Berechnung im Client — es wird nichts gebucht, gedruckt oder gespeichert; die
  verbindliche Rechnung erstellt weiterhin die Kasse.
- Kein Nutzer-Login/Rollen-Auth (kann später ergänzt werden)
- Keine Offline-Fähigkeit in v1 (spätere Überlegung: lokaler Server statt Cloud-Supabase,
  falls Internetverbindung im Restaurant unzuverlässig ist)
