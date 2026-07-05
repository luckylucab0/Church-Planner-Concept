// i18n-Setup: Die Übersetzungen kommen aus @serveflow/shared, damit
// Web-UI und API-Mails dieselben Texte/Keys nutzen. Deutsch ist Default,
// die Browser-Sprache wird respektiert, wenn sie unterstützt wird.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LOCALE, messages, SUPPORTED_LOCALES } from '@serveflow/shared';

const browserLanguage = navigator.language.slice(0, 2);
const initialLanguage = (SUPPORTED_LOCALES as readonly string[]).includes(browserLanguage)
  ? browserLanguage
  : DEFAULT_LOCALE;

void i18n.use(initReactI18next).init({
  resources: {
    de: { translation: messages.de },
    en: { translation: messages.en },
  },
  lng: initialLanguage,
  fallbackLng: DEFAULT_LOCALE,
  interpolation: {
    // React escaped selbst – doppeltes Escaping würde z. B. Umlaute in
    // Namen kaputt machen
    escapeValue: false,
  },
});

export default i18n;
