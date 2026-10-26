import { createContext, useContext } from 'react';
import { en } from './locales/en';
import type { MessageKey } from './locales/en';
import { zhCN } from './locales/zh-CN';

export type Locale = 'en' | 'zh-CN';
export type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;
export type I18n = { locale: Locale; t: Translate; date: (value: string) => string; number: (value: number) => string };
export function makeI18n(locale: Locale): I18n {
  const messages = locale === 'zh-CN' ? zhCN : en;
  return {
    locale,
    t: (key, values) => messages[key].replace(/\{(\w+)\}/g, (_, token: string) => String(values?.[token] ?? `{${token}}`)),
    date: value => { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(parsed); },
    number: value => new Intl.NumberFormat(locale).format(value),
  };
}
export const I18nContext = createContext<I18n>(makeI18n('en'));
export const useI18n = () => useContext(I18nContext);
