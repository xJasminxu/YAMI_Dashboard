export type RootStackParamList = {
  RoleSelect: undefined;
  Order: undefined;
  Kitchen: undefined;
  Bar: undefined;
  Status: undefined;
  TableDetail: { tableNumber: number };
  TableOverview: undefined;
  // closed: true → Aufruf aus "Vergangene Tische" (TableOverviewScreen.tsx), zeigt die
  // bereits abgeschlossene(n) Bestellung(en) dieser Tischnummer statt der aktuellen.
  TableBilling: { tableNumber: number; closed?: boolean };
};
