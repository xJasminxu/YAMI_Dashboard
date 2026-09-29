// Farbpaletten für Hell-/Dunkelmodus. Bewusst an der bisher schon im Code verwendeten
// Tailwind-Grau-/Akzentskala orientiert (siehe z.B. RoleSelectScreen, das schon immer
// #111827 als Hintergrund hatte), damit sich Hellmodus und Dunkelmodus wie zwei
// Varianten desselben Looks anfühlen statt wie zwei verschiedene Apps.
export interface ThemeColors {
  background: string;
  surface: string; // Karten, Zeilen, Eingabefelder
  surfaceAlt: string; // Kategorie-/Numpad-Buttons, dezente Chips
  border: string;
  borderStrong: string;
  text: string; // Haupttext/Überschriften
  textSecondary: string;
  textMuted: string;
  textFaint: string; // Platzhalter, "erledigt"/inaktiv
  primary: string; // Links, aktive Tabs
  success: string;
  successSurface: string;
  danger: string;
  warning: string;
  overlay: string; // Modal-Hintergrund
  cardNeu: string; // Küchen-/Bar-Ticket: neu
  cardAngefangen: string; // Küchen-/Bar-Ticket: teilweise fertig
  cardFertig: string; // Küchen-/Bar-Ticket: fertig
  accent: string; // YAMI-Markenfarbe (warmes Rot-Orange, "Grill-Glut") für Hauptaktionen
  accentSurface: string; // dezenter Hintergrund in Akzentfarbe (z.B. aktive Chips, Badges)
  onAccent: string; // Text auf accent
  shadow: string; // Schattenfarbe für Karten
}

// Hellmodus: leicht warmer "Papier"-Hintergrund mit weißen Karten darauf, damit Karten
// und Buttons sich sichtbar abheben (vorher weiß auf fast-weiß).
export const lightColors: ThemeColors = {
  background: '#f7f5f2',
  surface: '#ffffff',
  surfaceAlt: '#f1eeea',
  border: '#e7e3de',
  borderStrong: '#d4cec7',
  text: '#111827',
  textSecondary: '#374151',
  textMuted: '#6b7280',
  textFaint: '#9ca3af',
  primary: '#2563eb',
  success: '#16a34a',
  successSurface: '#dcfce7',
  danger: '#b91c1c',
  warning: '#b45309',
  overlay: 'rgba(0,0,0,0.4)',
  cardNeu: '#dbeafe',
  cardAngefangen: '#fde2ea',
  cardFertig: '#dcfce7',
  accent: '#e4572e',
  accentSurface: '#fdebe4',
  onAccent: '#ffffff',
  shadow: '#1c1917',
};

export const darkColors: ThemeColors = {
  background: '#111827',
  surface: '#1f2937',
  surfaceAlt: '#273244',
  border: '#374151',
  borderStrong: '#4b5563',
  text: '#f3f4f6',
  textSecondary: '#d1d5db',
  textMuted: '#9ca3af',
  textFaint: '#6b7280',
  primary: '#60a5fa',
  success: '#4ade80',
  successSurface: '#14532d',
  danger: '#f87171',
  warning: '#fbbf24',
  overlay: 'rgba(0,0,0,0.6)',
  cardNeu: '#1e3a5f',
  cardAngefangen: '#4c1d3d',
  cardFertig: '#14532d',
  accent: '#f26b43',
  accentSurface: '#3b2019',
  onAccent: '#ffffff',
  shadow: '#000000',
};
