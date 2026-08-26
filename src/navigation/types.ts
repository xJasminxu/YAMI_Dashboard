export type RootStackParamList = {
  RoleSelect: undefined;
  // tableNumber optional: gesetzt, wenn die Bestellaufnahme über den "+"-Button einer
  // Tischkarte in der Tischübersicht (TableOverviewScreen.tsx) geöffnet wurde — dann ist
  // die Tischnummer im Bestell-Screen schon vorausgefüllt statt manuell einzutippen.
  Order: { tableNumber?: number } | undefined;
  Kitchen: undefined;
  Bar: undefined;
  Status: undefined;
  TableDetail: { tableNumber: number };
  TableOverview: undefined;
  // closed: true → Aufruf aus "Vergangene Tische" (TableOverviewScreen.tsx). closedAt
  // identifiziert dabei genau EINEN Abschluss-Vorgang dieser Tischnummer (orders.closed_at,
  // exakt gleicher Zeitstempel für alle orders, die bei diesem "Tisch abschließen" auf
  // einmal geschlossen wurden) — ohne closedAt würden bei mehrfach am Tag besetzten Tischen
  // alle vergangenen Besetzungen zusammen angezeigt statt nur der angetippten.
  TableBilling: { tableNumber: number; closed?: boolean; closedAt?: string };
};
