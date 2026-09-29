import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { applyTableDiscount } from '../lib/discount';
import { formatPrice } from '../lib/pricing';
import type { ThemeColors } from '../theme/colors';
import { useThemedStyles } from '../theme/useThemedStyles';

const PERCENT_PRESETS = [10, 15, 20, 50];

// "🏷️ Rabatt hinzufügen" — gemeinsam genutzt von Tischübersicht (TableOverviewScreen.tsx)
// und Abrechnung (TableBillingScreen.tsx). Betrag frei eingeben oder per %-Kachel aus der
// aktuellen Tischsumme berechnen lassen; Beschreibung optional (fällt auf "Rabatt" zurück).
// Gebucht wird über lib/discount.ts, die Anzeige aktualisiert sich per Realtime.
export default function DiscountDialog({
  tableNumber,
  tableTotal,
  onClose,
}: {
  // null = Dialog geschlossen
  tableNumber: number | null;
  // Aktuelle Summe des Tisches (ohne bisherige Rabatte zu unterscheiden) — Basis für die
  // %-Kacheln. null/0 blendet die Kacheln aus.
  tableTotal: number | null;
  onClose: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  const [description, setDescription] = useState('');
  const [amountText, setAmountText] = useState('');
  const [activePercent, setActivePercent] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bei jedem Öffnen (anderer Tisch oder erneut) die Eingaben zurücksetzen.
  const [openFor, setOpenFor] = useState<number | null>(null);
  if (tableNumber !== openFor) {
    setOpenFor(tableNumber);
    setDescription('');
    setAmountText('');
    setActivePercent(null);
    setError(null);
    setSaving(false);
  }

  if (tableNumber === null) return null;

  const normalized = amountText.trim().replace(',', '.');
  const amount = normalized ? Number.parseFloat(normalized) : NaN;
  const valid = Number.isFinite(amount) && amount > 0;

  function pickPercent(percent: number) {
    if (!tableTotal) return;
    const value = Math.round(tableTotal * percent) / 100;
    setAmountText(value.toFixed(2).replace('.', ','));
    setActivePercent(percent);
    if (!description.trim() || /^\d+ % Rabatt$/.test(description.trim())) setDescription(`${percent} % Rabatt`);
  }

  async function confirm() {
    if (!valid || tableNumber === null) return;
    setSaving(true);
    setError(null);
    const result = await applyTableDiscount({ tableNumber, description, amount });
    setSaving(false);
    if (result) {
      setError(result);
      return;
    }
    onClose();
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.card}>
          <Text style={styles.emoji}>🏷️</Text>
          <Text style={styles.title}>Rabatt für Tisch {tableNumber}</Text>
          {!!tableTotal && tableTotal > 0 && (
            <>
              <Text style={styles.subtitle}>Tischsumme {formatPrice(tableTotal)}</Text>
              <View style={styles.presetRow}>
                {PERCENT_PRESETS.map((percent) => (
                  <TouchableOpacity
                    key={percent}
                    style={[styles.preset, activePercent === percent && styles.presetActive]}
                    onPress={() => pickPercent(percent)}
                  >
                    <Text style={[styles.presetText, activePercent === percent && styles.presetTextActive]}>
                      {percent} %
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
          <Text style={styles.label}>Betrag (€)</Text>
          <TextInput
            style={[styles.input, styles.amountInput]}
            value={amountText}
            onChangeText={(text) => {
              setActivePercent(null);
              setAmountText(text.replace(/[^0-9.,]/g, ''));
            }}
            placeholder="0,00"
            placeholderTextColor={styles.placeholder.color as string}
            keyboardType="decimal-pad"
            autoFocus
          />
          <Text style={styles.label}>Beschreibung (optional)</Text>
          <TextInput
            style={styles.input}
            value={description}
            onChangeText={setDescription}
            placeholder="z.B. Stammgast, Geburtstag"
            placeholderTextColor={styles.placeholder.color as string}
          />
          {error && <Text style={styles.error}>{error}</Text>}
          <TouchableOpacity
            style={[styles.primary, (!valid || saving) && styles.primaryDisabled]}
            onPress={confirm}
            disabled={!valid || saving}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryText}>
                {valid ? `🏷️ − ${formatPrice(amount)} abziehen` : 'Betrag eingeben'}
              </Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancel} onPress={onClose} disabled={saving}>
            <Text style={styles.cancelText}>Abbrechen</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    overlay: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: 20 },
    card: { backgroundColor: colors.surface, borderRadius: 22, padding: 20, width: '100%', maxWidth: 400 },
    emoji: { fontSize: 36, textAlign: 'center' },
    title: { fontSize: 20, fontWeight: '800', color: colors.text, textAlign: 'center', marginTop: 4 },
    subtitle: { fontSize: 13, color: colors.textMuted, textAlign: 'center', marginTop: 2, marginBottom: 10 },
    presetRow: { flexDirection: 'row', gap: 8, justifyContent: 'center', marginBottom: 4 },
    preset: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 12,
      alignItems: 'center',
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1.5,
      borderColor: 'transparent',
    },
    presetActive: { backgroundColor: colors.accentSurface, borderColor: colors.accent },
    presetText: { fontSize: 15, fontWeight: '800', color: colors.text },
    presetTextActive: { color: colors.accent },
    label: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginTop: 10, marginBottom: 4 },
    input: {
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 16,
      color: colors.text,
      backgroundColor: colors.background,
    },
    amountInput: { fontSize: 22, fontWeight: '800', textAlign: 'center' },
    placeholder: { color: colors.textFaint },
    error: { color: colors.danger, textAlign: 'center', marginTop: 10 },
    primary: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
    primaryDisabled: { backgroundColor: colors.textFaint },
    primaryText: { color: '#fff', fontSize: 16, fontWeight: '800' },
    cancel: { paddingVertical: 12, alignItems: 'center' },
    cancelText: { fontSize: 15, color: colors.textMuted },
  });
