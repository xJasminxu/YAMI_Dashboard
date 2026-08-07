import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { darkColors, lightColors, type ThemeColors } from './colors';

export type ThemeScheme = 'light' | 'dark';

interface ThemeContextValue {
  scheme: ThemeScheme;
  colors: ThemeColors;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  // Startet mit dem System-Farbschema des Geräts; danach entscheidet einzig der
  // Umschalter oben in der App-Leiste. Bewusst nicht persistiert — die Geräte laufen
  // als fest installierte Rollen-Tablets meist durch, ein App-Neustart ist selten.
  const [scheme, setScheme] = useState<ThemeScheme>(systemScheme === 'dark' ? 'dark' : 'light');

  const value = useMemo<ThemeContextValue>(
    () => ({
      scheme,
      colors: scheme === 'dark' ? darkColors : lightColors,
      toggleTheme: () => setScheme((current) => (current === 'dark' ? 'light' : 'dark')),
    }),
    [scheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme muss innerhalb eines ThemeProvider verwendet werden.');
  return ctx;
}
