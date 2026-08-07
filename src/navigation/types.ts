export type RootStackParamList = {
  RoleSelect: undefined;
  Order: undefined;
  Kitchen: undefined;
  Bar: undefined;
  Status: undefined;
  TableDetail: { tableNumber: number };
  TableOverview: undefined;
  TableBilling: { tableNumber: number };
  PdfViewer: { moduleId: number; title: string };
};
