// =====================================================
// I18N — foundation + Hindi phase 1 (Bharosa §1)
// English UI by default; Hindi leads on the worker
// chrome. Init is synchronous with 'en' so the first
// frame never flashes keys; the persisted choice is
// applied as soon as AsyncStorage answers.
//
// Hermes note: Intl.PluralRules is not available, so
// phase-1 keys avoid i18next plural suffixes entirely
// (_one/_other) and never pass the special `count`
// option — singular/plural strings are explicit keys
// selected in code. compatibilityJSON 'v4' is the only
// (and default) format on i18next v26.
// =====================================================
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';

import en from './locales/en.json';
import hi from './locales/hi.json';

export type AppLanguage = 'en' | 'hi';

const STORAGE_KEY = 'healthdrop:language';

const isAppLanguage = (value: unknown): value is AppLanguage =>
  value === 'en' || value === 'hi';

/**
 * Set the instant a human picks a language, BEFORE any await. The persisted
 * choice is restored asynchronously (see initI18n below), and the language
 * toggle is now the first interactive control on the first screen — a tap
 * landing before AsyncStorage answers used to be silently reverted by that
 * late restore, which reads as "the toggle is broken". A live choice always
 * wins over a stored one.
 */
let userPickedLanguage = false;

/**
 * Idempotent init — safe to call explicitly from App wiring; the module
 * also calls it once at load so `import './lib/i18n'` is sufficient.
 */
export const initI18n = (): typeof i18next => {
  if (i18next.isInitialized) return i18next;

  i18next.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      hi: { translation: hi },
    },
    lng: 'en',
    fallbackLng: 'en',
    compatibilityJSON: 'v4',
    // Bundled resources — init synchronously so t() works on first render.
    initAsync: false,
    interpolation: {
      // React already escapes; RN Text never interprets HTML.
      escapeValue: false,
    },
    returnNull: false,
  });

  // Restore the persisted choice without blocking startup. Until the read
  // resolves the UI renders in English, then re-renders once via the
  // react-i18next languageChanged binding.
  AsyncStorage.getItem(STORAGE_KEY)
    .then((stored) => {
      // A tap that beat the storage read owns the language — do not undo it.
      if (userPickedLanguage) return undefined;
      if (isAppLanguage(stored) && stored !== i18next.language) {
        return i18next.changeLanguage(stored).then(() => undefined);
      }
      return undefined;
    })
    .catch(() => {
      // Best-effort — English stays in place if storage is unreadable.
    });

  return i18next;
};

initI18n();

/**
 * Switch the app language and persist it. Contract used by the
 * ProfileScreen language picker — do not rename.
 */
export const setAppLanguage = async (lang: AppLanguage): Promise<void> => {
  // Synchronous, before the first await — the deferred restore in initI18n
  // may resolve at any point from here on.
  const wasPicked = userPickedLanguage;
  userPickedLanguage = true;
  try {
    await i18next.changeLanguage(lang);
  } catch (error) {
    // The switch did not happen, so this was not a choice — release the claim
    // rather than suppressing the user's own persisted language for the rest
    // of the session. The caller surfaces the failure.
    userPickedLanguage = wasPicked;
    throw error;
  }
  try {
    await AsyncStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Best-effort persistence — the in-session switch already happened.
  }
};

export const getAppLanguage = (): string => i18next.language || 'en';

export default i18next;
