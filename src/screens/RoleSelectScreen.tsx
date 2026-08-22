import { useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
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
  }
}

export default function RoleSelectScreen({ navigation }: Props) {
  const styles = useThemedStyles(createStyles);
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
      setCloseError('Falsche PIN.');
      return;
    }

    setClosing(true);
    setCloseError(null);

    // orders hat "on delete cascade" auf order_items — ein delete auf orders
    // räumt beides leer. Der Filter ist nur nötig, damit Supabase den Delete-
    // Aufruf ohne Bedingung nicht ablehnt; er matcht aber jede echte Zeile.
    const { error } = await supabase.from('orders').delete().neq('id', '00000000-0000-0000-0000-000000000000');

    setClosing(false);

    if (error) {
      setCloseError(error.message);
      return;
    }

    setConfirmOpen(false);
    setPinText('');
  }

  return (
    <View style={styles.container}>
      <View style={styles.logoBackdrop}>
        <Image source={require('../../assets/yami-logo.png')} style={styles.logo} resizeMode="contain" />
      </View>
      {DEVICE_ROLES.map(({ role, label }) => (
        <TouchableOpacity key={role} style={styles.button} onPress={() => navigateToRole(navigation, role)}>
          <Text style={styles.buttonText}>{label}</Text>
        </TouchableOpacity>
      ))}

      <TouchableOpacity style={styles.dayCloseButton} onPress={openTagesabschlussDialog}>
        <Text style={styles.dayCloseButtonText}>Tagesabschluss</Text>
      </TouchableOpacity>

      <Modal visible={confirmOpen} transparent animationType="fade" onRequestClose={cancelTagesabschluss}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Tagesabschluss durchführen?</Text>
            <Text style={styles.modalBody}>
              Löscht alle offenen und fertigen Bestellungen unwiderruflich, damit morgen wieder bei null
              angefangen wird. Speisekarte und Tische bleiben erhalten. 将所有未完成和已完成的订单永久删除，以便明天从零
              开始。菜单和餐桌信息将保留。
            </Text>
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
                <Text style={styles.confirmButtonText}>Ja, alle Bestellungen löschen</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelButton} onPress={cancelTagesabschluss} disabled={closing}>
              <Text style={styles.cancelButtonText}>Abbrechen</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
      padding: 24,
      gap: 12,
    },
    // Das Logo ist weißes Linienwerk auf transparentem Hintergrund — im Light
    // Mode sonst unsichtbar. Fester dunkler Badge-Hintergrund statt einer
    // zweiten Bilddatei, damit das Logo in beiden Themes lesbar bleibt.
    logoBackdrop: {
      width: '80%',
      maxWidth: 320,
      backgroundColor: '#1c1c1e',
      borderRadius: 16,
      paddingVertical: 12,
      paddingHorizontal: 16,
      marginBottom: 16,
    },
    logo: {
      width: '100%',
      height: 120,
    },
    button: {
      width: '100%',
      maxWidth: 320,
      backgroundColor: colors.surface,
      paddingVertical: 16,
      borderRadius: 12,
      alignItems: 'center',
    },
    buttonText: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '600',
    },
    dayCloseButton: {
      width: '100%',
      maxWidth: 320,
      borderWidth: 1.5,
      borderColor: colors.danger,
      paddingVertical: 14,
      borderRadius: 12,
      alignItems: 'center',
      marginTop: 20,
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
      borderRadius: 14,
      padding: 20,
      width: '100%',
      maxWidth: 380,
    },
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
