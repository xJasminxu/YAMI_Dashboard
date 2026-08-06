-- YAMI Dashboard — Seed-Daten (Kategorien)
--
-- WICHTIG: Die Hanzi-Bezeichnungen unten sind gängige Standardübersetzungen,
-- aber NICHT von muttersprachlichem Küchenpersonal geprüft. Bitte vor dem
-- produktiven Einsatz von jemandem aus der Küche gegenlesen lassen — falsche
-- Beschriftung ist hier besonders ärgerlich, weil die Küche sich primär
-- darauf verlässt.
--
-- OFFENE FRAGE (siehe CLAUDE.md): Die geforderte Bar-Sortierung nennt
-- "Softgetränke" und "Bier", die in der ursprünglichen Kategorienliste des
-- Nutzers nicht auftauchen. Unten ist "alkoholfreie cocktails" testweise auf
-- Position 1 (Softgetränke-Slot) gesetzt und "Bier" fehlt komplett. Bitte mit
-- Nutzer klären und diese Datei danach anpassen.

-- Essen → Küche, Sortierung: Vorspeise (1-2) → Hauptspeise (3-6) → Barbecue (7)
insert into categories (name_hanzi, name_de, menu_group, target_device, sort_order) values
  ('小吃', 'kleinigkeiten', 'essen', 'kitchen', 1),
  ('汤', 'suppen', 'essen', 'kitchen', 2),
  ('炸鸡', 'fried chicken', 'essen', 'kitchen', 3),
  ('热菜', 'warme speisen', 'essen', 'kitchen', 4),
  ('拉面', 'ramen', 'essen', 'kitchen', 5),
  ('面条', 'nudeln', 'essen', 'kitchen', 6),
  ('韩式烤肉', 'korean bbq', 'essen', 'kitchen', 7);

-- Getränke + Nachspeisen → Bar
-- Ziel-Sortierung lt. Anforderung: Softgetränke → Bier → Cocktails → Spirituosen
-- → Kaffee/Matcha → Nachspeise (siehe offene Frage oben zu Softgetränke/Bier)
insert into categories (name_hanzi, name_de, menu_group, target_device, sort_order) values
  ('无酒精鸡尾酒', 'alkoholfreie cocktails', 'getraenke', 'bar', 1), -- Platzhalter für "Softgetränke"
  ('鸡尾酒', 'cocktails', 'getraenke', 'bar', 2),
  ('烈酒', 'spirituosen', 'getraenke', 'bar', 3),
  ('咖啡/抹茶', 'kaffee/matcha', 'getraenke', 'bar', 4),
  ('麻薯冰淇淋', 'mochi eis', 'nachspeisen', 'bar', 5),
  ('冰淇淋', 'eis', 'nachspeisen', 'bar', 6),
  ('刨冰', 'bingsu', 'nachspeisen', 'bar', 7);

-- Beispiel-Tische (bei Bedarf Anzahl/Nummern anpassen)
insert into tables (number)
select generate_series(1, 20);
