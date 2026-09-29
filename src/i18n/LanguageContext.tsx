import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STRINGS, type StringKey } from './strings';

// Sprache der App-Oberfläche: Deutsch oder Chinesisch. Umschalter oben rechts in der
// App-Leiste (LanguageToggleButton), gemerkt pro Gerät. Regeln (siehe CLAUDE.md):
//  - Alles, was zur Bar gehört (Bar-Ansicht, Getränke/Nachspeisen und ihre Namen), bleibt
//    immer Deutsch — dort wird auf Deutsch gearbeitet (useBarI18n / tBar).
//  - Küche: Gerichtenamen auf den Tickets bleiben immer zweisprachig (Hanzi + Deutsch),
//    die restliche Oberfläche folgt der Sprache (auf Chinesisch rein chinesisch).
//  - Überall sonst folgt die Oberfläche der gewählten Sprache; Gerichtenamen werden
//    weiterhin mit beiden Namen angezeigt, wo die Daten es hergeben.
export type Language = 'de' | 'zh';

const STORAGE_KEY = 'yami:language';

type Params = Record<string, string | number>;

function format(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    params[key] !== undefined ? String(params[key]) : match
  );
}

export function translate(lang: Language, key: StringKey, params?: Params): string {
  const entry = STRINGS[key];
  return format(entry[lang] ?? entry.de, params);
}

interface LanguageContextValue {
  lang: Language;
  toggleLanguage: () => void;
  t: (key: StringKey, params?: Params) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Language>('de');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored === 'de' || stored === 'zh') setLang(stored);
      })
      .catch(() => {});
  }, []);

  const toggleLanguage = useCallback(() => {
    setLang((current) => {
      const next: Language = current === 'de' ? 'zh' : 'de';
      AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
      return next;
    });
  }, []);

  const value = useMemo<LanguageContextValue>(
    () => ({ lang, toggleLanguage, t: (key, params) => translate(lang, key, params) }),
    [lang, toggleLanguage]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useI18n(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useI18n muss innerhalb eines LanguageProvider verwendet werden.');
  return ctx;
}

// Für alles, was zur Bar gehört: immer Deutsch, unabhängig von der gewählten Sprache.
export function tBar(key: StringKey, params?: Params): string {
  return translate('de', key, params);
}
