import { useWindowDimensions } from 'react-native';

// Kürzeste Bildschirmseite unter 600dp = Handy (gängige Android-/iOS-Grenze zwischen
// Phone und Tablet). Über die KÜRZERE Seite statt nur die Breite, damit ein Handy im
// Querformat weiterhin als Handy zählt und ein Tablet im Hochformat weiterhin als Tablet.
// Reagiert live auf Drehen/Fenstergröße (Web), da useWindowDimensions neu rendert.
export const PHONE_MAX_SHORT_SIDE = 600;

export function useIsPhone(): boolean {
  const { width, height } = useWindowDimensions();
  return Math.min(width, height) < PHONE_MAX_SHORT_SIDE;
}
