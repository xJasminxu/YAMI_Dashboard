# YAMI Dashboard

Digitales Bestellsystem für die Kommunikation Bedienung → Küche/Bar. Kein Zusammenhang mit
dem bestehenden Kassensystem. Details, Anforderungen und Architektur: siehe `CLAUDE.md`.

## Status

Projekt ist noch nicht gescaffoldet — nur Spezifikation (`CLAUDE.md`) und Datenbank-Schema
(`supabase/`) liegen bereit. Gedacht als Startpunkt für Claude Code.

## Erste Schritte mit Claude Code

1. Diesen Ordner in Claude Code öffnen.
2. Claude Code bitten, anhand von `CLAUDE.md` das Expo/React-Native-Projekt zu scaffolden
   (`npx create-expo-app`, TypeScript-Template, Supabase-Client, React Navigation).
3. Ein Supabase-Projekt anlegen (supabase.com), `supabase/schema.sql` im SQL-Editor
   ausführen.
4. Vor dem Ausführen von `supabase/seed.sql`: die offenen Fragen darin klären
   (Softgetränke/Bier-Kategorien, Hanzi-Übersetzungen von Küchenpersonal prüfen lassen).
5. `.env` gemäß `.env.example` mit der Supabase-URL und dem anon-Key füllen.
6. Mit dem Bestell-Screen anfangen (siehe Bau-Reihenfolge in `CLAUDE.md`).

## Projektstruktur (geplant)

```
src/
  lib/            # Supabase-Client, Hilfsfunktionen
  types/          # TypeScript-Typen (Category, MenuItem, Order, OrderItem, ...)
  navigation/      # Rollenauswahl + Navigation
  screens/
    order/         # Bestellaufnahme
    kitchen/        # Küchen-Ansicht
    bar/            # Bar-Ansicht
    status/          # Status-Übersicht für Bedienungen
  components/
  hooks/           # z.B. useRealtimeOrders
supabase/
  schema.sql
  seed.sql
```
