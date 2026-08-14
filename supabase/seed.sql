-- YAMI Dashboard — Seed-Daten (Kategorien + Menü)
--
-- Diese Datei ist idempotent: jeder Insert nutzt ON CONFLICT ... DO UPDATE
-- (categories über name_de, menu_items über category_id+name_de — siehe
-- unique-Constraints in schema.sql). Das heisst: seed.sql kann beliebig oft
-- erneut ausgeführt werden, um Änderungen einzuspielen, ohne Duplikate zu
-- erzeugen oder wegen eines Constraint-Fehlers mittendrin abzubrechen.
--
-- WICHTIG: Die Hanzi-Bezeichnungen unten sind gängige Standardübersetzungen,
-- aber NICHT von muttersprachlichem Küchenpersonal geprüft. Bitte vor dem
-- produktiven Einsatz von jemandem aus der Küche gegenlesen lassen — falsche
-- Beschriftung ist hier besonders ärgerlich, weil die Küche sich primär
-- darauf verlässt.
--
-- PREISE: dienen nur als Referenz für Bedienung/Gäste in der App — es gibt
-- weiterhin keine Rechnungsstellung/Zahlung, das bleibt beim bestehenden
-- Kassensystem. Makgeolli hat vorerst 12,90€ (noch kein endgültiger Preis von
-- der Karte bekannt, bei Bedarf anpassen).
--

-- Essen → Küche, Sortierung: Vorspeise (1-2) → Hauptspeise (3-6) → Barbecue (7).
-- kitchen_station gruppiert dieselben Kategorien zusätzlich für die Zwei-Spalten-
-- Ansicht auf dem Küchen-Screen (Vorspeise-Spalte vs. Hauptspeise+Barbecue-Spalte).
insert into categories (name_hanzi, name_de, menu_group, target_device, sort_order, kitchen_station) values
  ('小吃', 'kleinigkeiten', 'essen', 'kitchen', 1, 'vorspeise'),
  ('汤', 'suppen', 'essen', 'kitchen', 2, 'hauptspeise'),
  ('炸鸡', 'fried chicken', 'essen', 'kitchen', 3, 'vorspeise'),
  ('热菜', 'warme speisen', 'essen', 'kitchen', 4, 'hauptspeise'),
  ('拉面', 'ramen', 'essen', 'kitchen', 5, 'hauptspeise'),
  ('面条', 'nudeln', 'essen', 'kitchen', 6, 'hauptspeise'),
  ('烤肉', 'korean bbq', 'essen', 'kitchen', 7, 'barbecue')
on conflict (name_de) do update set
  name_hanzi = excluded.name_hanzi,
  menu_group = excluded.menu_group,
  target_device = excluded.target_device,
  sort_order = excluded.sort_order,
  kitchen_station = excluded.kitchen_station;

-- Migration: 'kaffee/matcha' → 'kaffee/tee/matcha', jetzt wo auch Tee dort steht (siehe
-- weiter unten). Reine Umbenennung des Namens/Schlüssels per UPDATE statt neuem
-- insert+delete — menu_items hängen per category_id (nicht per Name) an der Kategorie,
-- die Umbenennung bewegt also keine bestehenden Items. Auf einer frischen Datenbank
-- (die 'kaffee/matcha' nie hatte) matcht das UPDATE nichts und ist ein No-op; der
-- eigentliche Name kommt dann direkt aus dem insert unten.
update categories set name_de = 'kaffee/tee/matcha' where name_de = 'kaffee/matcha';

-- Getränke + Nachspeisen → Bar
-- Sortierung: Alkoholfreie Getränke → Bier → Cocktails → Spirituosen → Wein
-- → Kaffee/Tee/Matcha → Nachspeise (Mochi Eis → Eis → Eisschnee).
-- Die frühere eigene "Schnaps"-Kategorie (Soju/Makgeolli) wurde aufgelöst —
-- beide Getränke stehen jetzt unter Spirituosen (siehe Migration weiter oben).
-- Kein Hanzi für Bar-Kategorien (Getränke/Nachspeisen) — an der Bar wird auf Deutsch
-- gearbeitet, Hanzi ist primär für die Küche. OrderScreen.tsx/DeviceTicketBoard.tsx
-- zeigen bei fehlendem Hanzi stattdessen den deutschen Namen groß/prominent an.
insert into categories (name_hanzi, name_de, menu_group, target_device, sort_order) values
  (null, 'alkoholfreie getränke', 'getraenke', 'bar', 1),
  (null, 'bier', 'getraenke', 'bar', 2),
  (null, 'cocktails', 'getraenke', 'bar', 3),
  (null, 'spirituosen', 'getraenke', 'bar', 4),
  (null, 'wein', 'getraenke', 'bar', 5),
  (null, 'kaffee/tee/matcha', 'getraenke', 'bar', 6),
  (null, 'mochi eis', 'nachspeisen', 'bar', 7),
  (null, 'eis', 'nachspeisen', 'bar', 8),
  (null, 'eisschnee', 'nachspeisen', 'bar', 9)
