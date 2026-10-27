import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import es from "./locales/es.json";

export const languages = [
  { id: "en", name: "English" },
  { id: "es", name: "Español" },
] as const;
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, es: { translation: es } },
  lng: "en",
  fallbackLng: "en",
  supportedLngs: languages.map((l) => l.id),
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false },
  initAsync: false,
});
i18n.on("languageChanged", (language) => {
  document.documentElement.lang = language;
  document.documentElement.dir = i18n.dir(language);
});
export default i18n;
