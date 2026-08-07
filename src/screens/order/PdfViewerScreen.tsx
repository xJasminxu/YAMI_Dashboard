import { useEffect, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Asset } from 'expo-asset';
import Pdf from 'react-native-pdf';
import type { RootStackParamList } from '../../navigation/types';
import type { ThemeColors } from '../../theme/colors';
import { useThemedStyles } from '../../theme/useThemedStyles';

type Props = NativeStackScreenProps<RootStackParamList, 'PdfViewer'>;

// Zeigt eine gebündelte PDF (Speisekarte/Getränkekarte) nativ innerhalb der App an,
// statt sie über den OS-Share-/Download-Dialog zu öffnen. react-native-pdf braucht
// dafür einen echten Datei-URI statt der Metro-Modul-ID aus require() — Asset.
// downloadAsync() löst das auf, egal ob im Dev-Client (Packager) oder im fertigen Build
// (bereits gebündelt).
export default function PdfViewerScreen({ route, navigation }: Props) {
  const styles = useThemedStyles(createStyles);
  const { moduleId, title } = route.params;
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    navigation.setOptions({ title });
  }, [navigation, title]);

  useEffect(() => {
    let cancelled = false;
    setUri(null);
    setError(null);

    Asset.fromModule(moduleId)
      .downloadAsync()
      .then((asset) => {
        if (!cancelled) setUri(asset.localUri ?? asset.uri);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'PDF konnte nicht geladen werden.');
      });

    return () => {
      cancelled = true;
    };
  }, [moduleId]);

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  if (!uri) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <Pdf
      source={{ uri }}
      style={styles.pdf}
      onError={(e) => setError(e instanceof Error ? e.message : 'PDF konnte nicht angezeigt werden.')}
    />
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
    errorText: { color: colors.danger, padding: 16, textAlign: 'center' },
    pdf: { flex: 1, backgroundColor: colors.background },
  });