on conflict (name_de) do update set
  name_hanzi = excluded.name_hanzi,
  menu_group = excluded.menu_group,
  target_device = excluded.target_device,
  sort_order = excluded.sort_order;

-- Migration: Schnaps-Kategorie aufgelöst, Soju/Makgeolli ziehen zu Spirituosen um.
-- Erst bestehende menu_items-Zeilen umhängen (UPDATE statt delete+insert, damit
-- menu_item_id stabil bleibt und alte order_items-Referenzen gültig bleiben),
-- danach die jetzt leere Kategorie löschen (menu_items→categories ist
-- "on delete restrict", ein delete würde vorher fehlschlagen). Auf einer frischen
-- Datenbank, die "schnaps" nie hatte, matcht das UPDATE nichts und ist ein No-op.
update menu_items
set category_id = (select id from categories where name_de = 'spirituosen'),
    price = case name_de when 'Makgeolli' then 12.90 else price end
where category_id = (select id from categories where name_de = 'schnaps');

delete from categories where name_de = 'schnaps';

-- Diverse-Kategorien: Sammelposten für Gerichte/Getränke, die (noch) nicht auf der
-- Karte stehen. Enthalten jeweils ein einzelnes "Diverses"-Item mit frei eintragbarem
-- Preis + Beschreibung (siehe menu_items.is_custom_entry, OrderScreen.tsx).
-- "diverses essen" fällt in der Küchen-Zwei-Spalten-Ansicht auf hauptspeise zurück,
-- da nicht vorhersehbar ist, was frei eingetragen wird.
insert into categories (name_hanzi, name_de, menu_group, target_device, sort_order, kitchen_station) values
  ('其他菜品', 'diverses essen', 'essen', 'kitchen', 8, 'hauptspeise'),
  (null, 'diverses getränke', 'getraenke', 'bar', 10, null)
on conflict (name_de) do update set
  name_hanzi = excluded.name_hanzi,
  menu_group = excluded.menu_group,
  target_device = excluded.target_device,
  sort_order = excluded.sort_order,
  kitchen_station = excluded.kitchen_station;

-- Rabatt: kein zuzubereitendes Gericht/Getränk, sondern ein Preis-Abzug, den die
-- Bedienung direkt im Bestell-Screen mit Beschreibung + Betrag hinzufügen kann (siehe
-- OrderScreen.tsx, RabattDialog). Eigene Kategorie mit is_discount=true, damit
-- DeviceTicketBoard.tsx (Küche/Bar) diese Positionen aus den Tickets ausblendet — sie
-- sind nichts zum Zubereiten. menu_group/target_device sind hier nur wegen der not-null-
-- Constraints gesetzt und ohne inhaltliche Bedeutung: OrderScreen.tsx überspringt
-- is_discount-Kategorien beim Gruppieren, die Kategorie taucht also nie im normalen
-- Kategorie-Raster auf.
insert into categories (name_hanzi, name_de, menu_group, target_device, sort_order, is_discount) values
  (null, 'rabatt', 'getraenke', 'bar', 100, true)
on conflict (name_de) do update set
  name_hanzi = excluded.name_hanzi,
  menu_group = excluded.menu_group,
  target_device = excluded.target_device,
  sort_order = excluded.sort_order,
  is_discount = excluded.is_discount;

insert into menu_items (category_id, name_hanzi, name_de) values
  ((select id from categories where name_de = 'rabatt'), null, 'Rabatt')
on conflict (category_id, name_de) do update set
  name_hanzi = excluded.name_hanzi;

-- Tische: drinnen 1-21, Terrasse 1: 101-103, Terrasse 2: 201-204
insert into tables (number)
select generate_series(1, 21)
union all
select generate_series(101, 103)
union all
select generate_series(201, 204)
on conflict (number) do nothing;

-- Nudeln
-- W10 verlangt zusätzlich eine Protein-Wahl Rind/Huhn (variant_options, ohne
-- Preisunterschied), wie die Ajitama-Ramen.
insert into menu_items (category_id, name_hanzi, name_de, item_code, price, variant_options) values
  ((select id from categories where name_de = 'nudeln'), '炒乌冬面', 'Sichuan Noodles', 'W10', 14.80,
    '[{"name_hanzi": "牛肉", "name_de": "Rind"}, {"name_hanzi": "鸡肉", "name_de": "Huhn"}]')
on conflict (category_id, name_de) do update set
  name_hanzi = excluded.name_hanzi,
  item_code = excluded.item_code,
  price = excluded.price,
  variant_options = excluded.variant_options;

-- Korean BBQ (nur Menü-Namen + Preise bekannt, kein Code/Inhalt — bei Bedarf
-- ergänzen, was in Menü 1/2/3 jeweils enthalten ist)
insert into menu_items (category_id, name_hanzi, name_de, price) values
  ((select id from categories where name_de = 'korean bbq'), '套餐1', 'Menü 1', 28.00),
  ((select id from categories where name_de = 'korean bbq'), '套餐2', 'Menü 2', 33.00),
  ((select id from categories where name_de = 'korean bbq'), '套餐3', 'Menü 3', 35.00)
on conflict (category_id, name_de) do update set
  name_hanzi = excluded.name_hanzi,
  price = excluded.price;

