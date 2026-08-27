import { createContext, useContext, useCallback, ReactNode } from "react";
import { en, TranslationKeys } from "./locales/en";
import { zh } from "./locales/zh";

export type Language = "en" | "zh";

// Use a more flexible type for translations to allow different string values
const translations: Record<Language, Record<string, Record<string, string>>> = {
  en: en as unknown as Record<string, Record<string, string>>,
  zh: zh as unknown as Record<string, Record<string, string>>
};

// Get nested value from object using dot notation path
type PathImpl<T, K extends keyof T> = K extends string
  ? T[K] extends Record<string, unknown>
    ? `${K}.${PathImpl<T[K], keyof T[K]>}`
    : K
  : never;

type Path<T> = PathImpl<T, keyof T>;

export type TranslationPath = Path<TranslationKeys>;

function getNestedValue<T extends Record<string, unknown>>(
  obj: T,
  path: string
): string {
  const keys = path.split(".");
  let result: unknown = obj;
  for (const key of keys) {
    if (result && typeof result === "object" && key in result) {
      result = (result as Record<string, unknown>)[key];
    } else {
      return path; // Return path as fallback if not found
    }
  }
  return typeof result === "string" ? result : path;
}

interface I18nContextValue {
  language: Language;
  t: (path: TranslationPath) => string;
  setLanguage: (lang: Language) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

interface I18nProviderProps {
  children: ReactNode;
  language: Language;
  onLanguageChange: (lang: Language) => void;
}

export function I18nProvider({
  children,
  language,
  onLanguageChange,
}: I18nProviderProps) {
  const t = useCallback(
    (path: TranslationPath): string => {
      return getNestedValue(translations[language], path);
    },
    [language]
  );

  const value: I18nContextValue = {
    language,
    t,
    setLanguage: onLanguageChange,
  };

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useTranslation must be used within I18nProvider");
  }
  return context;
}

// Direct translation function for use outside React components
export function translate(language: Language, path: string): string {
  return getNestedValue(translations[language], path);
}

export { en, zh };
export type { TranslationKeys };
