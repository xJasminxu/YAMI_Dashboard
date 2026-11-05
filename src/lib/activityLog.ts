import type { ActivityKind } from '../types/database';
import { supabase } from './supabase';

// Aufbewahrungsdauer des Admin-Protokolls (activity_log, siehe schema.sql). Danach werden
// Einträge endgültig gelöscht — serverseitig per pg_cron, zusätzlich hier im Client.
export const ACTIVITY_RETENTION_DAYS = 3;
const RETENTION_MS = ACTIVITY_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export function retentionCutoffIso(): string {
  return new Date(Date.now() - RETENTION_MS).toISOString();
}

// Endgültiges Löschen abgelaufener Einträge. Fallback für Projekte ohne pg_cron — die
// RLS-Policy erlaubt ohnehin nur das Löschen von Einträgen, die älter als 3 Tage sind.
export async function purgeExpiredActivity(): Promise<void> {
  await supabase.from('activity_log').delete().lt('created_at', retentionCutoffIso());
}

// Schreibt einen Protokoll-Eintrag. Bewusst "fire and forget": ein fehlgeschlagener
// Log-Eintrag soll nie die eigentliche Aktion (Löschen, Absenden) blockieren.
export function logActivity(entry: {
  kind: ActivityKind;
  tableNumber: number | null;
  summary: string;
  amount: number | null;
  details?: { name: string; price: number | null }[];
}): void {
  supabase
    .from('activity_log')
    .insert({
      kind: entry.kind,
      table_number: entry.tableNumber,
      summary: entry.summary,
      amount: entry.amount,
      details: entry.details && entry.details.length > 0 ? entry.details : null,
    })
    .then(({ error }) => {
      if (error) console.warn('activity_log konnte nicht geschrieben werden:', error.message);
    });
  purgeExpiredActivity().catch(() => {});
}
