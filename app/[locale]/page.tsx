import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getMessages,
  isLocale,
  languageTag,
  locales,
} from "@/lib/i18n";
import ConverterClient from "./converter-client";

interface LocalePageProps {
  params: Promise<{ locale: string }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: LocalePageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const messages = await getMessages(locale);

  return {
    title: messages.metadataTitle,
    description: messages.metadataDescription,
    alternates: {
      languages: {
        en: "/en",
        "zh-CN": "/zh",
      },
    },
  };
}

export default async function LocalePage({ params }: LocalePageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const messages = await getMessages(locale);
  return (
    <div lang={languageTag(locale)}>
      <ConverterClient locale={locale} messages={messages} />
    </div>
  );
}
