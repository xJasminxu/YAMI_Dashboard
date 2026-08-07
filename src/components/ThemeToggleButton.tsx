import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

// Umschalter für Hell-/Dunkelmodus, sitzt via screenOptions.headerRight (siehe
// RootNavigator) rechts in der App-Leiste jedes Screens.
export default function ThemeToggleButton() {
  const { scheme, toggleTheme } = useTheme();
  return (
    <TouchableOpacity
      onPress={toggleTheme}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      style={styles.button}
      accessibilityRole="button"
      accessibilityLabel={scheme === 'dark' ? 'Zu hellem Modus wechseln' : 'Zu dunklem Modus wechseln'}
    >
      <Text style={styles.icon}>{scheme === 'dark' ? '☀️' : '🌙'}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: { paddingHorizontal: 10, paddingVertical: 4 },
  icon: { fontSize: 19 },
});
