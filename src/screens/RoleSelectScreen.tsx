import { useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ActivityIndicator, Image, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { DEVICE_ROLES, type DeviceRole } from '../types/role';
import { supabase } from '../lib/supabase';
import type { RootStackParamList } from '../navigation/types';

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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  async function handleTagesabschluss() {
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
  }

  return (
    <View style={styles.container}>
      <Image source={require('../../assets/yami-logo.png')} style={styles.logo} resizeMode="contain" />
      {DEVICE_ROLES.map(({ role, label }) => (
        <TouchableOpacity key={role} style={styles.button} onPress={() => navigateToRole(navigation, role)}>
          <Text style={styles.buttonText}>{label}</Text>
        </TouchableOpacity>
      ))}

      <TouchableOpacity
        style={styles.dayCloseButton}
        onPress={() => {
          setCloseError(null);
          setConfirmOpen(true);
        }}
      >
        <Text style={styles.dayCloseButtonText}>Tagesabschluss</Text>
      </TouchableOpacity>

      <Modal visible={confirmOpen} transparent animationType="fade" onRequestClose={() => setConfirmOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Tagesabschluss durchführen?</Text>
            <Text style={styles.modalBody}>
              Löscht alle offenen und fertigen Bestellungen unwiderruflich, damit morgen wieder bei null
              angefangen wird. Speisekarte und Tische bleiben erhalten. 将所有未完成和已完成的订单永久删除，以便明天从零
              开始。菜单和餐桌信息将保留。
            </Text>
            {closeError && <Text style={styles.errorText}>{closeError}</Text>}
            <TouchableOpacity
              style={[styles.confirmButton, closing && styles.confirmButtonDisabled]}
              onPress={handleTagesabschluss}
              disabled={closing}
            >
              {closing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.confirmButtonText}>Ja, alle Bestellungen löschen</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelButton} onPress={() => setConfirmOpen(false)} disabled={closing}>
              <Text style={styles.cancelButtonText}>Abbrechen</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111827',
    padding: 24,
    gap: 12,
  },
  logo: {
    width: '80%',
    maxWidth: 320,
    height: 120,
    marginBottom: 16,
  },
  button: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#1f2937',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  dayCloseButton: {
    width: '100%',
    maxWidth: 320,
    borderWidth: 1.5,
    borderColor: '#b91c1c',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 20,
  },
  dayCloseButtonText: {
    color: '#b91c1c',
    fontSize: 16,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 20,
    width: '100%',
    maxWidth: 380,
  },
  modalTitle: { fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 10 },
  modalBody: { fontSize: 14, color: '#374151', textAlign: 'center', marginBottom: 20, lineHeight: 20 },
  errorText: { color: '#b91c1c', textAlign: 'center', marginBottom: 12 },
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
  cancelButtonText: { fontSize: 15, color: '#6b7280' },
});
