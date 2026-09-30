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

## Architekturprinzip: eine Codebase, sieben Rollen

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
   will statt möglichst großer, aus der Distanz lesbarer Schrift. Jede Position auf einem
   Ticket hat rechts einen eigenen großen Haken-Button — abgehakt wird nur über ihn (nicht
   mehr über die ganze Zeile, damit ein flüchtiges Antippen nicht die falsche Position
   abhakt). Eine abgehakte Position bleibt auf ihrem Ticket stehen (grüner Haken, grau/
   durchgestrichen), der Kartenkopf zeigt den Fortschritt ("✓ 2/3"), und ein breiter
   "✓ 全部完成 · Alle fertig"-Button unten auf der Karte hakt alle restlichen Positionen auf
   einmal ab. Gleiche Portionen einer Bestellung (gleiches Gericht, Variante, Extras, Notiz und
   Status) stehen als EINE Zeile mit Mengenangabe davor da ("3× R1 · 豚骨拉面", "2× Piña
   Colada" — ab 2× in Akzentfarbe, `groupItems` in `DeviceTicketBoard.tsx`, gilt für Küche
   und Bar); ihr Haken hakt alle Portionen der Zeile auf einmal ab. Abgehakte und offene
   Portionen desselben Gerichts stehen als getrennte Zeilen da. Erst wenn ALLE Positionen eines Tickets in einer Station abgehakt sind, wandert
   das ganze Ticket (für diese Station) in den Tab "Vergangene Bestellungen" — dort lässt
   sich eine Position per erneutem Antippen ihres Hakens zurück auf "offen" setzen, das
   Ticket kehrt dann in den "Offen"-Tab zurück. (Frühere Varianten: einzelne abgehakte
   Positionen wanderten sofort als eigene Karte nach "Vergangene Bestellungen", und ein
   zusätzlicher Tab "Komplett" zeigte jedes Tisch-Ticket unfragmentiert — beides wurde
   zugunsten der einfacheren Haken-auf-dem-Ticket-Logik entfernt.) Ein dritter Tab "Anzahl"
   fasst zusätzlich alle noch offenen
   Positionen jeder Station zu einer nach Menge sortierten Stückzahl-Liste zusammen (z.B.
   "5× Gyoza") statt einzelner Ticket-Karten, gruppiert nach Gericht + Variante (Extras
   fließen nicht mit ein) — damit die Küche bei vielen gleichen Bestellungen (z.B. mehrere
   Gyoza-Bestellungen gleichzeitig) direkt in einem Rutsch nachbraten kann, ohne selbst über
   die Ticket-Karten zu zählen. Abgehakt wird weiterhin nur über die Ticket-Karten im
   "Offen"-Tab, der "Anzahl"-Tab selbst ist reine Zähl-Hilfe ohne Tipp-Interaktion.
   **Handy-Ansicht der Küche:** Auf einem Handy (kürzeste Bildschirmseite < 600dp,
   `hooks/useIsPhone.ts`, gilt also auch im Querformat) rendert `DeviceTicketBoard` statt
   der drei Spalten nebeneinander `PhoneKitchenBoard`: kompakte Tab-Leiste (待做/已完成/数量,
   nur Glocke, keine "−"/"+"-Kartengröße), darunter eine Stationen-Leiste als Filter
   (全部 | 小吃 | 主食 | 烤肉 mit Zähler je Station, zuletzt gewählte Station pro Gerät
   gemerkt, AsyncStorage `yami:phone-kitchen-station`) und EINE Spalte volle Breite. "全部"
   zeigt alle Stationen untereinander mit fixierten Abschnitts-Überschriften (leere
   Stationen ausgeblendet). Karten sind dieselben wie auf dem Tablet (`TicketCard`, gleiches
   Abhaken/Wischen/"全部完成"), nur mit eigenen Größen (`createPhoneStyles`). Tablet/Laptop
   und die Bar sind davon nicht betroffen.
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
   Küche/Bar. Jede Tischkarte teilt die noch offenen Positionen nach Bereich auf (🥟 Vorspeise
   · 🍜 Hauptspeise · 🥩 BBQ · 🍹 Getränke · 🍨 Nachspeisen, `lib/sections.ts`), mit Mengen
   ("2× …"), Fortschrittsbalken und Wartezeit seit der ältesten offenen Position (ab 20 min
   gelb, ab 30 min rot). Sortierung standardmäßig nach längster Wartezeit (umschaltbar auf
   Tischnummer), Filter-Kacheln oben zeigen je Bereich die Zahl offener Portionen und
   filtern auf Tische mit offenen Positionen dieses Bereichs. Oben ein "🛎️ Abholbereit"-
   Streifen mit den zuletzt fertig gewordenen KÜCHEN-Gerichten der letzten 30 min — die
   frühere Bar-Variante ("Zuletzt zubereitet (Bar)") wurde bewusst entfernt. Das Tisch-
   Detail (Antippen einer Karte) nutzt dieselbe Bereichs-Aufteilung.
