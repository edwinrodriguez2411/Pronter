import { t, messageText, useLocale, getLocale, displaySourceName } from './i18n';
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, AudioLines, Check, CheckCheck, ChevronLeft, ChevronRight, CircleX, Expand, FileImage, FileSliders, FileText, Image, LoaderCircle, Maximize, Minimize, Minus, MousePointer2, Pause, PenLine, Play, Plus, ScanLine, Send, ShieldCheck, Smartphone, Square, Timer, Upload, Video, Volume2, VolumeX, X, ZoomIn } from 'lucide-react';
import { useConnection, request, type ConnectionSnapshot } from './connection';
import { Presenter } from './presenter';
import { ACK_TIMEOUT_MS, CHUNK_BYTES, FILE_ACCEPT, MAX_FILE_BYTES, TRANSFER_WINDOW, formatBytes, formatTime, kindFromName, type Ack, type Command, type CommandType, type FileMeta, type InkColor, type InkCommand, type InkWidth, type PointerPosition, type ViewerState } from '../shared/protocol';
import type { Connection } from './connection';
import { createId } from './lib/id';
import { MarkerPad, MarkerTools } from './components/MarkerTools';
import { LinkPanel, ExternalActions } from './components/LinkPanel';
import { AppTools } from './components/AppTools';
function Brand() {
    return <a className="brand" href={`/?lang=${getLocale()}`} aria-label={t("Pronter, inicio")}><svg viewBox="0 0 40 40" aria-hidden="true"><rect x="2" y="6" width="30" height="24" rx="7" fill="currentColor"/><path d="m17 12 10 6-10 6z" fill="white"/><circle cx="32" cy="8" r="6" fill="#ff755c"/><path d="m14 33-3 4m11-4 3 4" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg><span>{t("pronter")}<span className="brand-period">{t(".")}</span></span></a>;
}
function Button({ children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
    return <button type="button" className={`button ${className}`} {...props}>{children}</button>;
}
function IconButton({ label, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
    label: string;
}) {
    return <Button className="icon-button" aria-label={label} title={label} {...props}>{children}</Button>;
}
function Status({ snapshot }: {
    snapshot: ConnectionSnapshot;
}) {
    const [remaining, setRemaining] = useState(20);
    useEffect(() => {
        if (!snapshot.reconnectAt)
            return;
        const tick = () => setRemaining(Math.max(0, Math.ceil(((snapshot.reconnectUntil ?? snapshot.reconnectAt! + snapshot.graceMs) - Date.now()) / 1000)));
        tick();
        const interval = setInterval(tick, 1000);
        return () => clearInterval(interval);
    }, [snapshot.reconnectAt, snapshot.graceMs, snapshot.reconnectUntil]);
    const labels = { connecting: t("Preparando conexi\u00F3n"), waiting: t("Listo para conectar"), connected: t("Celular conectado"), reconnecting: t(`Reconectando · ${remaining}s`), ended: t("Sesi\u00F3n terminada"), error: t("No se pudo conectar") };
    const label = snapshot.selectingFile && ['connected', 'reconnecting'].includes(snapshot.status) ? t("Eligiendo archivo en el celular") : labels[snapshot.status];
    return <span className={`connection-status status-${snapshot.status}`} role="status"><i />{label}</span>;
}
function Formats() {
    return <div className="format-strip" aria-label={t("Formatos compatibles")}><span><Image size={17} aria-hidden="true"/>{t("Im\u00E1genes")}</span><span><FileText size={17} aria-hidden="true"/>{t("PDF")}</span><span><FileSliders size={17} aria-hidden="true"/>{t("PowerPoint")}</span><span><AudioLines size={17} aria-hidden="true"/>{t("Audio")}</span><span><Video size={17} aria-hidden="true"/>{t("Video")}</span><span className="markdown-tag"><b aria-hidden="true">{t("M\u2193")}</b>{t("Markdown")}</span></div>;
}
function Landing({ snapshot }: {
    snapshot: ConnectionSnapshot;
}) {
    const url = snapshot.token && snapshot.publicUrl ? `${snapshot.publicUrl}/control?lang=${getLocale()}#${snapshot.token}` : '';
    return <main className="landing">
    <section className="hero-story">
      <div className="hero-ticket"><span className="ticket-dot"/>{t("Peque\u00F1a pantalla. Grandes ideas.")}</div>
      <h1>{t("Tu celular")}<br />{t("tiene el mando.")}</h1>
      <p className="hero-description">{t("Lo que tienes en tu bolsillo,")}<br />{t("en la pantalla que tienes enfrente.")}</p>
      <div className="pocket-scene" aria-hidden="true">
        <div className="file-card file-card-back"><FileImage /><span>{t("Un recuerdo")}</span></div>
        <div className="file-card file-card-middle"><AudioLines /><span>{t("Una buena canci\u00F3n")}</span></div>
        <div className="phone-illustration"><div className="phone-speaker"/><div className="phone-display"><span>{t("Tu pr\u00F3xima")}<br />{t("gran idea.")}</span><div className="mini-slide"><i /><i /><i /></div><div className="mini-send"><ArrowUp size={22}/></div></div><div className="phone-home"/></div>
        <svg className="scene-swoosh" viewBox="0 0 220 140"><path d="M12 110c32-68 80 30 106-12s-10-65 26-64c30 1 43 27 56-16m-18 5 20-6-1 23" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/></svg>
        <span className="scene-spark spark-one">{t("\u2733")}</span><span className="scene-spark spark-two">{t("\u2733")}</span>
      </div>
      <ol className="how-it-works"><li><ScanLine aria-hidden="true"/>{t("Escanea")}</li><li><Send aria-hidden="true"/>{t("Env\u00EDa")}</li><li><Expand aria-hidden="true"/>{t("Presenta")}</li></ol>
    </section>
    <section className="scan-station" aria-labelledby="scan-title">
      <div className="station-sticker"><MousePointer2 size={18} aria-hidden="true"/>{t("El escenario es tuyo")}</div>
      <div className="qr-projector">
        <div className="projector-topline"><span className="projector-light"/><span>{t("Conexi\u00F3n instant\u00E1nea")}</span><span className="projector-grill"/></div>
        <div className="qr-paper">{url ? <QRCodeSVG value={url} size={288} level="M" marginSize={4} title={t("Escanea con la c\u00E1mara de tu celular para controlar esta pantalla")}/> : <div className="qr-loading"><LoaderCircle className="spin" size={36}/><span>{t("Preparando tu QR\u2026")}</span></div>}</div>
        <h2 id="scan-title">{t("Escanea. Y toma el mando.")}</h2>
        <p>{t("Abre la c\u00E1mara de tu celular")}<br />{t("y apunta a este c\u00F3digo.")}</p>
        <div className="station-note"><Smartphone size={16} aria-hidden="true"/>{t("Un celular, una pantalla, cero cuentas.")}</div>
      </div>
      <div className="projector-foot" aria-hidden="true"><i /><i /></div>
      <p className="station-privacy"><ShieldCheck size={16} aria-hidden="true"/>{t("Tus archivos viven solo en este momento.")}</p>
    </section>
    <footer className="landing-footer"><Formats /><span>{t("Sin cuentas. Sin historial. As\u00ED de f\u00E1cil.")}</span></footer>
  </main>;
}
function Progress({ state }: {
    state: ViewerState;
}) {
    if (state.phase === 'idle')
        return null;
    const label = state.phase === 'receiving' ? t("Recibiendo tu archivo") : state.phase === 'converting' ? t("Preparando un formato compatible") : t("Preparando la presentaci\u00F3n");
    return <div className="stage-progress" role="status"><LoaderCircle className="spin" size={18}/><span>{label}</span>{state.phase !== 'preparing' && <b>{Math.round(state.progress * 100)}{t("%")}</b>}<div className="progress-track"><i style={{ transform: `scaleX(${state.progress})` }}/></div></div>;
}
async function fullscreen() {
    if (document.fullscreenElement)
        await document.exitFullscreen();
    else if (document.documentElement.requestFullscreen)
        await document.documentElement.requestFullscreen();
    else
        throw new Error(t("Este navegador no permite pantalla completa. Usa el modo de pantalla completa de tu navegador."));
}
function HostPage() {
    const { connection, snapshot } = useConnection('host');
    const slot = useRef<HTMLDivElement>(null);
    const pointer = useRef<HTMLDivElement>(null);
    const presenter = useRef<Presenter | undefined>(undefined);
    const [error, setError] = useState('');
    const [isFullscreen, setFullscreen] = useState(!!document.fullscreenElement);
    const [expanded, setExpanded] = useState(false);
    const [needsClick, setNeedsClick] = useState(false);
    const displayChanging = useRef(false);
    const [displayBusy, setDisplayBusy] = useState(false);
    const [drawing, setDrawing] = useState(false);
    const [inkColor, setInkColor] = useState<InkColor>('coral');
    const [inkWidth, setInkWidth] = useState<InkWidth>(0.006);
    const state = snapshot.viewer;
    useEffect(() => {
        if (!slot.current || !pointer.current)
            return;
        presenter.current = new Presenter(connection, slot.current, pointer.current);
        return () => { presenter.current?.destroy(); presenter.current = undefined; };
    }, [connection]);
    useEffect(() => {
        const changed = () => {
            const native = !!document.fullscreenElement;
            setFullscreen(native);
            setNeedsClick(false);
            if (!native)
                setExpanded(false);
        };
        document.addEventListener('fullscreenchange', changed);
        return () => document.removeEventListener('fullscreenchange', changed);
    }, []);
    useEffect(() => { if (!displayChanging.current) connection.publishDisplay({ expanded, native: isFullscreen, needsClick }); }, [connection, expanded, isFullscreen, needsClick, snapshot.status]);
    const localFullscreen = async () => {
        if (displayChanging.current) return;
        displayChanging.current = true; setDisplayBusy(true);
        let completed = false;
        try { await fullscreen(); completed = true; }
        finally {
            const native = !!document.fullscreenElement;
            const nextExpanded = (native || !completed) && connection.snapshot.display.expanded;
            setFullscreen(native); setNeedsClick(nextExpanded && !native); if (!native && completed) setExpanded(false);
            connection.publishDisplay({ expanded: nextExpanded, native, needsClick: nextExpanded && !native });
            displayChanging.current = false; setDisplayBusy(false); presenter.current?.refreshPreview();
        }
    };
    useEffect(() => {
        const remoteDisplay = async (value: boolean, ack: Ack) => {
            if (displayChanging.current) return ack({ ok: false, error: 'La pantalla está cambiando de modo. Espera un momento.' });
            displayChanging.current = true; setDisplayBusy(true);
            setExpanded(value);
            setNeedsClick(false);
            let native = !!document.fullscreenElement, requiresClick = false;
            try {
                if (value && !native && document.documentElement.requestFullscreen) {
                    await document.documentElement.requestFullscreen();
                    native = true;
                }
                if (!value && native) {
                    await document.exitFullscreen();
                    native = false;
                }
            }
            catch {
                requiresClick = value;
            }
            if (value && !native)
                requiresClick = true;
            await new Promise<void>((resolve) => { const timer = setTimeout(resolve, 250); requestAnimationFrame(() => { clearTimeout(timer); resolve(); }); });
            native = !!document.fullscreenElement;
            requiresClick = value && !native;
            setFullscreen(native); setNeedsClick(requiresClick);
            presenter.current?.refreshPreview();
            connection.publishDisplay({ expanded: value, native, needsClick: requiresClick });
            displayChanging.current = false; setDisplayBusy(false);
            ack({ ok: true });
        };
        connection.control.on('display:command', remoteDisplay);
        return () => { connection.control.off('display:command', remoteDisplay); };
    }, [connection]);
    useEffect(() => { presenter.current?.setDrawing(drawing && !!state.assetId, inkColor, inkWidth); }, [drawing, inkColor, inkWidth, state.assetId]);
    useEffect(() => {
        if (snapshot.status !== 'ended')
            return;
        presenter.current?.destroy();
        presenter.current = undefined;
        const reload = setTimeout(() => window.location.reload(), 2000);
        return () => clearTimeout(reload);
    }, [snapshot.status]);
    const command = (type: CommandType, value?: Command['value']) => {
        const command: Command = { id: createId(), assetId: connection.snapshot.viewer.assetId, type, value };
        void presenter.current?.command(command).catch((reason: Error) => setError(reason.message));
    };
    const editInk = (type: 'undo' | 'clear') => {
        if (!state.assetId)
            return;
        try {
            presenter.current?.draw({ id: createId(), assetId: state.assetId, page: state.page, type });
        }
        catch (reason) {
            setError((reason as Error).message);
        }
    };
    useEffect(() => {
        const keyboard = (event: KeyboardEvent) => {
            if ((event.target as Element).closest('input,textarea,select,[contenteditable]') || event.ctrlKey || event.metaKey || event.altKey)
                return;
            if (event.key.toLowerCase() === 'f') {
                event.preventDefault();
                if (!event.repeat)
                    void localFullscreen().catch((reason: Error) => setError(reason.message));
                return;
            }
            if (event.key === 'Escape' && !document.fullscreenElement) {
                setExpanded(false);
                setNeedsClick(false);
            }
            if ((event.target as Element).closest('button,a') || !connection.snapshot.viewer.assetId)
                return;
            const viewer = connection.snapshot.viewer;
            if (['ArrowRight', 'PageDown'].includes(event.key)) {
                event.preventDefault();
                command(viewer.capabilities.includes('scroll') ? 'scroll' : 'next', viewer.capabilities.includes('scroll') ? 1 : undefined);
            }
            if (['ArrowLeft', 'PageUp'].includes(event.key)) {
                event.preventDefault();
                command(viewer.capabilities.includes('scroll') ? 'scroll' : 'previous', viewer.capabilities.includes('scroll') ? -1 : undefined);
            }
            if (event.code === 'Space') {
                event.preventDefault();
                command(viewer.capabilities.includes('media') ? viewer.paused ? 'play' : 'pause' : 'next');
            }
            if (event.key.toLowerCase() === 'b')
                command('black', !viewer.black);
        };
        window.addEventListener('keydown', keyboard);
        return () => window.removeEventListener('keydown', keyboard);
    }, [connection]);
    const landing = ['connecting', 'waiting', 'error'].includes(snapshot.status) && !state.assetId;
    if (snapshot.status === 'ended')
        return <div className="end-screen"><Brand /><AppTools /><div className="end-symbol"><CheckCheck size={56}/></div><h1>{t("Sesi\u00F3n terminada.")}</h1><p>{t("Un nuevo QR, un nuevo comienzo.")}</p><LoaderCircle className="spin" size={22}/></div>;
    return <div className={`host-app ${landing ? 'is-landing' : 'is-presenting'} ${isFullscreen ? 'is-fullscreen' : ''} ${expanded ? 'is-expanded' : ''}`}>
    <header className="app-header"><Brand /><div className="header-right"><Status snapshot={snapshot}/><AppTools /><Button className="fullscreen-button" disabled={displayBusy} aria-label={isFullscreen ? t("Salir de pantalla completa") : t("Pantalla completa")} aria-pressed={isFullscreen} title={isFullscreen ? t("Salir de pantalla completa (F o Esc)") : t("Pantalla completa (F)")} onClick={() => { void localFullscreen().catch((reason: Error) => setError(reason.message)); }}>{isFullscreen ? <Minimize size={19} aria-hidden="true"/> : <Maximize size={19} aria-hidden="true"/>}<span>{isFullscreen ? t("Salir de pantalla completa") : t("Pantalla completa")}</span></Button></div></header>
    {landing && <Landing snapshot={snapshot}/>}
    {expanded && <div className="expanded-actions">
      <AppTools />
      {state.needsActivation && <Button onClick={() => { void presenter.current?.activate().catch((reason: Error) => setError(reason.message)); }}><Volume2 size={18}/>{t("Activar audio")}</Button>}
      {needsClick && <div className="fullscreen-permission" role="status"><span>{t("El navegador necesita un clic aqu\u00ED para ocultar tambi\u00E9n sus barras.")}</span><Button disabled={displayBusy} onClick={() => { void localFullscreen().catch((reason: Error) => setError(reason.message)); }}><Maximize size={18}/>{t("Activar pantalla completa")}</Button></div>}
      <IconButton label={t("Salir de vista ampliada")} disabled={displayBusy} onClick={() => { setExpanded(false); setNeedsClick(false); if (document.fullscreenElement)
            void localFullscreen().catch((reason: Error) => setError(reason.message)); }}><Minimize size={19}/></IconButton>
    </div>}
    <main className={`stage-shell ${landing ? 'is-hidden' : ''}`} aria-label={t("Pantalla de presentaci\u00F3n")}>
      <div className="stage-topline"><span>{displaySourceName(state) || t("Tu pantalla est\u00E1 lista")}</span><span>{state.capabilities.includes('pages') ? `${state.page} / ${state.pages}` : state.kind === 'video' || state.kind === 'audio' ? formatTime(state.currentTime) : ''}</span></div>
      {state.capabilities.includes('draw') && <div className="host-marker-bar"><Button className={`marker-toggle ${drawing ? 'is-active' : ''}`} aria-pressed={drawing} disabled={state.black || state.phase !== 'idle'} onClick={() => setDrawing(!drawing)}><PenLine size={18} aria-hidden="true"/>{t("Dibujar en el PC")}</Button>{drawing ? <MarkerTools color={inkColor} width={inkWidth} onColor={setInkColor} onWidth={setInkWidth} onUndo={() => editInk('undo')} onClear={() => editInk('clear')} disabled={state.black || state.phase !== 'idle'} count={state.inkCount}/> : <span className="marker-bar-hint">{t("Tambi\u00E9n puedes dibujar desde el celular.")}</span>}</div>}
      <div className="stage-area">
        <div ref={slot} className="viewer-slot" data-testid="viewer-slot"/>
        {!state.assetId && <div className="empty-stage"><div className="empty-projector"><Send size={48} strokeWidth={1.5}/></div><span className="small-badge"><Check size={14}/>{t("Conectados")}</span><h1>{t("La pantalla es tuya.")}</h1><p>{t("Env\u00EDa tu primer archivo desde el celular.")}<br />{t("Im\u00E1genes, presentaciones, m\u00FAsica\u2026 t\u00FA eliges.")}</p><Formats /></div>}
        <div ref={pointer} className="laser-pointer" data-testid="host-laser" aria-hidden="true"><i /></div>
        {state.black && <div className="black-curtain" aria-label={t("Pantalla negra")}/>}
        <Progress state={state}/>
      </div>
      <div className="stage-toolbar"><div className="toolbar-status"><span className="connected-dot"/>{state.link?.provider === 'web' ? t("Navegación en el PC") : t("Controlado desde tu celular")}</div><div className="toolbar-actions">
        {state.capabilities.includes('pages') && <><IconButton label={t("P\u00E1gina anterior")} onClick={() => command('previous')}><ChevronLeft size={20}/></IconButton><IconButton label={t("P\u00E1gina siguiente")} onClick={() => command('next')}><ChevronRight size={20}/></IconButton></>}
        {state.capabilities.includes('zoom') && <IconButton label={t("Ajustar a pantalla")} onClick={() => command('fit')}><Expand size={18}/></IconButton>}
        {(state.capabilities.includes('media') || state.kind === 'powerpoint') && <Button className={`audio-activation ${state.needsActivation ? 'needs-activation' : ''}`} onClick={() => { void presenter.current?.activate().catch((reason: Error) => setError(reason.message)); }}><Volume2 size={17}/>{t("Activar audio")}</Button>}
        {state.assetId && <IconButton label={state.black ? t("Mostrar presentaci\u00F3n") : t("Pantalla negra")} onClick={() => command('black', !state.black)}><Square size={17} fill={state.black ? 'currentColor' : 'none'}/></IconButton>}
      </div></div>
      {(state.failedLink || state.link) && <ExternalActions source={(state.failedLink || state.link)!} host/>}
      {state.notice && <div className="viewer-notice" role="status">{messageText(state.noticeMessage || state.notice)}</div>}
    </main>
    {snapshot.status === 'reconnecting' && <div className="reconnect-banner" role="status"><LoaderCircle className="spin" size={18}/>{snapshot.selectingFile ? t("El celular est\u00E1 eligiendo un archivo. La pantalla sigue reservada.") : t("Esperando que vuelva la conexi\u00F3n. Conservamos tu presentaci\u00F3n.")}</div>}
    {(error || snapshot.error) && <div className="error-banner" role="alert"><CircleX size={18}/><span>{messageText(error || snapshot.error)}</span><IconButton label={t("Cerrar aviso")} onClick={() => setError('')}><X size={16}/></IconButton></div>}
  </div>;
}
interface UploadState {
    id: string;
    name: string;
    progress: number;
    sending: boolean;
    waiting?: boolean;
}
function useUpload(connection: Connection) {
    const [upload, setUpload] = useState<UploadState | null>(null);
    const [error, setError] = useState('');
    const active = useRef<{
        id: string;
        cancelled: boolean;
        controller: AbortController;
    } | undefined>(undefined);
    useEffect(() => {
        const cancel = ({ id, reason }: {
            id?: string;
            reason: string;
        }) => { if (active.current && (!id || id === active.current.id)) {
            active.current.cancelled = true;
            active.current.controller.abort();
            active.current = undefined;
            setUpload(null);
            setError(reason);
        } };
        const remove = connection.onData('transfer:cancel', cancel);
        return () => { if (active.current) {
            active.current.cancelled = true;
            active.current.controller.abort();
        } remove(); };
    }, [connection]);
    const cancelActive = () => {
        if (!active.current)
            return;
        const id = active.current.id;
        active.current.cancelled = true;
        active.current.controller.abort();
        active.current = undefined;
        setUpload(null);
        void request(connection.control, 'asset:cancel', id).catch(() => { });
    };
    const cancel = () => { connection.setFileSelection(false); cancelActive(); };
    const send = async (file: File) => {
        const kind = kindFromName(file.name);
        if (!kind) {
            connection.setFileSelection(false);
            setError(t("Este formato no es compatible. Elige una imagen, PDF, PowerPoint, audio, video o Markdown."));
            return;
        }
        if (!file.size || file.size > MAX_FILE_BYTES) {
            connection.setFileSelection(false);
            setError(t("Elige un archivo no vac\u00EDo de hasta 100 MB."));
            return;
        }
        cancelActive();
        const job = { id: createId(), cancelled: false, controller: new AbortController() };
        active.current = job;
        setError('');
        setUpload({ id: job.id, name: file.name, progress: 0, sending: true, waiting: true });
        const meta: FileMeta = { id: job.id, name: file.name, type: file.type, size: file.size, kind };
        let sent = 0;
        const pending: Promise<unknown>[] = [];
        try {
            const data = await connection.waitForReady(job.controller.signal);
            if (job.cancelled)
                return;
            connection.setFileSelection(false);
            setUpload({ id: job.id, name: file.name, progress: 0, sending: true });
            await request(data, 'transfer:begin', meta);
            for (let offset = 0, index = 0; offset < file.size; offset += CHUNK_BYTES, index++) {
                if (job.cancelled)
                    return;
                const bytes = await file.slice(offset, offset + CHUNK_BYTES).arrayBuffer();
                if (job.cancelled)
                    return;
                const length = bytes.byteLength;
                const task = request(data, 'transfer:chunk', job.id, index, bytes).then(() => {
                    sent += length;
                    if (!job.cancelled && active.current === job)
                        setUpload({ id: job.id, name: file.name, progress: sent / file.size, sending: true });
                });
                // Attach a handler immediately; the batch awaits the original promise below.
                void task.catch(() => { });
                pending.push(task);
                if (pending.length === TRANSFER_WINDOW) {
                    await Promise.all(pending);
                    pending.length = 0;
                }
            }
            await Promise.all(pending);
            if (job.cancelled)
                return;
            await request(data, 'transfer:end', job.id);
            if (active.current === job)
                setUpload({ id: job.id, name: file.name, progress: 1, sending: false });
        }
        catch (reason) {
            if (!job.cancelled && active.current === job) {
                setError((reason as Error).message);
                setUpload(null);
                void request(connection.control, 'asset:cancel', job.id).catch(() => { });
            }
        }
        finally {
            if (active.current === job)
                connection.setFileSelection(false);
            await Promise.allSettled(pending);
        }
    };
    return { upload, error, setError, send, cancel };
}
function Slider({ label, value, min, max, step, onCommit, display, icon, disabled }: {
    disabled?: boolean;
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    onCommit: (value: number) => void;
    display: ReactNode;
    icon?: ReactNode;
}) {
    const [local, setLocal] = useState(value);
    const active = useRef(false);
    useEffect(() => { if (!active.current)
        setLocal(value); }, [value]);
    const commit = () => { active.current = false; onCommit(local); };
    return <label className="slider-control"><span>{icon}{label}<b>{display}</b></span><input type="range" disabled={disabled} aria-label={label} min={min} max={Math.max(min, max)} step={step || 1} value={Math.max(min, Math.min(max, local))} onPointerDown={() => { active.current = true; }} onChange={(event) => { active.current = true; setLocal(Number(event.target.value)); }} onPointerUp={commit} onPointerCancel={() => { active.current = false; setLocal(value); }} onKeyUp={commit} onBlur={() => { if (active.current)
        commit(); }}/></label>;
}
function LaserPad({ connection, assetId, enabled }: {
    connection: Connection;
    assetId: string | null;
    enabled: boolean;
}) {
    const pad = useRef<HTMLDivElement>(null);
    const dot = useRef<HTMLDivElement>(null);
    const position = useRef({ x: 0.5, y: 0.5 });
    const active = useRef(false);
    const lastSent = useRef(0);
    const heartbeat = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
    const emit = (visible: boolean, force = false) => {
        if (!connection.control.connected)
            return;
        const now = performance.now();
        if (visible && !force && now - lastSent.current < 33)
            return;
        lastSent.current = now;
        connection.control.volatile.emit('viewer:pointer', { ...position.current, visible, assetId } satisfies PointerPosition);
    };
    const move = (x: number, y: number) => {
        position.current = { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
        if (dot.current && pad.current) {
            dot.current.style.transform = `translate(${position.current.x * pad.current.clientWidth}px, ${position.current.y * pad.current.clientHeight}px)`;
            dot.current.style.opacity = '1';
        }
        emit(true);
    };
    const stop = () => { active.current = false; clearInterval(heartbeat.current); if (dot.current)
        dot.current.style.opacity = '0'; emit(false, true); };
    useEffect(() => { if (!enabled)
        stop(); return stop; }, [enabled, assetId]);
    return <div className={`laser-section ${enabled ? '' : 'is-disabled'}`}><div className="section-caption"><span><MousePointer2 size={18} aria-hidden="true"/>{t("Puntero l\u00E1ser")}</span><span>{t("Mant\u00E9n y desliza")}</span></div><div ref={pad} className="laser-pad" role="application" tabIndex={enabled ? 0 : -1} aria-label={t("Puntero l\u00E1ser. Mant\u00E9n y desliza, o usa las flechas del teclado.")} aria-disabled={!enabled} onPointerDown={(event) => {
            if (!enabled)
                return;
            event.currentTarget.setPointerCapture(event.pointerId);
            active.current = true;
            const rect = event.currentTarget.getBoundingClientRect();
            move((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
            clearInterval(heartbeat.current);
            heartbeat.current = setInterval(() => emit(active.current, true), 150);
        }} onPointerMove={(event) => { if (!active.current || !enabled)
        return; const rect = event.currentTarget.getBoundingClientRect(); move((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height); }} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop} onKeyDown={(event) => {
            if (!enabled || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key))
                return;
            event.preventDefault();
            move(position.current.x + (event.key === 'ArrowRight' ? 0.025 : event.key === 'ArrowLeft' ? -0.025 : 0), position.current.y + (event.key === 'ArrowDown' ? 0.025 : event.key === 'ArrowUp' ? -0.025 : 0));
        }} onKeyUp={() => emit(false, true)} onBlur={stop}>
    <div className="pad-crosshair" aria-hidden="true"><i /><i /></div><span className="pad-hint">{t("Tu dedo gu\u00EDa la presentaci\u00F3n")}</span><div ref={dot} className="pad-dot" aria-hidden="true"/>
  </div></div>;
}
function ControlPage() {
    const { connection, snapshot } = useConnection('controller');
    const { upload, error: uploadError, setError: setUploadError, send, cancel } = useUpload(connection);
    const picker = useRef<HTMLInputElement>(null);
    const [error, setError] = useState('');
    const [elapsed, setElapsed] = useState(0);
    const [running, setRunning] = useState(false);
    const [page, setPage] = useState('1');
    const [guideMode, setGuideMode] = useState<'laser' | 'marker'>('laser');
    const [inkColor, setInkColor] = useState<InkColor>('coral');
    const [inkWidth, setInkWidth] = useState<InkWidth>(0.006);
    const [viewPending, setViewPending] = useState(false);
    const [displayPending, setDisplayPending] = useState(false);
    const viewPendingRef = useRef<string | null>(null);
    const wakeLock = useRef<WakeLockSentinel | undefined>(undefined);
    const state = snapshot.viewer;
    const connected = snapshot.status === 'connected';
    const controlsReady = connected && !viewPending && state.phase === 'idle' && !upload?.sending;
    const canSend = connected && snapshot.dataReady;
    useEffect(() => { if (!state.capabilities.includes('draw'))
        setGuideMode('laser'); }, [state.assetId, state.capabilities]);
    useEffect(() => { if (connected)
        setError(''); }, [connected]);
    useEffect(() => { viewPendingRef.current = null; setViewPending(false); setError(''); }, [state.assetId, connected]);
    useEffect(() => {
        const input = picker.current;
        const cancelled = () => connection.setFileSelection(false);
        input?.addEventListener('cancel', cancelled);
        return () => input?.removeEventListener('cancel', cancelled);
    }, [connection, snapshot.status]);
    useEffect(() => { setPage(String(state.page)); }, [state.page, state.assetId]);
    useEffect(() => {
        if (!running)
            return;
        const started = Date.now() - elapsed * 1000;
        const interval = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
        return () => clearInterval(interval);
    }, [running]);
    useEffect(() => {
        const acquire = async () => {
            if (connected && document.visibilityState === 'visible' && 'wakeLock' in navigator) {
                try {
                    wakeLock.current = await navigator.wakeLock.request('screen');
                }
                catch { /* The browser or battery policy may deny the wake lock. */ }
            }
        };
        const visibility = () => { if (document.visibilityState === 'visible')
            void acquire(); };
        void acquire();
        document.addEventListener('visibilitychange', visibility);
        return () => { document.removeEventListener('visibilitychange', visibility); void wakeLock.current?.release(); };
    }, [connected]);
    const command = (type: CommandType, value?: Command['value']) => {
        if (!connected || viewPendingRef.current || state.phase !== 'idle' || upload?.sending)
            return;
        const id = createId(), assetId = state.assetId;
        const movesView = ['next', 'previous', 'page', 'zoom', 'fit', 'pan', 'scroll', 'static'].includes(type);
        if (movesView) {
            viewPendingRef.current = id;
            setViewPending(true);
        }
        setError('');
        void request(connection.control, 'viewer:command', { id, assetId, type, value } satisfies Command)
            .catch((reason: Error) => { if (connection.snapshot.status === 'connected' && connection.snapshot.viewer.assetId === assetId)
            setError(reason.message); })
            .finally(() => { if (movesView && viewPendingRef.current === id) {
            viewPendingRef.current = null;
            setViewPending(false);
        } });
    };
    const editInk = (type: 'undo' | 'clear') => {
        if (!controlsReady || viewPendingRef.current || !state.assetId)
            return;
        const assetId = state.assetId;
        const id = createId();
        viewPendingRef.current = id;
        setViewPending(true);
        setError('');
        void request(connection.control, 'viewer:ink', { id, assetId, page: state.page, type } satisfies InkCommand)
            .catch((reason: Error) => { if (connection.snapshot.status === 'connected' && connection.snapshot.viewer.assetId === assetId)
            setError(reason.message); })
            .finally(() => { if (viewPendingRef.current === id) {
            viewPendingRef.current = null;
            setViewPending(false);
        } });
    };
    const leave = () => {
        cancel();
        setRunning(false);
        void request(connection.control, 'pair:end').then(() => connection.finish(), (reason: Error) => setError(reason.message));
    };
    const remoteFullscreen = () => {
        setDisplayPending(true);
        setError('');
        void request(connection.control, 'display:command', !(snapshot.display.expanded || snapshot.display.native))
            .catch((reason: Error) => setError(reason.message)).finally(() => setDisplayPending(false));
    };
    if (snapshot.status === 'ended')
        return <div className="end-screen mobile-end"><Brand /><AppTools /><div className="end-symbol"><CheckCheck size={52}/></div><h1>{t("Todo listo.")}<br />{t("Todo cerrado.")}</h1><p>{t("La presentaci\u00F3n termin\u00F3.")}<br />{t("Escanea un nuevo QR para volver a conectar.")}</p><span className="privacy-line"><ShieldCheck size={16}/>{t("No conservamos tus archivos.")}</span></div>;
    if (snapshot.status === 'error')
        return <div className="end-screen mobile-end"><Brand /><AppTools /><div className="end-symbol error-symbol"><Smartphone size={52}/></div><h1>{t("No pudimos")}<br />{t("conectarte.")}</h1><p role="alert">{messageText(snapshot.error)}</p><Button className="primary" onClick={() => connection.retry()}><ScanLine size={18}/>{t("Volver a intentar")}</Button><p className="muted">{t("Solo el primer celular que escanea")}<br />{t("puede tomar el mando.")}</p></div>;
    return <div className="controller-app">
    <header className="controller-header"><Brand /><div className="controller-header-actions"><AppTools /><Button className="leave-button" onClick={leave} disabled={!connection.credentials}><X size={17}/>{t("Salir")}</Button></div></header>
    <main className="controller-main">
      <div className="controller-intro"><Status snapshot={snapshot}/><h1>{t("T\u00FA tienes")}<br />{t("el mando.")}</h1><p>{state.name ? t("Tu presentaci\u00F3n, a tu ritmo.") : t("Elige algo. Dale pantalla.")}</p></div>
      <input ref={picker} className="visually-hidden" type="file" accept={FILE_ACCEPT} aria-label={t("Seleccionar archivo para presentar")} tabIndex={-1} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file)
        void send(file);
    else
        connection.setFileSelection(false); }}/>
      <Button className="upload-button" data-guide="upload" disabled={!canSend} onClick={() => { connection.setFileSelection(true); picker.current?.click(); }}><span className="upload-icon"><Upload size={25}/></span><span><strong>{state.assetId ? t("Enviar otro archivo") : t("Enviar un archivo")}</strong><small>{t("Hasta 100 MB \u00B7 se muestra en tu pantalla")}</small></span><Plus size={23}/></Button>
      <LinkPanel connection={connection} enabled={connected} onReplace={cancel} onError={setError}/>
      {!upload && state.phase !== 'idle' && <div className="upload-progress source-progress" role="status"><div><strong>{state.pendingName || t('Preparando la presentación')}</strong><IconButton label={t('Cancelar envío')} onClick={() => { if (state.pendingId) void request(connection.control, 'asset:cancel', state.pendingId).catch((reason: Error) => setError(reason.message)); }}><X size={18}/></IconButton></div><span><LoaderCircle className="spin" size={16}/>{t('Preparando en la pantalla…')}</span></div>}
      {upload && (upload.sending || state.phase !== 'idle') && <div className="upload-progress" role="status"><div><strong>{upload.name}</strong><IconButton label={t("Cancelar env\u00EDo")} onClick={cancel}><X size={18}/></IconButton></div><div className="progress-track"><i style={{ transform: `scaleX(${upload.sending ? upload.progress : state.progress})` }}/></div><span>{upload.waiting ? t("Recuperando conexi\u00F3n para enviar\u2026") : upload.sending ? t(`Enviando · ${Math.round(upload.progress * 100)}%`) : state.phase === 'converting' ? t(`Convirtiendo en la pantalla · ${Math.round(state.progress * 100)}%`) : t("Preparando en la pantalla\u2026")}</span></div>}
      {(error || uploadError) && <div className="controller-error" role="alert"><CircleX size={19}/><span>{messageText(error || uploadError)}</span><IconButton label={t("Cerrar aviso")} onClick={() => { setError(''); setUploadError(''); }}><X size={16}/></IconButton></div>}
      <Button className="remote-fullscreen" disabled={!connected || displayPending || viewPending} aria-pressed={snapshot.display.expanded || snapshot.display.native} onClick={remoteFullscreen}>{snapshot.display.expanded || snapshot.display.native ? <Minimize size={19}/> : <Maximize size={19}/>}<span>{snapshot.display.expanded || snapshot.display.native ? t("Salir de pantalla completa del PC") : t("Pantalla completa del PC")}</span></Button>
      {snapshot.display.needsClick && <p className="fullscreen-help" role="status">{t("La presentaci\u00F3n ya ocupa la ventana del PC. Para ocultar las barras del navegador, toca \u00ABActivar pantalla completa\u00BB una vez en el computador.")}</p>}
      {state.assetId ? <>
        <div className="current-file"><span className="current-file-icon">{state.kind === 'audio' ? <AudioLines /> : state.kind === 'video' ? <Video /> : state.kind === 'image' ? <Image /> : <FileText />}</span><div><span>{t("Ahora en pantalla")}</span><strong>{displaySourceName(state)}</strong></div><Check size={20} className="file-check"/></div>
        <div className="controls-panel" aria-busy={viewPending}>
          {state.capabilities.includes('pages') && <section className="page-controls"><div className="section-caption"><span>{state.kind === 'powerpoint' ? t("Diapositivas") : t("P\u00E1ginas")}</span><span>{state.page}{t(" de ")}{state.pages}</span></div><div className="page-navigation"><Button aria-label={t("P\u00E1gina anterior")} disabled={!controlsReady || state.page === 1 && state.animationStep === 0} onClick={() => command('previous')}><ChevronLeft size={27}/></Button><form onSubmit={(event) => { event.preventDefault(); const target = Number(page); if (Number.isInteger(target) && target >= 1 && target <= state.pages)
                command('page', target);
            else
                setPage(String(state.page)); }}><input aria-label={t("Ir a p\u00E1gina")} type="number" disabled={!controlsReady} min={1} max={state.pages} value={page} onChange={(event) => setPage(event.target.value)}/><span>{t("/ ")}{state.pages}</span><button type="submit" className="visually-hidden">{t("Ir")}</button></form><Button aria-label={t("P\u00E1gina siguiente")} disabled={!controlsReady || state.page === state.pages && state.animationStep >= state.animationSteps} onClick={() => command('next')}><ChevronRight size={27}/></Button></div>
            {state.kind === 'powerpoint' && <div className="animation-control"><label><input type="checkbox" checked={state.staticMode} disabled={!controlsReady} onChange={(event) => command('static', event.target.checked)}/>{t("Vista est\u00E1tica")}</label>{!state.staticMode && state.animationSteps > 0 && <span>{t("Avance ")}{state.animationStep}{t(" / ")}{state.animationSteps}</span>}</div>}
          </section>}
          {state.capabilities.includes('media') && <section className="media-controls"><div className="section-caption"><span>{t("Reproducci\u00F3n")}</span><span>{formatTime(state.duration)}</span></div><Button className="play-button" disabled={!controlsReady || state.mediaPending} onClick={() => command(state.paused ? 'play' : 'pause')}>{state.mediaPending ? <LoaderCircle size={29} className="spin" aria-hidden="true"/> : state.paused ? <Play size={29} fill="currentColor"/> : <Pause size={29} fill="currentColor"/>}<span>{state.mediaPending ? t("Iniciando reproducción…") : state.paused ? t("Reproducir") : t("Pausar")}</span></Button>{(!state.mediaActions || state.mediaActions.includes('seek')) && <Slider disabled={!controlsReady} label={t("Posici\u00F3n")} value={state.currentTime} min={0} max={state.duration || 1} step={0.1} display={`${formatTime(state.currentTime)} / ${formatTime(state.duration)}`} onCommit={(value) => command('seek', value)}/>}{(!state.mediaActions || state.mediaActions.includes('volume')) && <Slider disabled={!controlsReady} label={t("Volumen")} value={state.volume} min={0} max={1} step={0.01} display={`${Math.round(state.volume * 100)}%`} icon={<Volume2 size={16}/>} onCommit={(value) => command('volume', value)}/>}<div className="media-extras">{(!state.mediaActions || state.mediaActions.includes('volume')) && <Button disabled={!controlsReady} aria-label={state.volume ? t("Silenciar") : t("Activar sonido")} onClick={() => command('volume', state.volume ? 0 : 1)}>{state.volume ? <Volume2 size={18}/> : <VolumeX size={18}/>}{state.volume ? t("Silenciar") : t("Sonido")}</Button>}{(!state.mediaActions || state.mediaActions.includes('rate')) && <label>{t("Velocidad")}<select aria-label={t("Velocidad de reproducci\u00F3n")} value={state.rate} disabled={!controlsReady} onChange={(event) => command('rate', Number(event.target.value))}>{[0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => <option key={value} value={value}>{value}{t("\u00D7")}</option>)}</select></label>}</div>{state.needsActivation && <p className="activation-hint">{state.link?.provider === 'youtube' ? t("Para escuchar el vídeo, pulsa «Activar audio» en el PC.") : t("Toca \u00ABActivar audio\u00BB en el computador antes de reproducir.")}</p>}</section>}
          {state.capabilities.includes('zoom') && <section className="zoom-controls"><div className="section-caption"><span><ZoomIn size={18}/>{t("Zoom")}</span><span>{Math.round(state.zoom * 100)}{t("%")}</span></div><div className="zoom-row"><IconButton label={t("Alejar")} disabled={!controlsReady || state.zoom <= 0.25} onClick={() => command('zoom', Math.max(0.25, state.zoom - 0.25))}><Minus size={20}/></IconButton><Button disabled={!controlsReady} onClick={() => command('fit')}><Expand size={17}/>{t("Ajustar")}</Button><IconButton label={t("Acercar")} disabled={!controlsReady || state.zoom >= 4} onClick={() => command('zoom', Math.min(4, state.zoom + 0.25))}><Plus size={20}/></IconButton></div>
            {state.zoom > 1 && state.capabilities.includes('pan') && <div className="pan-controls" aria-label={t("Desplazar contenido")}><IconButton label={t("Desplazar a la izquierda")} disabled={!controlsReady} onClick={() => command('pan', { x: -0.5, y: 0 })}><ArrowLeft size={19}/></IconButton><IconButton label={t("Desplazar hacia arriba")} disabled={!controlsReady} onClick={() => command('pan', { x: 0, y: -0.5 })}><ArrowUp size={19}/></IconButton><IconButton label={t("Desplazar hacia abajo")} disabled={!controlsReady} onClick={() => command('pan', { x: 0, y: 0.5 })}><ArrowDown size={19}/></IconButton><IconButton label={t("Desplazar a la derecha")} disabled={!controlsReady} onClick={() => command('pan', { x: 0.5, y: 0 })}><ArrowRight size={19}/></IconButton></div>}
          </section>}
          {state.capabilities.includes('scroll') && <section className="scroll-controls"><span>{t("Desplazar documento")}</span><IconButton label={t("Subir documento")} disabled={!controlsReady} onClick={() => command('scroll', -1)}><ArrowUp size={20}/></IconButton><IconButton label={t("Bajar documento")} disabled={!controlsReady} onClick={() => command('scroll', 1)}><ArrowDown size={20}/></IconButton></section>}
        </div>
        {state.capabilities.includes('laser') && <section className="guide-panel" aria-label={t("Herramientas para se\u00F1alar")}>
          <div className="guide-mode" role="group" aria-label={t("Herramienta de presentaci\u00F3n")}>
            <Button aria-pressed={guideMode === 'laser'} className={guideMode === 'laser' ? 'is-active' : ''} onClick={() => setGuideMode('laser')}><MousePointer2 size={18} aria-hidden="true"/>{t("L\u00E1ser")}</Button>
            {state.capabilities.includes('draw') && <Button aria-pressed={guideMode === 'marker'} className={guideMode === 'marker' ? 'is-active' : ''} onClick={() => setGuideMode('marker')}><PenLine size={18} aria-hidden="true"/>{t("Marcador")}</Button>}
          </div>
          {guideMode === 'laser' ? <LaserPad connection={connection} assetId={state.assetId} enabled={controlsReady && !state.black}/> : <>
            <MarkerTools color={inkColor} width={inkWidth} onColor={setInkColor} onWidth={setInkWidth} onUndo={() => editInk('undo')} onClear={() => editInk('clear')} disabled={!controlsReady || state.black || state.phase !== 'idle'} count={state.inkCount}/>
            <MarkerPad connection={connection} assetId={state.assetId} page={state.page} zoom={state.zoom} enabled={controlsReady && !state.black && state.phase === 'idle'} color={inkColor} width={inkWidth} count={state.inkCount} view={snapshot.previewView} onError={setError}/>
          </>}
        </section>}
        <Button className={`black-button ${state.black ? 'is-active' : ''}`} disabled={!controlsReady} onClick={() => command('black', !state.black)}><Square size={18} fill="currentColor"/>{state.black ? t("Mostrar presentaci\u00F3n") : t("Pantalla negra")}<span>{state.black ? t("Activada") : t("Pausa visual")}</span></Button>
      </> : <div className="controller-empty"><div className="empty-orbit"><FileImage size={29}/><span><Video size={19}/></span></div><h2>{t("Tu pr\u00F3xima gran idea")}<br />{t("empieza con un archivo.")}</h2><p>{t("Presenta, reproduce y gu\u00EDa.")}<br />{t("Todo desde aqu\u00ED.")}</p></div>}
      {(state.failedLink || state.link) && <ExternalActions source={(state.failedLink || state.link)!}/>}
      {state.notice && <p className="controller-notice" role="status">{messageText(state.noticeMessage || state.notice)}</p>}
      <div className="presentation-timer"><Timer size={19}/><span>{t("Tu tiempo")}</span><strong>{formatTime(elapsed)}</strong><IconButton label={running ? t("Pausar temporizador") : t("Iniciar temporizador")} onClick={() => setRunning(!running)}>{running ? <Pause size={16}/> : <Play size={16}/>}</IconButton><IconButton label={t("Reiniciar temporizador")} onClick={() => { setRunning(false); setElapsed(0); }}><Square size={13}/></IconButton></div>
      <footer className="controller-footer"><ShieldCheck size={15}/>{t("Sin cuentas, sin historial, sin archivos guardados.")}</footer>
    </main>
    {snapshot.status === 'reconnecting' && <div className="reconnect-banner" role="status"><LoaderCircle className="spin" size={17}/>{t("Reconectando. Tu pantalla sigue reservada.")}</div>}
  </div>;
}
export function App() { useLocale(); return window.location.pathname.replace(/\/$/, '') === '/control' ? <ControlPage /> : <HostPage />; }