-- Ramen
-- Ajitama Miso/Tonkotsu/Shoyu (R1, R4, R5) verlangen zusätzlich eine Protein-Wahl
-- Rind/Huhn (variant_options, ohne Preisunterschied). Alle Ramen bieten dieselben
-- 4 Extras mit +/- Menge im selben Dialog an (extra_options), jeweils mit eigenem
-- Preis pro Portion. R6 hat noch keinen Preis in der Vorlage.
-- Aufräumen: die alten "Extra: ..."-Einzeleinträge (aus einer früheren seed.sql-
-- Version) werden nicht mehr gebraucht, da jetzt alle Ramen den Dialog haben.
-- Deaktivieren statt löschen, falls schon Testbestellungen darauf verweisen
-- (menu_items hat "on delete restrict", ein delete könnte sonst fehlschlagen).
update menu_items
set active = false
where category_id = (select id from categories where name_de = 'ramen')
  and name_de like 'Extra:%';

insert into menu_items (category_id, name_hanzi, name_de, item_code, price, variant_options, extra_options) values
  ((select id from categories where name_de = 'ramen'), '溏心蛋味噌拉面', 'Ajitama Miso Ramen', 'R1', 13.90,
    '[{"name_hanzi": "牛肉", "name_de": "Rind"}, {"name_hanzi": "鸡肉", "name_de": "Huhn"}]',
    '[{"name_hanzi": "溏心蛋", "name_de": "Ajitama Eier", "price": 2.00}, {"name_hanzi": "玉米", "name_de": "Mais", "price": 1.00}, {"name_hanzi": "炸虾", "name_de": "Ebi Fry (2 Stk)", "price": 3.10}, {"name_hanzi": "豆腐", "name_de": "Tofu (4 Stk)", "price": 1.80}, {"name_hanzi": "辣油", "name_de": "Chilliöl"}]'),
  ((select id from categories where name_de = 'ramen'), '天妇罗虾拉面', 'Ramen mit Garnelen Tempura', 'R2', 14.90, null,
    '[{"name_hanzi": "溏心蛋", "name_de": "Ajitama Eier", "price": 2.00}, {"name_hanzi": "玉米", "name_de": "Mais", "price": 1.00}, {"name_hanzi": "炸虾", "name_de": "Ebi Fry (2 Stk)", "price": 3.10}, {"name_hanzi": "豆腐", "name_de": "Tofu (4 Stk)", "price": 1.80}, {"name_hanzi": "辣油", "name_de": "Chilliöl"}]'),
  ((select id from categories where name_de = 'ramen'), '照烧鸡肉味噌拉面', 'Toriteri Miso Ramen', 'R3', 15.90, null,
    '[{"name_hanzi": "溏心蛋", "name_de": "Ajitama Eier", "price": 2.00}, {"name_hanzi": "玉米", "name_de": "Mais", "price": 1.00}, {"name_hanzi": "炸虾", "name_de": "Ebi Fry (2 Stk)", "price": 3.10}, {"name_hanzi": "豆腐", "name_de": "Tofu (4 Stk)", "price": 1.80}, {"name_hanzi": "辣油", "name_de": "Chilliöl"}]'),
  ((select id from categories where name_de = 'ramen'), '溏心蛋豚骨拉面', 'Ajitama Tonkotsu Ramen', 'R4', 13.90,
    '[{"name_hanzi": "牛肉", "name_de": "Rind"}, {"name_hanzi": "鸡肉", "name_de": "Huhn"}]',
    '[{"name_hanzi": "溏心蛋", "name_de": "Ajitama Eier", "price": 2.00}, {"name_hanzi": "玉米", "name_de": "Mais", "price": 1.00}, {"name_hanzi": "炸虾", "name_de": "Ebi Fry (2 Stk)", "price": 3.10}, {"name_hanzi": "豆腐", "name_de": "Tofu (4 Stk)", "price": 1.80}, {"name_hanzi": "辣油", "name_de": "Chilliöl"}]'),
  ((select id from categories where name_de = 'ramen'), '溏心蛋酱油拉面', 'Ajitama Shoyu Ramen', 'R5', 13.50,
    '[{"name_hanzi": "牛肉", "name_de": "Rind"}, {"name_hanzi": "鸡肉", "name_de": "Huhn"}]',
    '[{"name_hanzi": "溏心蛋", "name_de": "Ajitama Eier", "price": 2.00}, {"name_hanzi": "玉米", "name_de": "Mais", "price": 1.00}, {"name_hanzi": "炸虾", "name_de": "Ebi Fry (2 Stk)", "price": 3.10}, {"name_hanzi": "豆腐", "name_de": "Tofu (4 Stk)", "price": 1.80}, {"name_hanzi": "辣油", "name_de": "Chilliöl"}]'),
  ((select id from categories where name_de = 'ramen'), '素食豆腐拉面', 'Vegetarische Ramen mit Tofu', 'R6', 11.90, null,
    '[{"name_hanzi": "溏心蛋", "name_de": "Ajitama Eier", "price": 2.00}, {"name_hanzi": "玉米", "name_de": "Mais", "price": 1.00}, {"name_hanzi": "炸虾", "name_de": "Ebi Fry (2 Stk)", "price": 3.10}, {"name_hanzi": "豆腐", "name_de": "Tofu (4 Stk)", "price": 1.80}, {"name_hanzi": "辣油", "name_de": "Chilliöl"}]')
