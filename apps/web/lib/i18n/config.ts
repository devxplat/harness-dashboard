import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import ja from "./locales/ja.json";
import nl from "./locales/nl.json";
import pt from "./locales/pt.json";
import zh from "./locales/zh.json";

/** Supported UI languages, in display order. Labels are native endonyms. */
export const LOCALES = [
  { code: "en", label: "English" },
  { code: "pt", label: "Português" },
  { code: "es", label: "Español" },
  { code: "de", label: "Deutsch" },
  { code: "nl", label: "Nederlands" },
  { code: "zh", label: "中文" },
  { code: "ja", label: "日本語" },
] as const;

export type LocaleCode = (typeof LOCALES)[number]["code"];

if (!i18n.isInitialized) {
  void i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources: {
        en: { translation: en },
        pt: { translation: pt },
        es: { translation: es },
        de: { translation: de },
        nl: { translation: nl },
        zh: { translation: zh },
        ja: { translation: ja },
      },
      fallbackLng: "en",
      supportedLngs: LOCALES.map((l) => l.code),
      // Map regional variants (pt-BR → pt, zh-CN → zh, …).
      nonExplicitSupportedLngs: true,
      detection: {
        order: ["localStorage", "navigator"],
        lookupLocalStorage: "lang",
        caches: ["localStorage"],
      },
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
    });
}

export default i18n;
