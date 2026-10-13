import { t } from './../i18n';
import { useState } from 'react';
import { ExternalLink, Link2, LoaderCircle } from 'lucide-react';
import { request, type Connection } from '../connection';
import { createId } from '../lib/id';
import { normalizeLink } from '../../shared/links';
import type { LinkSource } from '../../shared/protocol';
export function LinkPanel({ connection, enabled, onReplace, onError }: {
    connection: Connection;
    enabled: boolean;
    onReplace: () => void;
    onError: (message: string) => void;
}) {
    const [url, setUrl] = useState('');
    const [pending, setPending] = useState(false);
    const submit = async () => {
        if (!enabled || pending)
            return;
        try {
            const source = normalizeLink(url, createId(), location.origin);
            setPending(true);
            onError('');
            onReplace();
            await request(connection.control, 'content:link', { id: source.id, url: url.trim() });
        }
        catch (error) {
            onError((error as Error).message);
        }
        finally {
            setPending(false);
        }
    };
    return <section className="link-panel" data-guide="links" aria-label={t("Compartir enlace")}>
    <div className="section-caption"><span><Link2 size={18} aria-hidden="true"/>{t("Compartir enlace")}</span><span>{t("YouTube \u00B7 Vimeo \u00B7 Web")}</span></div>
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label htmlFor="present-link">{t("Enlace para mostrar")}</label>
      <input id="present-link" type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" placeholder={t("https://\u2026")} maxLength={2048} value={url} onChange={(event) => setUrl(event.target.value)} required disabled={!enabled || pending}/>
      <button className="button primary" type="submit" disabled={!enabled || pending || !url.trim()}>{pending ? <LoaderCircle className="spin" size={18}/> : <Link2 size={18}/>}<span>{pending ? t("Enviando enlace\u2026") : t("Mostrar enlace")}</span></button>
    </form>
    <p className="link-help">{t("Control remoto para YouTube, Vimeo y enlaces directos de audio/v\u00EDdeo. Las otras p\u00E1ginas se manejan desde el PC. Los proveedores externos tienen sus propias pol\u00EDticas de privacidad.")}</p>
  </section>;
}
export function ExternalActions({ source, host = false }: {
    source: LinkSource;
    host?: boolean;
}) {
    return <div className="external-actions" data-guide="external">
    {host ? <a className="button" href={source.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={18} aria-hidden="true"/>{t("Abrir fuera")}</a> : <span>{t("Para abrir fuera, pulsa \u00ABAbrir fuera\u00BB en el PC. Pronter no controla esa pesta\u00F1a.")}</span>}
    {source.provider === 'web' && <p>{t("El sitio puede impedir mostrarse dentro de Pronter. No hay control remoto de sus botones ni de su scroll.")}</p>}
  </div>;
}