on conflict (category_id, name_de) do update set
  name_hanzi = excluded.name_hanzi,
  item_code = excluded.item_code,
  price = excluded.price,
  variant_options = excluded.variant_options,
  extra_options = excluded.extra_options;

-- Migration: die Fried-Chicken-Namen trugen früher den Suffix " 4x/8x" (z.B. 'Original
-- Fried Chicken 4x/8x'), der beim Umbenennen auf den reinen Namen entfernt wurde. Da
-- ON CONFLICT über name_de matcht, hat die Umbenennung die alten Zeilen nicht getroffen —
-- sie blieben als doppelte Einträge in der Datenbank stehen. Deaktivieren statt löschen,
-- falls Testbestellungen darauf verweisen (menu_items hat "on delete restrict").
update menu_items
set active = false
where category_id = (select id from categories where name_de = 'fried chicken')
  and name_de like '% 4x/8x';

-- Fried Chicken
-- Mengen-Dialog 4/8 Stück beim Bestellen (variant_options). Preis hängt von der
-- Stückzahl ab, deshalb steckt er in der jeweiligen Variante statt auf dem Item
-- selbst (menu_items.price bleibt hier null).
insert into menu_items (category_id, name_hanzi, name_de, item_code, variant_options) values
  ((select id from categories where name_de = 'fried chicken'), '原味炸鸡', 'Original Fried Chicken', 'F1',
    '[{"name_hanzi": "4个", "name_de": "4 Stück", "price": 6.40}, {"name_hanzi": "8个", "name_de": "8 Stück", "price": 11.90}]'),
  ((select id from categories where name_de = 'fried chicken'), '韩式炸鸡 甜辣', 'KFC süss-scharf', 'F2',
    '[{"name_hanzi": "4个", "name_de": "4 Stück", "price": 6.40}, {"name_hanzi": "8个", "name_de": "8 Stück", "price": 11.90}]'),
  ((select id from categories where name_de = 'fried chicken'), '韩式炸鸡 蒜香酱', 'KFC Knoblauch-Sauce', 'F3',
    '[{"name_hanzi": "4个", "name_de": "4 Stück", "price": 6.40}, {"name_hanzi": "8个", "name_de": "8 Stück", "price": 11.90}]'),
  ((select id from categories where name_de = 'fried chicken'), '韩式炸鸡 辣味蛋黄酱', 'KFC scharfe Mayonnaise', 'F4',
    '[{"name_hanzi": "4个", "name_de": "4 Stück", "price": 6.40}, {"name_hanzi": "8个", "name_de": "8 Stück", "price": 11.90}]')
on conflict (category_id, name_de) do update set
  name_hanzi = excluded.name_hanzi,
  item_code = excluded.item_code,
  variant_options = excluded.variant_options;

-- Warme Speisen
insert into menu_items (category_id, name_hanzi, name_de, item_code, price) values
  ((select id from categories where name_de = 'warme speisen'), '牛肉拌饭', 'Bibimbap mit Beef', 'W1', 16.90),
  ((select id from categories where name_de = 'warme speisen'), '豆腐拌饭（素食）', 'Bibimbap mit Tofu (vegetarisch)', 'W2', 14.90)
on conflict (category_id, name_de) do update set
  name_hanzi = excluded.name_hanzi,
  item_code = excluded.item_code,
  price = excluded.price;

-- Suppen
insert into menu_items (category_id, name_hanzi, name_de, item_code, price) values
  ((select id from categories where name_de = 'suppen'), '辣牛肉汤', 'Scharfe Rindfleischsuppe', 'S1', 12.90),
  ((select id from categories where name_de = 'suppen'), '泡菜豆腐汤', 'Kimchi-Tofu-Suppe', 'S2', 9.90)
on conflict (category_id, name_de) do update set
  name_hanzi = excluded.name_hanzi,
  item_code = excluded.item_code,
  price = excluded.price;

-- Kleinigkeiten
insert into menu_items (category_id, name_hanzi, name_de, item_code, price) values
  ((select id from categories where name_de = 'kleinigkeiten'), '毛豆', 'Edamame', 'K1', 4.00),
  ((select id from categories where name_de = 'kleinigkeiten'), '海藻沙拉', 'Wakame', 'K2', 4.90),
  ((select id from categories where name_de = 'kleinigkeiten'), '韩式炒年糕', 'Tteokbeokki', 'K3', 8.90),
  ((select id from categories where name_de = 'kleinigkeiten'), '蔬菜饺子', 'Gyoza Gemüse', 'K4a', 5.90),
  ((select id from categories where name_de = 'kleinigkeiten'), '牛肉饺子', 'Gyoza Rindfleisch', 'K4b', 5.90),
  ((select id from categories where name_de = 'kleinigkeiten'), '鱿鱼饺子', 'Gyoza Tintenfisch', 'K4c', 5.90),
  ((select id from categories where name_de = 'kleinigkeiten'), '鸭肉饺子', 'Gyoza Entenfleisch', 'K4d', 5.90),
  ((select id from categories where name_de = 'kleinigkeiten'), '煎蔬菜饺子', 'Gyoza gebraten Gemüse', 'K4e', 4.90),
  ((select id from categories where name_de = 'kleinigkeiten'), '煎鸡肉饺子', 'Gyoza gebraten Huhn', 'K4f', 5.20),
  ((select id from categories where name_de = 'kleinigkeiten'), '虾饺', 'Hau Kau Garnelen', 'K4g', 5.90),
  ((select id from categories where name_de = 'kleinigkeiten'), '面包虾', 'Garnelen Tempura', 'K6', 5.20)
on conflict (category_id, name_de) do update set
  name_hanzi = excluded.name_hanzi,
  item_code = excluded.item_code,
  price = excluded.price;

-- Nachtisch → Mochi-Eis / Eis (Bar-Kategorien), pro Geschmack aufgeteilt (siehe
-- Annahme oben in der Historie dieser Datei); alle Geschmacksrichtungen von N1
-- bzw. N2 teilen sich denselben Preis wie auf der Karte angegeben.
-- Kein Hanzi (siehe Bar-Kategorien oben) — an der Bar wird auf Deutsch gearbeitet.
insert into menu_items (category_id, name_hanzi, name_de, item_code, price) values
  ((select id from categories where name_de = 'mochi eis'), null, 'Mochi-Eis Kokos', 'N1', 4.50),
  ((select id from categories where name_de = 'mochi eis'), null, 'Mochi-Eis Matcha', 'N1', 4.50),
  ((select id from categories where name_de = 'mochi eis'), null, 'Mochi-Eis Schoko', 'N1', 4.50),
  ((select id from categories where name_de = 'eis'), null, 'Matcha-Eis', 'N2', 4.50),
  ((select id from categories where name_de = 'eis'), null, 'Sesam-Eis', 'N2', 4.50)
on conflict (category_id, name_de) do update set
  name_hanzi = excluded.name_hanzi,
  item_code = excluded.item_code,
  price = excluded.price;

-- N3 Eisschnee, pro Geschmack aufgeteilt (gleiches Prinzip wie N1/N2), alle
-- Geschmacksrichtungen teilen sich denselben Preis wie auf der Karte angegeben.
-- Kein Hanzi (siehe Bar-Kategorien oben) — an der Bar wird auf Deutsch gearbeitet.
insert into menu_items (category_id, name_hanzi, name_de, item_code, price) values
  ((select id from categories where name_de = 'eisschnee'), null, 'Eisschnee Mango', 'N3', 6.90),
  ((select id from categories where name_de = 'eisschnee'), null, 'Eisschnee Matcha', 'N3', 6.90),
  ((select id from categories where name_de = 'eisschnee'), null, 'Eisschnee Litchi', 'N3', 6.90),
  ((select id from categories where name_de = 'eisschnee'), null, 'Eisschnee Erdbeer', 'N3', 6.90),
  ((select id from categories where name_de = 'eisschnee'), null, 'Eisschnee Oreo', 'N3', 6.90)
on conflict (category_id, name_de) do update set
  name_hanzi = excluded.name_hanzi,
  item_code = excluded.item_code,
  price = excluded.price;

-- Spirituosen — einheitlich 2cl / 4,50€ für alle Sorten laut Karte, außer Soju/
-- Makgeolli (ehemals eigene "Schnaps"-Kategorie, siehe Migration weiter oben).
-- Makgeolli hat vorerst 12,90€ (noch kein endgültiger Preis von der Karte bekannt).
insert into menu_items (category_id, name_hanzi, name_de, price) values
  ((select id from categories where name_de = 'spirituosen'), null, 'Jägermeister', 4.50),
  ((select id from categories where name_de = 'spirituosen'), null, 'Obstler', 4.50),
  ((select id from categories where name_de = 'spirituosen'), null, 'Williams Birne', 4.50),
  ((select id from categories where name_de = 'spirituosen'), null, 'Himbeergeist', 4.50),
  ((select id from categories where name_de = 'spirituosen'), null, 'Bombay Sapphire', 4.50),
  ((select id from categories where name_de = 'spirituosen'), null, 'Absolut Vodka', 4.50),
  ((select id from categories where name_de = 'spirituosen'), null, 'Jack Daniels', 4.50),
  ((select id from categories where name_de = 'spirituosen'), null, 'Ramazzotti', 4.50),
  ((select id from categories where name_de = 'spirituosen'), null, 'Soju', 12.90),
  ((select id from categories where name_de = 'spirituosen'), null, 'Makgeolli', 12.90)
on conflict (category_id, name_de) do update set
  name_hanzi = excluded.name_hanzi,
  price = excluded.price;

-- Wein — 0,2L-Glas einheitlich 5,90€ für Rot- wie Weißwein, die Flasche unterscheidet
-- sich (Rotwein 28,00€/Flasche, Weißwein 26,00€/Flasche), deshalb Mengen-/Preis-Dialog
-- über variant_options statt einem festen menu_items.price. Kein Hanzi wie der Rest der
-- Bar-Karte — an der Bar wird auf Deutsch gearbeitet. Rot/Weiß ist nicht als eigenes
-- Feld im Datenmodell abgebildet, sondern ergibt sich aus der Rebsorte im Namen (Merlot/
-- Primitivo/Dornfelder = rot, Pinot/Chardonnay/Riesling = weiß) — dieselbe flache
-- Item-Liste pro Kategorie wie überall sonst (z.B. Cocktails, Bier).
insert into menu_items (category_id, name_hanzi, name_de, variant_options) values
  ((select id from categories where name_de = 'wein'), null, 'Merlot (trocken)',
    '[{"name_hanzi": "0.2L", "name_de": "0,2L", "price": 5.90}, {"name_hanzi": "Flasche", "name_de": "Flasche", "price": 28.00}]'),
  ((select id from categories where name_de = 'wein'), null, 'Primitivo (trocken)',
    '[{"name_hanzi": "0.2L", "name_de": "0,2L", "price": 5.90}, {"name_hanzi": "Flasche", "name_de": "Flasche", "price": 28.00}]'),
  ((select id from categories where name_de = 'wein'), null, 'Dornfelder (halbtrocken)',
    '[{"name_hanzi": "0.2L", "name_de": "0,2L", "price": 5.90}, {"name_hanzi": "Flasche", "name_de": "Flasche", "price": 28.00}]'),
  ((select id from categories where name_de = 'wein'), null, 'Pinot (trocken)',
    '[{"name_hanzi": "0.2L", "name_de": "0,2L", "price": 5.90}, {"name_hanzi": "Flasche", "name_de": "Flasche", "price": 26.00}]'),
  ((select id from categories where name_de = 'wein'), null, 'Chardonnay (trocken)',
    '[{"name_hanzi": "0.2L", "name_de": "0,2L", "price": 5.90}, {"name_hanzi": "Flasche", "name_de": "Flasche", "price": 26.00}]'),
  ((select id from categories where name_de = 'wein'), null, 'Riesling (halbtrocken)',
    '[{"name_hanzi": "0.2L", "name_de": "0,2L", "price": 5.90}, {"name_hanzi": "Flasche", "name_de": "Flasche", "price": 26.00}]')
on conflict (category_id, name_de) do update set
  name_hanzi = excluded.name_hanzi,
  variant_options = excluded.variant_options;

-- Kaffee / Tee / Matcha
insert into menu_items (category_id, name_hanzi, name_de, price) values
  ((select id from categories where name_de = 'kaffee/tee/matcha'), null, 'Espresso', 2.90),
  ((select id from categories where name_de = 'kaffee/tee/matcha'), null, 'Café Crème', 4.20),
  ((select id from categories where name_de = 'kaffee/tee/matcha'), null, 'Latte Macchiato', 4.20),
  ((select id from categories where name_de = 'kaffee/tee/matcha'), null, 'Cappuccino', 4.20),
  ((select id from categories where name_de = 'kaffee/tee/matcha'), null, 'Eiskaffee', 6.50),
  ((select id from categories where name_de = 'kaffee/tee/matcha'), null, 'Erdbeer-Matcha-Latte', 6.50),
  ((select id from categories where name_de = 'kaffee/tee/matcha'), null, 'Litschi-Kokos-Matcha-Latte', 5.90),
  ((select id from categories where name_de = 'kaffee/tee/matcha'), null, 'Grüner Tee', 2.50),
  ((select id from categories where name_de = 'kaffee/tee/matcha'), null, 'Jasmin Tee', 2.50)
on conflict (category_id, name_de) do update set
  name_hanzi = excluded.name_hanzi,
  price = excluded.price;

-- Softgetränke — Mengen-Dialog 0,2L/0,4L (variant_options), einheitlich 2,90€/3,90€.
-- Ohne Hanzi wie der Rest der Bar-Karte (Cocktails, Bier, Spirituosen etc.) — an der
-- Bar wird auf Deutsch gearbeitet, Hanzi ist primär für die Küche.
insert into menu_items (category_id, name_hanzi, name_de, variant_options) values
  ((select id from categories where name_de = 'alkoholfreie getränke'), null, 'Cola',
    '[{"name_hanzi": "0.2L", "name_de": "0,2L", "price": 2.90}, {"name_hanzi": "0.4L", "name_de": "0,4L", "price": 3.90}]'),
  ((select id from categories where name_de = 'alkoholfreie getränke'), null, 'Spezi',
    '[{"name_hanzi": "0.2L", "name_de": "0,2L", "price": 2.90}, {"name_hanzi": "0.5L", "name_de": "0,5L", "price": 4.90}]'),
  ((select id from categories where name_de = 'alkoholfreie getränke'), null, 'Cola Zero',
    '[{"name_hanzi": "0.2L", "name_de": "0,2L", "price": 2.90}, {"name_hanzi": "0.4L", "name_de": "0,4L", "price": 3.90}]'),
  ((select id from categories where name_de = 'alkoholfreie getränke'), null, 'Sprite',
    '[{"name_hanzi": "0.2L", "name_de": "0,2L", "price": 2.90}, {"name_hanzi": "0.4L", "name_de": "0,4L", "price": 3.90}]'),
  ((select id from categories where name_de = 'alkoholfreie getränke'), null, 'Fanta',
    '[{"name_hanzi": "0.2L", "name_de": "0,2L", "price": 2.90}, {"name_hanzi": "0.4L", "name_de": "0,4L", "price": 3.90}]'),
  ((select id from categories where name_de = 'alkoholfreie getränke'), null, 'Milkis',
    '[{"name_hanzi": "0.2L", "name_de": "0,2L", "price": 2.90}, {"name_hanzi": "0.4L", "name_de": "0,4L", "price": 3.90}]')
on conflict (category_id, name_de) do update set
  name_hanzi = excluded.name_hanzi,
  variant_options = excluded.variant_options;

-- Wasser — kombinierter Art-/Mengen-Dialog (variant_options): Still/Sprudel × 0,33L/0,75L,
-- gleiche Preise wie zuvor (2,90€/5,90€, unabhängig von still vs. sprudel).
insert into menu_items (category_id, name_hanzi, name_de, variant_options) values
  ((select id from categories where name_de = 'alkoholfreie getränke'), null, 'Wasser',
    '[{"name_hanzi": "0.33L still", "name_de": "Still 0,33L", "price": 2.90}, {"name_hanzi": "0.75L still", "name_de": "Still 0,75L", "price": 5.90}, {"name_hanzi": "0.33L sprudel", "name_de": "Sprudel 0,33L", "price": 2.90}, {"name_hanzi": "0.75L sprudel", "name_de": "Sprudel 0,75L", "price": 5.90}]')
on conflict (category_id, name_de) do update set
  name_hanzi = excluded.name_hanzi,
  variant_options = excluded.variant_options;

-- Säfte — kombinierter Mengen-/Art-Dialog (variant_options): 0,2L/0,4L × Saft/Schorle,
-- gleiche Preise wie die Softgetränke (2,90€/3,90€, unabhängig von Saft vs. Schorle).
insert into menu_items (category_id, name_hanzi, name_de, variant_options) values
  ((select id from categories where name_de = 'alkoholfreie getränke'), null, 'Johannisbeere',
    '[{"name_hanzi": "0.2L 纯果汁", "name_de": "0,2L Saft", "price": 3.90}, {"name_hanzi": "0.2L 果汁苏打", "name_de": "0,2L Schorle", "price": 2.90}, {"name_hanzi": "0.4L 纯果汁", "name_de": "0,4L Saft", "price": 4.90}, {"name_hanzi": "0.4L 果汁苏打", "name_de": "0,4L Schorle", "price": 3.90}]'),
  ((select id from categories where name_de = 'alkoholfreie getränke'), null, 'Apfel',
    '[{"name_hanzi": "0.2L 纯果汁", "name_de": "0,2L Saft", "price": 3.90}, {"name_hanzi": "0.2L 果汁苏打", "name_de": "0,2L Schorle", "price": 2.90}, {"name_hanzi": "0.4L 纯果汁", "name_de": "0,4L Saft", "price": 4.90}, {"name_hanzi": "0.4L 果汁苏打", "name_de": "0,4L Schorle", "price": 3.90}]'),
  ((select id from categories where name_de = 'alkoholfreie getränke'), null, 'Mango',
    '[{"name_hanzi": "0.2L 纯果汁", "name_de": "0,2L Saft", "price": 3.90}, {"name_hanzi": "0.2L 果汁苏打", "name_de": "0,2L Schorle", "price": 2.90}, {"name_hanzi": "0.4L 纯果汁", "name_de": "0,4L Saft", "price": 4.90}, {"name_hanzi": "0.5L 果汁苏打", "name_de": "0,5L Schorle", "price": 4.90}]'),
  ((select id from categories where name_de = 'alkoholfreie getränke'), null, 'Lychee',
    '[{"name_hanzi": "0.2L 纯果汁", "name_de": "0,2L Saft", "price": 3.90}, {"name_hanzi": "0.2L 果汁苏打", "name_de": "0,2L Schorle", "price": 2.90}, {"name_hanzi": "0.4L 纯果汁", "name_de": "0,4L Saft", "price": 4.90}, {"name_hanzi": "0.4L 果汁苏打", "name_de": "0,4L Schorle", "price": 3.90}]'),
  ((select id from categories where name_de = 'alkoholfreie getränke'), null, 'Maracuja',
    '[{"name_hanzi": "0.2L 纯果汁", "name_de": "0,2L Saft", "price": 3.90}, {"name_hanzi": "0.2L 果汁苏打", "name_de": "0,2L Schorle", "price": 2.90}, {"name_hanzi": "0.4L 纯果汁", "name_de": "0,4L Saft", "price": 4.90}, {"name_hanzi": "0.4L 果汁苏打", "name_de": "0,4L Schorle", "price": 3.90}]'),
  ((select id from categories where name_de = 'alkoholfreie getränke'), null, 'Orange',
    '[{"name_hanzi": "0.2L 纯果汁", "name_de": "0,2L Saft", "price": 3.90}, {"name_hanzi": "0.2L 果汁苏打", "name_de": "0,2L Schorle", "price": 2.90}, {"name_hanzi": "0.4L 纯果汁", "name_de": "0,4L Saft", "price": 4.90}, {"name_hanzi": "0.4L 果汁苏打", "name_de": "0,4L Schorle", "price": 3.90}]')
on conflict (category_id, name_de) do update set
  name_hanzi = excluded.name_hanzi,
  variant_options = excluded.variant_options;

-- Alkoholfreie Getränke (Rest) — ans Ende der Liste sortiert (nach den neuen
-- Softgetränken/Wasser/Säften oben). Reihenfolge innerhalb einer Kategorie richtet
-- sich nach menu_items.created_at (siehe useMenu.ts) — die explizite clock_timestamp()-
-- Aktualisierung unten schiebt diese beiden ans Ende, auch wenn die Zeilen aus einem
-- früheren seed.sql-Lauf schon existieren (ON CONFLICT DO UPDATE rührt created_at sonst
-- nicht an, und "now()" allein würde innerhalb derselben Transaktion nicht weiterlaufen).
insert into menu_items (category_id, name_hanzi, name_de, price) values
  ((select id from categories where name_de = 'alkoholfreie getränke'), null, 'Litschi-Eismilch', 5.90),
  ((select id from categories where name_de = 'alkoholfreie getränke'), null, 'Brasilianische Limonade', 5.90)
on conflict (category_id, name_de) do update set
  name_hanzi = excluded.name_hanzi,
  price = excluded.price;

update menu_items
set created_at = clock_timestamp()
where category_id = (select id from categories where name_de = 'alkoholfreie getränke')
  and name_de in ('Litschi-Eismilch', 'Brasilianische Limonade');

-- Cocktails — einheitlich 7,80€ für alle Sorten laut Karte.
insert into menu_items (category_id, name_hanzi, name_de, price) values
  ((select id from categories where name_de = 'cocktails'), null, 'Rote Sangria', 7.80),
  ((select id from categories where name_de = 'cocktails'), null, 'Sangria de Cava', 7.80),
  ((select id from categories where name_de = 'cocktails'), null, 'Miami Beach', 7.80),
  ((select id from categories where name_de = 'cocktails'), null, 'Mojito', 7.80),
  ((select id from categories where name_de = 'cocktails'), null, 'Aperol Spritz', 7.80),
  ((select id from categories where name_de = 'cocktails'), null, 'Hugo', 7.80),
  ((select id from categories where name_de = 'cocktails'), null, 'Pina Colada', 7.80),
  ((select id from categories where name_de = 'cocktails'), null, 'Tiffany Lady', 7.80),
  ((select id from categories where name_de = 'cocktails'), null, 'Gin Basil Smash', 7.80),
  ((select id from categories where name_de = 'cocktails'), null, 'Lillet Wild Berry', 7.80),
  ((select id from categories where name_de = 'cocktails'), null, 'Margarita', 7.80)
on conflict (category_id, name_de) do update set
  name_hanzi = excluded.name_hanzi,
  price = excluded.price;

-- Bier — alle Sorten einheitlich 4,20
insert into menu_items (category_id, name_hanzi, name_de, price) values
  ((select id from categories where name_de = 'bier'), null, 'Helles', 4.20),
  ((select id from categories where name_de = 'bier'), null, 'Dunkles Bier', 4.20),
  ((select id from categories where name_de = 'bier'), null, 'Weizen', 4.20),
  ((select id from categories where name_de = 'bier'), null, 'Dunkles Weizen', 4.20),
  ((select id from categories where name_de = 'bier'), null, 'Radler', 4.20),
  ((select id from categories where name_de = 'bier'), null, 'Cola-Weizen', 4.20),
  ((select id from categories where name_de = 'bier'), null, 'Russ', 4.20),
  ((select id from categories where name_de = 'bier'), null, 'Alkoholfreies Bier', 4.20),
  ((select id from categories where name_de = 'bier'), null, 'Alkoholfreies Weizen', 4.20),
  ((select id from categories where name_de = 'bier'), null, 'Leichtes Weizen', 4.20)

on conflict (category_id, name_de) do update set
  name_hanzi = excluded.name_hanzi,
  price = excluded.price;

-- Diverses: manueller Preis+Beschreibung-Eintrag statt festem Menü-Item (siehe
-- menu_items.is_custom_entry). OrderScreen.tsx öffnet dafür einen Dialog mit
-- Freitext-Beschreibung + Preis statt der normalen Varianten/Extras-Auswahl.
insert into menu_items (category_id, name_hanzi, name_de, is_custom_entry) values
  ((select id from categories where name_de = 'diverses essen'), '其他', 'Diverses', true),
  ((select id from categories where name_de = 'diverses getränke'), null, 'Diverses', true)
on conflict (category_id, name_de) do update set
  name_hanzi = excluded.name_hanzi,
  is_custom_entry = excluded.is_custom_entry;
