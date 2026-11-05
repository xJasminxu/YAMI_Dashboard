import { useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { DEVICE_ROLES, type DeviceRole } from '../types/role';
import { ADMIN_PIN } from '../lib/adminPin';
import { supabase } from '../lib/supabase';
import type { RootStackParamList } from '../navigation/types';
import type { ThemeColors } from '../theme/colors';
import { useThemedStyles } from '../theme/useThemedStyles';
import { useI18n } from '../i18n/LanguageContext';
import type { StringKey } from '../i18n/strings';

// Beschriftung je Rolle auf Chinesisch (auf Deutsch: label + hanzi aus DEVICE_ROLES). Die
// Bar bleibt auch dann "Bar" — alles, was zur Bar gehört, ist immer Deutsch.
const ROLE_KEYS: Record<DeviceRole, StringKey | null> = {
  order: 'roleOrder',
  kitchen: 'roleKitchen',
  bar: null,
  status: 'roleStatus',
  billing: 'roleBilling',
  revenue: 'roleRevenue',
  admin: 'roleAdmin',
};

type Props = NativeStackScreenProps<RootStackParamList, 'RoleSelect'>;

function navigateToRole(navigation: Props['navigation'], role: DeviceRole) {
  switch (role) {
    case 'order':
      navigation.navigate('Order');
      return;
    case 'kitchen':
      navigation.navigate('Kitchen');
      return;
    case 'bar':
      navigation.navigate('Bar');
      return;
    case 'status':
      navigation.navigate('Status');
      return;
    case 'billing':
      navigation.navigate('TableOverview');
      return;
    case 'revenue':
      navigation.navigate('Revenue');
      return;
    case 'admin':
      navigation.navigate('Admin');
      return;
  }
}

export default function RoleSelectScreen({ navigation }: Props) {
  const styles = useThemedStyles(createStyles);
  const { lang, t } = useI18n();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pinText, setPinText] = useState('');
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  function openTagesabschlussDialog() {
    setPinText('');
    setCloseError(null);
    setConfirmOpen(true);
  }

  function cancelTagesabschluss() {
    setConfirmOpen(false);
    setPinText('');
    setCloseError(null);
  }

  async function handleTagesabschluss() {
    if (pinText !== ADMIN_PIN) {
      setCloseError(t('wrongPin'));
      return;
    }

    setClosing(true);
    setCloseError(null);

    // orders hat "on delete cascade" auf order_items — ein delete auf orders
    // räumt beides leer. Der Filter ist nur nötig, damit Supabase den Delete-
    // Aufruf ohne Bedingung nicht ablehnt; er matcht aber jede echte Zeile.
    // Parallel dazu werden auch alle Tisch-Notizen zurückgesetzt (tables.note, siehe
    // schema.sql) — anders als "Tisch abschließen" (dort bleibt die Notiz bewusst
    // erhalten) soll der Tagesabschluss wirklich bei null anfangen, damit am nächsten Tag
    // nicht noch eine Notiz von gestern an einem frisch besetzten Tisch hängt.
    const [{ error: ordersError }, { error: notesError }] = await Promise.all([
      supabase.from('orders').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
      supabase.from('tables').update({ note: null }).neq('id', '00000000-0000-0000-0000-000000000000'),
    ]);

    setClosing(false);

    const error = ordersError ?? notesError;
    if (error) {
      setCloseError(error.message);
      return;
    }

    setConfirmOpen(false);
    setPinText('');
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <View style={styles.logoBackdrop}>
        <Image source={require('../../assets/yami-logo.png')} style={styles.logo} resizeMode="contain" />
      </View>
      <Text style={styles.greeting}>{t('welcome')}</Text>
      <Text style={styles.subGreeting}>{t('whichRole')}</Text>

      <View style={styles.roleList}>
        {DEVICE_ROLES.map(({ role, emoji, label, hanzi }) => (
          <TouchableOpacity
            key={role}
            style={[styles.button, role === 'order' && styles.buttonPrimary]}
            onPress={() => navigateToRole(navigation, role)}
            activeOpacity={0.8}
          >
            <View style={[styles.emojiBubble, role === 'order' && styles.emojiBubblePrimary]}>
              <Text style={styles.emoji}>{emoji}</Text>
            </View>
            <View style={styles.buttonTextWrap}>
              <Text style={[styles.buttonText, role === 'order' && styles.buttonTextPrimary]}>
                {lang === 'zh' && ROLE_KEYS[role] ? t(ROLE_KEYS[role]!) : label}
              </Text>
              {lang === 'de' && (
                <Text style={[styles.buttonHanzi, role === 'order' && styles.buttonHanziPrimary]}>{hanzi}</Text>
              )}
            </View>
            <Text style={[styles.chevron, role === 'order' && styles.buttonTextPrimary]}>›</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={styles.dayCloseButton} onPress={openTagesabschlussDialog}>
        <Text style={styles.dayCloseButtonText}>{t('dayClose')}</Text>
      </TouchableOpacity>

      <Modal visible={confirmOpen} transparent animationType="fade" onRequestClose={cancelTagesabschluss}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalCard}>
            <Text style={styles.modalEmoji}>🧹</Text>
            <Text style={styles.modalTitle}>{t('dayCloseTitle')}</Text>
            <Text style={styles.modalBody}>{t('dayCloseBody')}</Text>
            <TextInput
              style={styles.pinInput}
              value={pinText}
              onChangeText={setPinText}
              placeholder="PIN"
              placeholderTextColor={styles.pinInputPlaceholder.color as string}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={4}
              autoFocus
            />
            {closeError && <Text style={styles.errorText}>{closeError}</Text>}
            <TouchableOpacity
              style={[styles.confirmButton, (closing || !pinText) && styles.confirmButtonDisabled]}
              onPress={handleTagesabschluss}
              disabled={closing || !pinText}
            >
              {closing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.confirmButtonText}>{t('dayCloseConfirm')}</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelButton} onPress={cancelTagesabschluss} disabled={closing}>
              <Text style={styles.cancelButtonText}>{t('cancel')}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    scroll: { flex: 1, backgroundColor: colors.background },
    container: {
      flexGrow: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    // Das Logo ist weißes Linienwerk auf transparentem Hintergrund — im Light
    // Mode sonst unsichtbar. Fester dunkler Badge-Hintergrund statt einer
    // zweiten Bilddatei, damit das Logo in beiden Themes lesbar bleibt.
    logoBackdrop: {
      width: '80%',
      maxWidth: 360,
      backgroundColor: '#1c1c1e',
      borderRadius: 24,
      paddingVertical: 16,
      paddingHorizontal: 20,
      marginBottom: 20,
      shadowColor: colors.shadow,
      shadowOpacity: 0.25,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 8 },
      elevation: 6,
    },
    logo: {
      width: '100%',
      height: 120,
    },
    greeting: { fontSize: 24, fontWeight: '800', color: colors.text, textAlign: 'center' },
    subGreeting: {
      fontSize: 14,
      color: colors.textMuted,
      textAlign: 'center',
      marginTop: 4,
      marginBottom: 20,
    },
    roleList: { width: '100%', maxWidth: 420, gap: 12 },
    button: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      paddingVertical: 14,
      paddingHorizontal: 16,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
      shadowColor: colors.shadow,
      shadowOpacity: 0.06,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
      elevation: 2,
    },
    buttonPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
    emojiBubble: {
      width: 48,
      height: 48,
      borderRadius: 14,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 14,
    },
    emojiBubblePrimary: { backgroundColor: 'rgba(255,255,255,0.22)' },
    emoji: { fontSize: 26 },
    buttonTextWrap: { flex: 1 },
    buttonText: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '700',
    },
    buttonTextPrimary: { color: colors.onAccent },
    buttonHanzi: { color: colors.textMuted, fontSize: 14, marginTop: 1 },
    buttonHanziPrimary: { color: 'rgba(255,255,255,0.85)' },
    chevron: { fontSize: 28, color: colors.textFaint, marginLeft: 8, fontWeight: '300' },
    dayCloseButton: {
      width: '100%',
      maxWidth: 420,
      borderWidth: 1.5,
      borderColor: colors.danger,
      borderStyle: 'dashed',
      paddingVertical: 14,
      borderRadius: 18,
      alignItems: 'center',
      marginTop: 28,
    },
    dayCloseButtonText: {
      color: colors.danger,
      fontSize: 16,
      fontWeight: '700',
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: colors.overlay,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    modalCard: {
      backgroundColor: colors.surface,
      borderRadius: 20,
      padding: 22,
      width: '100%',
      maxWidth: 380,
    },
    modalEmoji: { fontSize: 40, textAlign: 'center', marginBottom: 6 },
    modalTitle: { fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 10, color: colors.text },
    modalBody: {
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: 'center',
      marginBottom: 20,
      lineHeight: 20,
    },
    errorText: { color: colors.danger, textAlign: 'center', marginBottom: 12 },
    pinInput: {
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 12,
      fontSize: 16,
      color: colors.text,
      textAlign: 'center',
    },
    pinInputPlaceholder: { color: colors.textFaint },
    confirmButton: {
      backgroundColor: '#b91c1c',
      borderRadius: 10,
      paddingVertical: 14,
      alignItems: 'center',
      marginBottom: 10,
    },
    confirmButtonDisabled: { backgroundColor: '#f3a3a3' },
    confirmButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
    cancelButton: { paddingVertical: 10, alignItems: 'center' },
    cancelButtonText: { fontSize: 15, color: colors.textMuted },
  });
