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
  // closed: true → Aufruf aus "Vergangene Tische" (TableOverviewScreen.tsx), zeigt die
  // bereits abgeschlossene(n) Bestellung(en) dieser Tischnummer statt der aktuellen.
  TableBilling: { tableNumber: number; closed?: boolean };
};
