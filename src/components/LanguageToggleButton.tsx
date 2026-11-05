import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';

// Sprachumschalter Deutsch ⇄ Chinesisch, sitzt neben dem Hell/Dunkel-Umschalter rechts in
// der App-Leiste (siehe RootNavigator). Zeigt die Sprache, zu der gewechselt wird.
export default function LanguageToggleButton() {
  const { lang, toggleLanguage } = useI18n();
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      onPress={toggleLanguage}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      style={[styles.button, { borderColor: colors.borderStrong }]}
      accessibilityRole="button"
      accessibilityLabel={lang === 'de' ? '切换到中文' : 'Auf Deutsch umschalten'}
    >
      <Text style={[styles.text, { color: colors.text }]}>{lang === 'de' ? '中文' : 'DE'}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1.5, marginRight: 4 },
  text: { fontSize: 14, fontWeight: '800' },
});
