import { useEffect, useRef, useState } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, Languages, X } from 'lucide-react';
import { localeNames, setLocale, t, useLocale, namedText } from '../i18n';
import type { Locale, MessageCode } from '../../shared/messages';

export function LanguageSelector() {
  const locale = useLocale();
  return <label className="language-selector"><Languages size={17} aria-hidden="true" /><span className="visually-hidden">{t('Idioma')}</span><select aria-label={t('Idioma')} value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>{Object.entries(localeNames).map(([value, name]) => <option key={value} value={value} lang={value === 'pt' ? 'pt-BR' : value}>{name}</option>)}</select></label>;
}
const steps: { title: MessageCode; body: MessageCode; target: string }[] = [
  { title: 'guideConnect', body: 'guideConnectBody', target: '.scan-station, .controller-intro' },
  { title: 'guideFiles', body: 'guideFilesBody', target: '.upload-button, .empty-stage' },
  { title: 'guideLinks', body: 'guideLinksBody', target: '.link-panel input, .external-actions' },
  { title: 'guidePages', body: 'guidePagesBody', target: '.page-controls .page-navigation' },
  { title: 'guideZoom', body: 'guideZoomBody', target: '.zoom-controls .zoom-row, .scroll-controls' },
  { title: 'guideMedia', body: 'guideMediaBody', target: '.media-controls .play-button, .audio-activation' },
  { title: 'guideLaser', body: 'guideLaserBody', target: '.laser-pad' },
  { title: 'guideMarker', body: 'guideMarkerBody', target: '.marker-pad, .host-marker-bar' },
  { title: 'guideScreen', body: 'guideScreenBody', target: '.remote-fullscreen, .fullscreen-button' },
  { title: 'guideTime', body: 'guideTimeBody', target: '.presentation-timer' },
  { title: 'guideExit', body: 'guideExitBody', target: '.leave-button' },
];
export function AppTools() {
  const locale = useLocale(); const [open, setOpen] = useState(false), [index, setIndex] = useState(0), [available, setAvailable] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const node = dialog.current!; node.showModal();
    return () => { node.close(); trigger.current?.focus({ preventScroll: true }); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    let current: HTMLElement | null = null, frame = 0;
    const highlight = () => {
      current?.classList.remove('guide-target');
      current = [...document.querySelectorAll<HTMLElement>(steps[index].target)].find(target => target.getClientRects().length) || null;
      setAvailable(!!current);
      if (current) {
        current.classList.add('guide-target'); current.scrollIntoView({ block: 'center', behavior: 'instant' });
        if (innerWidth <= 500) { const room = Math.max(80, innerHeight - (dialog.current?.clientHeight || 320) - 32); window.scrollBy({ top: current.getBoundingClientRect().top - 24 - Math.max(0, (room - current.clientHeight) / 2), behavior: 'instant' }); }
      }
    };
    highlight();
    const observer = new MutationObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(highlight); }); observer.observe(document.getElementById('root')!, { subtree: true, childList: true });
    return () => { observer.disconnect(); cancelAnimationFrame(frame); current?.classList.remove('guide-target'); };
  }, [open, index, locale]);
  return <div className="app-tools" data-guide="settings">
    <LanguageSelector />
    <button ref={trigger} className="button guide-button" type="button" aria-label={t('Guía de uso')} onClick={() => { setIndex(0); setOpen(true); }}><BookOpen size={18} aria-hidden="true" /><span>{t('Guía de uso')}</span></button>
    {open && <dialog ref={dialog} className="guide-dialog" aria-labelledby="guide-title" onCancel={(event) => { event.preventDefault(); setOpen(false); }} onKeyDown={(event) => event.stopPropagation()}>
      <div className="guide-dialog-header"><span><BookOpen size={18} aria-hidden="true" />{t('Guía de uso')}</span><LanguageSelector /><button type="button" className="button icon-button" aria-label={t('Cerrar guía')} onClick={() => setOpen(false)}><X size={20} /></button></div>
      <label className="guide-index"><span>{t('Índice de la guía')}</span><select aria-label={t('Índice de la guía')} value={index} onChange={(event) => setIndex(Number(event.target.value))}>{steps.map((step, number) => <option key={step.title} value={number}>{number + 1}. {namedText(step.title)}</option>)}</select></label>
      <div className="guide-copy"><span className="guide-count">{index + 1} / {steps.length}</span><h2 id="guide-title">{namedText(steps[index].title)}</h2><p>{namedText(steps[index].body)}</p>{!available && <p className="guide-unavailable">{namedText('guideUnavailable')}</p>}</div>
      <div className="guide-navigation"><button type="button" className="button" disabled={index === 0} onClick={() => setIndex(index - 1)}><ChevronLeft size={18} />{t('Anterior')}</button>{index < steps.length - 1 ? <button type="button" className="button primary" onClick={() => setIndex(index + 1)}>{t('Siguiente')}<ChevronRight size={18} /></button> : <button type="button" className="button primary" onClick={() => setOpen(false)}>{t('Cerrar guía')}</button>}</div>
    </dialog>}
  </div>;
}
