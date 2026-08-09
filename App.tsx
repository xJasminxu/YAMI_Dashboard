import { DarkTheme, DefaultTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { setAudioModeAsync } from 'expo-audio';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import RootNavigator from './src/navigation/RootNavigator';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';

// Ohne diesen Aufruf bleibt iOS bei der Standard-Audiosession ("SoloAmbient"), die den
// Ton stummschaltet, sobald der Stumm-Schalter am Gerät (bzw. die Stumm-Taste am iPad)
// aktiv ist — genau der Zustand, in dem ein an die Wand montiertes Küchen-Tablet oft
// steht. `playsInSilentMode: true` lässt den Bestell-Glockenton trotzdem durch.
// `mixWithOthers`, damit die Glocke keine ggf. laufende andere App-Audioausgabe kappt.
setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' }).catch(() => {
  // Auf Web/Simulator ohne Audiosession o.ä. kann das fehlschlagen — dann bleibt es
  // einfach bei der Plattform-Standardeinstellung, kein Grund die App zu blockieren.
});

// Verdrahtet unser eigenes Farbschema (siehe src/theme) in das Navigations-Theme,
// damit die native App-Leiste (Header) jedes Screens automatisch mitwechselt, statt
// dass jeder Screen seinen Header einzeln einfärben müsste.
function ThemedNavigation() {
  const { scheme, colors } = useTheme();

  const navigationTheme: Theme = {
    ...(scheme === 'dark' ? DarkTheme : DefaultTheme),
    colors: {
      ...(scheme === 'dark' ? DarkTheme.colors : DefaultTheme.colors),
      background: colors.background,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
      primary: colors.primary,
    },
  };

  return (
    <NavigationContainer theme={navigationTheme}>
      <RootNavigator />
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <ThemedNavigation />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
