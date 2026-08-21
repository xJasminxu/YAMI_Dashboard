// Gemeinsam genutzt von TableBillingScreen.tsx (Zeitstempel pro Position) und
// TableOverviewScreen.tsx (Abschlusszeitpunkt vergangener Tische).

// Datum + Uhrzeit statt nur Uhrzeit (siehe DeviceTicketBoard.tsx/formatTime) — hier
// können nachträglich auch mal Zeitstempel von vor Mitternacht oder, falls der
// Tagesabschluss mal einen Tag ausgelassen wurde, von einem ganz anderen Tag auftauchen.
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
