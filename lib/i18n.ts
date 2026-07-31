import type { Messages } from "@/messages/zh";

export const locales = ["en", "zh"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

const dictionaries: Record<Locale, () => Promise<Messages>> = {
  en: () => import("@/messages/en").then((module) => module.default),
  zh: () => import("@/messages/zh").then((module) => module.default),
};

export function isLocale(value: string): value is Locale {
  return locales.includes(value as Locale);
}

export function localeFromAcceptLanguage(value: string | null): Locale {
  if (!value) return defaultLocale;

  for (const entry of value.toLowerCase().split(",")) {
    const language = entry.trim().split(";", 1)[0];
    if (language === "zh" || language.startsWith("zh-")) return "zh";
    if (language === "en" || language.startsWith("en-")) return "en";
  }

  return defaultLocale;
}

export function languageTag(locale: Locale): string {
  return locale === "zh" ? "zh-CN" : "en";
}

export async function getMessages(locale: Locale): Promise<Messages> {
  return dictionaries[locale]();
}
