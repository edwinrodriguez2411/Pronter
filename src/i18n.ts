import { useSyncExternalStore } from 'react';
import { catalog, describeMessage, formatMessage, translateText, type Locale, type UiMessage } from '../shared/messages';
import type { ViewerState } from '../shared/protocol';

export const localeNames: Record<Locale, string> = { es: 'Español', en: 'English', pt: 'Português', fr: 'Français' };
export function supportedLocale(value: string | null): Locale | undefined { const code = value?.toLowerCase().split('-')[0]; return code && code in localeNames ? code as Locale : undefined; }
const initialLocale = () => {
  if (typeof window === 'undefined') return 'es' as Locale;
  return supportedLocale(new URL(location.href).searchParams.get('lang')) || navigator.languages.map(supportedLocale).find(Boolean) || 'es';
};
let locale = initialLocale();
const listeners = new Set<() => void>();
export function getLocale() { return locale; }
function updateDocument() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale === 'pt' ? 'pt-BR' : locale;
  document.title = `Pronter — ${t('Tu celular')} ${t('tiene el mando.')}`;
  document.querySelector('meta[name="description"]')?.setAttribute('content', `${t('Escanea')}. ${t('Envía')}. ${t('Presenta')}. ${t('Sin cuentas. Sin historial. Así de fácil.')}`);
}
export function setLocale(value: Locale) {
  locale = value; const url = new URL(location.href); url.searchParams.set('lang', value); history.replaceState(null, '', url);
  updateDocument(); for (const listener of listeners) listener();
}
export function useLocale() { return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, getLocale, () => 'es' as Locale); }
export function t(value: string): string { return translateText(value, locale); }
export function messageText(value: string | UiMessage): string { return formatMessage(typeof value === 'string' ? describeMessage(value) : value, locale); }
export function namedText(code: keyof typeof catalog): string { return catalog[code][locale]; }
export function displaySourceName(state: ViewerState): string {
  return state.link && ['audio', 'video'].includes(state.link.provider) ? `${t(state.link.provider === 'audio' ? 'Audio' : 'Video')} · ${new URL(state.link.url).hostname}` : state.name;
}
updateDocument();
