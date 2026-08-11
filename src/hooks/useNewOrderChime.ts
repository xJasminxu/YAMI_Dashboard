import { useEffect, useRef } from 'react';
import { useAudioPlayer } from 'expo-audio';
import type { GroupedOrder } from './useDeviceOrders';

const BELL_SOUND = require('../../assets/new_order_sound.mp3');
// Lauter abgemischte Variante (Dynamic-Range-Kompression + Limiter statt reiner
// Lautstärke-Verstärkung, da player.volume schon standardmäßig bei 1.0/Maximum liegt —
// mehr Software-Gain würde nur hart clippen) für die Küche: dort steht das Tablet oft
// an der Wand mit Küchenlärm drumherum, an der Bar reicht die normale Lautstärke.
const BELL_SOUND_LOUD = require('../../assets/new_order_sound_kitchen.mp3');

// Spielt einen Glockenton, sobald eine bisher unbekannte Bestellung (orderId)
// in `orders` auftaucht — also bei einer neuen Bestellung, nicht bei jedem
// Realtime-Update (z.B. Status-Änderungen lösen keinen Ton aus). Beim ersten
// Laden der Komponente wird nur der Ist-Zustand gemerkt, nicht geklingelt,
// sonst würde jede bereits offene Bestellung beim App-Start läuten.
export function useNewOrderChime(orders: GroupedOrder[], enabled: boolean, loud: boolean = false) {
  const player = useAudioPlayer(loud ? BELL_SOUND_LOUD : BELL_SOUND);
  const knownIds = useRef<Set<string> | null>(null);

  useEffect(() => {
    const currentIds = new Set(orders.map((order) => order.orderId));

    if (knownIds.current === null) {
      knownIds.current = currentIds;
      return;
    }

    const hasNewOrder = Array.from(currentIds).some((id) => !knownIds.current!.has(id));
    knownIds.current = currentIds;

    if (hasNewOrder && enabled) {
      player.seekTo(0);
      player.play();
    }
  }, [orders, enabled, player]);
}