5. **Tischübersicht** (für Bedienungen) — Übersicht **aller** Tische mit Bestellungen von
   heute (auch bereits fertige, anders als Status — die werden ja gerade erst abgerechnet).
   Zwei Tabs: "🪑 Aktuell" (offene Tische) und "🕓 Vergangene Tische" (per "Tisch
   abschließen" geschlossen, siehe unten). Oben im Aktuell-Tab steht eine Kachel-Übersicht
   aller belegten Tische (Tischnummer + Fortschritt, grün = alles raus, orange = noch etwas
   offen; Antippen öffnet die Abrechnung) — dort stand früher der Tagesumsatz, der jetzt
   einen eigenen Menüpunkt hat (siehe 6.).
   Tippen auf einen Tisch öffnet die Bestellübersicht mit vorläufiger Abrechnung: einzelne
   Positionen sind per Checkbox auswählbar (z.B. für getrennte Rechnungen), die Summe der
   Auswahl wird live berechnet. Rein zur Orientierung für die Bedienung — es wird nichts
   gebucht oder gespeichert; die verbindliche Rechnung druckt weiterhin die Kasse. Jede
   offene Tischkarte in der Übersicht hat unten eine Icon-Leiste (Icons statt Text,
   Beschriftung nur als accessibilityLabel; dezente Feather-Linien-Icons aus
   `@expo/vector-icons` statt Emojis — im Text unten stehen zur Kürze weiter die Emojis): ➕ neue Bestellung für diesen Tisch, 🔀 Tisch
   wechseln / zusammenführen, ✂️ einzelne Positionen verschieben, 🗑️ Bestellungen löschen
   (PIN). 🔀 und ✂️ leben bewusst in der Übersicht (nicht mehr in der Abrechnung), weil man
   dafür mehrere Tische gleichzeitig im Blick braucht; beide nutzen denselben Zielauswahl-
   Dialog: alle anderen offenen Tische als antippbare 🔗-Kacheln (= zusammenführen) plus ein
   Nummernfeld für einen freien Tisch. 🏷️ bucht einen Rabatt direkt auf den offenen Tisch
   (`components/DiscountDialog.tsx` + `lib/discount.ts`: Betrag frei oder per 10/15/20/50 %-
   Kachel aus der Tischsumme, Beschreibung optional) — derselbe Dialog steckt auch als
   "🏷️ Rabatt hinzufügen" im Footer der Abrechnung. In der Bestellaufnahme gibt es seit
   Kurzem keinen Rabatt-Button mehr. Technisch ist ein Rabatt weiterhin eine `order_items`-
   Zeile auf dem Item der Rabatt-Kategorie (`categories.is_discount`) mit negativem
   `unit_price` und der Beschreibung in `variant_de`, direkt als "fertig" angelegt. 🔀 verschiebt den GANZEN Tisch (alle seine offenen
   Bestellungen, per `orders.table_id`) — hat das Ziel schon eine offene Bestellung, landen
   beide Tische unter derselben `table_id` und werden so zu einer gemeinsamen Rechnung
   zusammengeführt. ✂️ zeigt im Dialog alle Positionen des Tisches zum Antippen und hängt nur
   die ausgewählten EINZELNEN Positionen um (per `order_items.order_id`, auf die offene
   Bestellung des Zieltisches bzw. eine neu angelegte) — der Rest des Ursprungstisches bleibt
   stehen. Beide Wege legen bei einer noch nie benutzten Zieltischnummer automatisch eine neue
   `tables`-Zeile an (dieselbe Upsert-Logik wie beim Absenden einer Bestellung in
   OrderScreen.tsx).
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

6. **Umsatz** — eigener Menüpunkt (`RevenueScreen.tsx`, früher ein Kasten oben in der
   Tischübersicht): Tagesumsatz über alle heutigen Positionen, offene wie abgeschlossene
   Tische, aufgeschlüsselt nach Zahlungsart (Karte / Bargeld / nicht als bezahlt markiert),
   offenen vs. abgeschlossenen Tischen und Küche vs. Bar. Wird erst durch den Tagesabschluss
   geleert. Reine Orientierung — die verbindlichen Zahlen liefert die Kasse.

7. **Admin** — PIN-geschützt (`ADMIN_PIN`, `AdminScreen.tsx`), zwei Tabs:
   - **Speisekarte:** Gerichte je Kategorie anlegen (＋), Namen/Hanzi/Code/Preis ändern (✏️,
     bei Gerichten mit Varianten/Extras auch deren Einzelpreise), Gerichte entfernen (🗑️) und
     wiederherstellen (↩️). "Entfernen" setzt nur `menu_items.active = false` — ein echtes
     Löschen scheitert am `on delete restrict` bereits bestellter `order_items`, und die sollen
     in Abrechnung/Protokoll ihren Namen behalten. Ausgeblendete Gerichte verschwinden aus der
     Bestellaufnahme (`useMenu` lädt nur `active = true`, einmalig beim Öffnen — Änderungen
     erscheinen also nach dem nächsten Öffnen der Bestellung). Preisänderungen wirken wegen des
     Preis-Snapshots (`order_items.unit_price`) nicht auf bereits aufgenommene Bestellungen.
     Rabatt-Kategorie und "Diverses"-Sammelposten sind hier nicht editierbar.
   - **Protokoll:** `activity_log` — gelöschte Tische (🗑️ in der Tischübersicht, inkl. Liste
     der gelöschten Positionen), entfernte Einzelpositionen (Abrechnung) und angewendete
     Rabatte (🏷️ in Tischübersicht/Abrechnung), geschrieben über `lib/activityLog.ts`.
     Einträge werden nach **3 Tagen endgültig gelöscht**: serverseitig per stündlichem
     pg_cron-Job (siehe schema.sql), zusätzlich räumt der Client beim Schreiben eines
     Eintrags und beim Öffnen des Protokolls auf; die RLS-Policy erlaubt Löschen nur für
     abgelaufene Einträge. Das Protokoll ist unabhängig vom Tagesabschluss.

Rollenwahl bestimmt nur Filter + Sortierung + UI-Layout, nicht das Datenmodell.

## Sprache (Deutsch / Chinesisch)

Umschalter "中文" / "DE" rechts in jeder App-Leiste (neben Hell/Dunkel), gemerkt pro Gerät
(AsyncStorage `yami:language`, Standard Deutsch). Alle Oberflächentexte liegen in
`src/i18n/strings.ts` (je Schlüssel `de` + `zh`), Zugriff über `useI18n().t(key, params)`.
Regeln:
- **Bar bleibt immer Deutsch** — die Bar-Ansicht selbst (`DeviceTicketBoard` mit
  `targetDevice='bar'` übersetzt fest auf `de`), der Menüpunkt "Bar" sowie alles zu
  Getränken/Nachspeisen (Gruppen-Überschriften in der Bestellung, Status-Bereiche,
  Kategorienamen ohne Hanzi) — dort wird auf Deutsch gearbeitet.
- **Küche:** Gerichtenamen auf den Tickets bleiben immer zweisprachig (Hanzi + Deutsch). Die
  restliche Küchen-Oberfläche ist auf Chinesisch rein chinesisch (Tabs, Stationen 小吃/主食/
  烤肉, "{n}号桌", "✓ 全部完成"); auf Deutsch bleibt sie wie bisher zweisprachig beschriftet.
- Überall sonst folgt die Oberfläche der gewählten Sprache; Gerichtenamen kommen weiterhin aus
  der Datenbank (Hanzi + Deutsch, wo vorhanden). Gespeicherte Texte (Rabatt-Beschreibungen,
  Protokoll-Einträge, Notizen) werden nicht übersetzt.

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
davon, ob die Bestellung insgesamt (in einer anderen Spalte) noch offen ist. Die Küche
verhält sich pro Station genauso (`itemsMatching`): abgehakte Positionen bleiben mit grünem
Haken auf dem Ticket stehen, bis alle Positionen dieser Station fertig sind. Dann erscheint
das Ticket als Ganzes im "Vergangene Bestellungen"-Tab derselben Station
(`stationDoneTickets`), sortiert nach Fertig-Zeit (neueste zuerst). Dieselbe Bestellung kann
so z.B. unter "Vergangene Bestellungen → Vorspeise" (Vorspeisen fertig) UND "Offen →
Hauptspeise" (Ramen noch in Arbeit) auftauchen — beide siehe `DeviceTicketBoard.tsx`.

## Status-Workflow

1. Bedienung erstellt Bestellung → Zeilen in `order_items` mit `status = 'offen'`.
2. Küche/Bar sehen live (Realtime-Subscription) neue Zeilen, gefiltert nach `target_device`.
3. Tippen auf den Haken-Button einer Position → `status = 'fertig'` (grüner Haken,
   durchgestrichen), `done_at` gesetzt; erneutes Tippen setzt zurück auf `offen`.
4. Sobald alle Items einer Bestellung **für das jeweilige Gerät** fertig sind, wandert die
   Bestellung im UI (nicht in der DB als separate Tabelle) aus "offen" in "fertig" und landet
   in "Vergangene Bestellungen". Bei der Küche passiert dieser Wechsel pro Station: ein
   Ticket wandert in "Vergangene Bestellungen → [Station]", sobald alle seine Positionen
   dieser Station abgehakt sind; bis dahin bleiben abgehakte Positionen mit grünem Haken auf
   dem Ticket in "Offen" stehen. Diese Berechnung passiert client-seitig aus dem Realtime-Stream — kein
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
- `activity_log` — kind (table_deleted/item_deleted/discount_applied), table_number, summary,
  amount, details, created_at — Admin-Protokoll, nach 3 Tagen automatisch gelöscht
- `order_items` — order_id, menu_item_id, status (offen/fertig), variant_hanzi/variant_de
  (gewählte Variante), extras (gewählte Extras + Menge + Preis), unit_price (Preis-Snapshot
  der Grundposition zum Bestellzeitpunkt, siehe unten), note (Freitext der Bedienung),
  spice_level (1 mild / 2 scharf / 3 sehr scharf, null = nicht scharf), created_at, done_at

Schärfegrad: einstellbar NUR in der aufklappbaren Bestellübersicht (Warenkorb-Panel in
`OrderScreen.tsx`), per dreiteiliger Leiste Mild | Scharf | Sehr scharf (微辣/辣/特辣) unter
jeder Hauptspeisen-Zeile (`kitchen_station = 'hauptspeise'`, ohne "Diverses", `lib/spice.ts`).
Erneutes Antippen des gewählten Grads setzt zurück auf nicht scharf. In der Gerichtauswahl (Varianten-/Extras-Dialog) gibt es bewusst keine Schärfe-Option
(das frühere Ramen-Extra "辣油 Chilliöl" wurde entfernt, siehe Migration in schema.sql). Der Grad ist Teil des
Warenkorb-Schlüssels (unterschiedlich scharfe Portionen = getrennte Zeilen). Auf den
Küchen-Tickets steht er hinter dem Gerichtenamen ("豚骨拉面 · 🌶️🌶️ 辣").

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
