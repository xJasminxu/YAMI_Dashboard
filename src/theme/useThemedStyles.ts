import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import type { ThemeColors } from './colors';
import { useTheme } from './ThemeContext';

// Baut aus einer Style-Fabrik (colors) => StyleSheet ein memoisiertes StyleSheet,
// das sich neu berechnet, sobald der Nutzer zwischen Hell-/Dunkelmodus umschaltet.
export function useThemedStyles<T extends StyleSheet.NamedStyles<T>>(factory: (colors: ThemeColors) => T): T {
  const { colors } = useTheme();
  return useMemo(() => StyleSheet.create(factory(colors)), [colors, factory]);
}
