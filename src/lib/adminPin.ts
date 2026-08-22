// PIN für destruktive Admin-Aktionen, die nicht aus Versehen von Gästen/Aushilfen
// ausgelöst werden dürfen (Tagesabschluss in RoleSelectScreen.tsx, "Tisch löschen" in
// TableOverviewScreen.tsx) — rein clientseitige Prüfung, wie der Rest der App (keine
// Logins, vertrauenswürdige Geräte im Restaurant-WLAN, siehe CLAUDE.md).
export const ADMIN_PIN = '0604';
