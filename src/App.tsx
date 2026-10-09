import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, AudioLines, Check, CheckCheck, ChevronLeft, ChevronRight, CircleX, Expand, FileImage, FileSliders, FileText, Image, LoaderCircle, Maximize, Minimize, Minus, MousePointer2, Pause, PenLine, Play, Plus, ScanLine, Send, ShieldCheck, Smartphone, Square, Timer, Upload, Video, Volume2, VolumeX, X, ZoomIn } from 'lucide-react';
import { useConnection, request, type ConnectionSnapshot } from './connection';
import { Presenter } from './presenter';
import { ACK_TIMEOUT_MS, CHUNK_BYTES, FILE_ACCEPT, MAX_FILE_BYTES, TRANSFER_WINDOW, formatBytes, formatTime, kindFromName, type Command, type CommandType, type FileMeta, type InkColor, type InkCommand, type InkWidth, type PointerPosition, type ViewerState } from '../shared/protocol';
import type { Connection } from './connection';
import { createId } from './lib/id';
import { MarkerPad, MarkerTools } from './components/MarkerTools';

function Brand() {
  return <a className="brand" href="/" aria-label="Pronter, inicio"><svg viewBox="0 0 40 40" aria-hidden="true"><rect x="2" y="6" width="30" height="24" rx="7" fill="currentColor"/><path d="m17 12 10 6-10 6z" fill="white"/><circle cx="32" cy="8" r="6" fill="#ff755c"/><path d="m14 33-3 4m11-4 3 4" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg><span>pronter<span className="brand-period">.</span></span></a>;
}
function Button({ children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={`button ${className}`} {...props}>{children}</button>;
}
function IconButton({ label, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <Button className="icon-button" aria-label={label} title={label} {...props}>{children}</Button>;
}
function Status({ snapshot }: { snapshot: ConnectionSnapshot }) {
  const [remaining, setRemaining] = useState(20);
  useEffect(() => {
    if (!snapshot.reconnectAt) return;
    const tick = () => setRemaining(Math.max(0, Math.ceil(((snapshot.reconnectUntil ?? snapshot.reconnectAt! + snapshot.graceMs) - Date.now()) / 1000)));
    tick(); const interval = setInterval(tick, 1000); return () => clearInterval(interval);
  }, [snapshot.reconnectAt, snapshot.graceMs, snapshot.reconnectUntil]);
  const labels = { connecting: 'Preparando conexión', waiting: 'Listo para conectar', connected: 'Celular conectado', reconnecting: `Reconectando · ${remaining}s`, ended: 'Sesión terminada', error: 'No se pudo conectar' };
  const label = snapshot.selectingFile && ['connected', 'reconnecting'].includes(snapshot.status) ? 'Eligiendo archivo en el celular' : labels[snapshot.status];
  return <span className={`connection-status status-${snapshot.status}`} role="status"><i />{label}</span>;
}
function Formats() {
  return <div className="format-strip" aria-label="Formatos compatibles"><span><Image size={17} aria-hidden="true" />Imágenes</span><span><FileText size={17} aria-hidden="true" />PDF</span><span><FileSliders size={17} aria-hidden="true" />PowerPoint</span><span><AudioLines size={17} aria-hidden="true" />Audio</span><span><Video size={17} aria-hidden="true" />Video</span><span className="markdown-tag"><b aria-hidden="true">M↓</b>Markdown</span></div>;
}
function Landing({ snapshot }: { snapshot: ConnectionSnapshot }) {
  const url = snapshot.token && snapshot.publicUrl ? `${snapshot.publicUrl}/control#${snapshot.token}` : '';
  return <main className="landing">
    <section className="hero-story">
      <div className="hero-ticket"><span className="ticket-dot" />Pequeña pantalla. Grandes ideas.</div>
      <h1>Tu celular<br />tiene el mando.</h1>
      <p className="hero-description">Lo que tienes en tu bolsillo,<br />en la pantalla que tienes enfrente.</p>
      <div className="pocket-scene" aria-hidden="true">
        <div className="file-card file-card-back"><FileImage /><span>Un recuerdo</span></div>
        <div className="file-card file-card-middle"><AudioLines /><span>Una buena canción</span></div>
        <div className="phone-illustration"><div className="phone-speaker" /><div className="phone-display"><span>Tu próxima<br />gran idea.</span><div className="mini-slide"><i /><i /><i /></div><div className="mini-send"><ArrowUp size={22} /></div></div><div className="phone-home" /></div>
        <svg className="scene-swoosh" viewBox="0 0 220 140"><path d="M12 110c32-68 80 30 106-12s-10-65 26-64c30 1 43 27 56-16m-18 5 20-6-1 23" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span className="scene-spark spark-one">✳</span><span className="scene-spark spark-two">✳</span>
      </div>
      <ol className="how-it-works"><li><ScanLine aria-hidden="true" />Escanea</li><li><Send aria-hidden="true" />Envía</li><li><Expand aria-hidden="true" />Presenta</li></ol>
    </section>
    <section className="scan-station" aria-labelledby="scan-title">
      <div className="station-sticker"><MousePointer2 size={18} aria-hidden="true" />El escenario es tuyo</div>
      <div className="qr-projector">
        <div className="projector-topline"><span className="projector-light" /><span>Conexión instantánea</span><span className="projector-grill" /></div>
        <div className="qr-paper">{url ? <QRCodeSVG value={url} size={288} level="M" marginSize={4} title="Escanea con la cámara de tu celular para controlar esta pantalla" /> : <div className="qr-loading"><LoaderCircle className="spin" size={36} /><span>Preparando tu QR…</span></div>}</div>
        <h2 id="scan-title">Escanea. Y toma el mando.</h2>
        <p>Abre la cámara de tu celular<br />y apunta a este código.</p>
        <div className="station-note"><Smartphone size={16} aria-hidden="true" />Un celular, una pantalla, cero cuentas.</div>
      </div>
      <div className="projector-foot" aria-hidden="true"><i /><i /></div>
      <p className="station-privacy"><ShieldCheck size={16} aria-hidden="true" />Tus archivos viven solo en este momento.</p>
    </section>
    <footer className="landing-footer"><Formats /><span>Sin cuentas. Sin historial. Así de fácil.</span></footer>
  </main>;
}

function Progress({ state }: { state: ViewerState }) {
  if (state.phase === 'idle') return null;
  const label = state.phase === 'receiving' ? 'Recibiendo tu archivo' : state.phase === 'converting' ? 'Preparando un formato compatible' : 'Preparando la presentación';
  return <div className="stage-progress" role="status"><LoaderCircle className="spin" size={18} /><span>{label}</span>{state.phase !== 'preparing' && <b>{Math.round(state.progress * 100)}%</b>}<div className="progress-track"><i style={{ transform: `scaleX(${state.progress})` }} /></div></div>;
}
async function fullscreen() {
  if (document.fullscreenElement) await document.exitFullscreen();
  else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
  else throw new Error('Este navegador no permite pantalla completa. Usa el modo de pantalla completa de tu navegador.');
}

function HostPage() {
  const { connection, snapshot } = useConnection('host');
  const slot = useRef<HTMLDivElement>(null);
  const pointer = useRef<HTMLDivElement>(null);
  const presenter = useRef<Presenter | undefined>(undefined);
  const [error, setError] = useState('');
  const [isFullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  const [drawing, setDrawing] = useState(false);
  const [inkColor, setInkColor] = useState<InkColor>('coral');
  const [inkWidth, setInkWidth] = useState<InkWidth>(0.006);
  const state = snapshot.viewer;
  useEffect(() => {
    if (!slot.current || !pointer.current) return;
    presenter.current = new Presenter(connection, slot.current, pointer.current);
    return () => { presenter.current?.destroy(); presenter.current = undefined; };
  }, [connection]);
  useEffect(() => {
    const changed = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  useEffect(() => { presenter.current?.setDrawing(drawing && !!state.assetId, inkColor, inkWidth); }, [drawing, inkColor, inkWidth, state.assetId]);
  useEffect(() => {
    if (snapshot.status !== 'ended') return;
    presenter.current?.destroy(); presenter.current = undefined;
    const reload = setTimeout(() => window.location.reload(), 2000);
    return () => clearTimeout(reload);
  }, [snapshot.status]);
  const command = (type: CommandType, value?: Command['value']) => {
    const command: Command = { id: createId(), assetId: connection.snapshot.viewer.assetId, type, value };
    void presenter.current?.command(command).catch((reason: Error) => setError(reason.message));
  };
  const editInk = (type: 'undo' | 'clear') => {
    if (!state.assetId) return;
    try { presenter.current?.draw({ id: createId(), assetId: state.assetId, page: state.page, type }); }
    catch (reason) { setError((reason as Error).message); }
  };
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if ((event.target as Element).closest('input,textarea,select,[contenteditable]') || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.toLowerCase() === 'f') { event.preventDefault(); if (!event.repeat) void fullscreen().catch((reason: Error) => setError(reason.message)); return; }
      if ((event.target as Element).closest('button,a') || !connection.snapshot.viewer.assetId) return;
      const viewer = connection.snapshot.viewer;
      if (['ArrowRight', 'PageDown'].includes(event.key)) { event.preventDefault(); command(viewer.capabilities.includes('scroll') ? 'scroll' : 'next', viewer.capabilities.includes('scroll') ? 1 : undefined); }
      if (['ArrowLeft', 'PageUp'].includes(event.key)) { event.preventDefault(); command(viewer.capabilities.includes('scroll') ? 'scroll' : 'previous', viewer.capabilities.includes('scroll') ? -1 : undefined); }
      if (event.code === 'Space') { event.preventDefault(); command(viewer.capabilities.includes('media') ? viewer.paused ? 'play' : 'pause' : 'next'); }
      if (event.key.toLowerCase() === 'b') command('black', !viewer.black);
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [connection]);
  const landing = ['connecting', 'waiting', 'error'].includes(snapshot.status) && !state.assetId;
  if (snapshot.status === 'ended') return <div className="end-screen"><Brand /><div className="end-symbol"><CheckCheck size={56} /></div><h1>Sesión terminada.</h1><p>Un nuevo QR, un nuevo comienzo.</p><LoaderCircle className="spin" size={22} /></div>;
  return <div className={`host-app ${landing ? 'is-landing' : 'is-presenting'} ${isFullscreen ? 'is-fullscreen' : ''}`}>
    <header className="app-header"><Brand /><div className="header-right"><Status snapshot={snapshot} /><Button className="fullscreen-button" aria-label={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'} aria-pressed={isFullscreen} title={isFullscreen ? 'Salir de pantalla completa (F o Esc)' : 'Pantalla completa (F)'} onClick={() => { void fullscreen().catch((reason: Error) => setError(reason.message)); }}>{isFullscreen ? <Minimize size={19} aria-hidden="true" /> : <Maximize size={19} aria-hidden="true" />}<span>{isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}</span></Button></div></header>
    {landing && <Landing snapshot={snapshot} />}
    <main className={`stage-shell ${landing ? 'is-hidden' : ''}`} aria-label="Pantalla de presentación">
      <div className="stage-topline"><span>{state.name || 'Tu pantalla está lista'}</span><span>{state.capabilities.includes('pages') ? `${state.page} / ${state.pages}` : state.kind === 'video' || state.kind === 'audio' ? formatTime(state.currentTime) : ''}</span></div>
      {state.capabilities.includes('draw') && <div className="host-marker-bar"><Button className={`marker-toggle ${drawing ? 'is-active' : ''}`} aria-pressed={drawing} disabled={state.black || state.phase !== 'idle'} onClick={() => setDrawing(!drawing)}><PenLine size={18} aria-hidden="true" />Dibujar en el PC</Button>{drawing ? <MarkerTools color={inkColor} width={inkWidth} onColor={setInkColor} onWidth={setInkWidth} onUndo={() => editInk('undo')} onClear={() => editInk('clear')} disabled={state.black || state.phase !== 'idle'} count={state.inkCount} /> : <span className="marker-bar-hint">También puedes dibujar desde el celular.</span>}</div>}
      <div className="stage-area">
        <div ref={slot} className="viewer-slot" data-testid="viewer-slot" />
        {!state.assetId && <div className="empty-stage"><div className="empty-projector"><Send size={48} strokeWidth={1.5} /></div><span className="small-badge"><Check size={14} />Conectados</span><h1>La pantalla es tuya.</h1><p>Envía tu primer archivo desde el celular.<br />Imágenes, presentaciones, música… tú eliges.</p><Formats /></div>}
        <div ref={pointer} className="laser-pointer" data-testid="host-laser" aria-hidden="true"><i /></div>
        {state.black && <div className="black-curtain" aria-label="Pantalla negra" />}
        <Progress state={state} />
      </div>
      <div className="stage-toolbar"><div className="toolbar-status"><span className="connected-dot" />Controlado desde tu celular</div><div className="toolbar-actions">
        {state.capabilities.includes('pages') && <><IconButton label="Página anterior" onClick={() => command('previous')}><ChevronLeft size={20} /></IconButton><IconButton label="Página siguiente" onClick={() => command('next')}><ChevronRight size={20} /></IconButton></>}
        {state.capabilities.includes('zoom') && <IconButton label="Ajustar a pantalla" onClick={() => command('fit')}><Expand size={18} /></IconButton>}
        {(state.capabilities.includes('media') || state.kind === 'powerpoint') && <Button className={`audio-activation ${state.needsActivation ? 'needs-activation' : ''}`} onClick={() => { void presenter.current?.activate().catch((reason: Error) => setError(reason.message)); }}><Volume2 size={17} />Activar audio</Button>}
        {state.assetId && <IconButton label={state.black ? 'Mostrar presentación' : 'Pantalla negra'} onClick={() => command('black', !state.black)}><Square size={17} fill={state.black ? 'currentColor' : 'none'} /></IconButton>}
      </div></div>
      {state.notice && <div className="viewer-notice" role="status">{state.notice}</div>}
    </main>
    {snapshot.status === 'reconnecting' && <div className="reconnect-banner" role="status"><LoaderCircle className="spin" size={18} />{snapshot.selectingFile ? 'El celular está eligiendo un archivo. La pantalla sigue reservada.' : 'Esperando que vuelva la conexión. Conservamos tu presentación.'}</div>}
    {(error || snapshot.error) && <div className="error-banner" role="alert"><CircleX size={18} /><span>{error || snapshot.error}</span><IconButton label="Cerrar aviso" onClick={() => setError('')}><X size={16} /></IconButton></div>}
  </div>;
}

interface UploadState { id: string; name: string; progress: number; sending: boolean; waiting?: boolean }
function useUpload(connection: Connection) {
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [error, setError] = useState('');
  const active = useRef<{ id: string; cancelled: boolean; controller: AbortController } | undefined>(undefined);
  useEffect(() => {
    const cancel = ({ id, reason }: { id?: string; reason: string }) => { if (active.current && (!id || id === active.current.id)) { active.current.cancelled = true; active.current.controller.abort(); active.current = undefined; setUpload(null); setError(reason); } };
    const remove = connection.onData('transfer:cancel', cancel);
    return () => { if (active.current) { active.current.cancelled = true; active.current.controller.abort(); } remove(); };
  }, [connection]);
  const cancelActive = () => {
    if (!active.current) return;
    const id = active.current.id; active.current.cancelled = true; active.current.controller.abort(); active.current = undefined;
    setUpload(null); void request(connection.control, 'asset:cancel', id).catch(() => {});
  };
  const cancel = () => { connection.setFileSelection(false); cancelActive(); };
  const send = async (file: File) => {
    const kind = kindFromName(file.name);
    if (!kind) { connection.setFileSelection(false); setError('Este formato no es compatible. Elige una imagen, PDF, PowerPoint, audio, video o Markdown.'); return; }
    if (!file.size || file.size > MAX_FILE_BYTES) { connection.setFileSelection(false); setError('Elige un archivo no vacío de hasta 1 GB.'); return; }
    cancelActive();
    const job = { id: createId(), cancelled: false, controller: new AbortController() }; active.current = job;
    setError(''); setUpload({ id: job.id, name: file.name, progress: 0, sending: true, waiting: true });
    const meta: FileMeta = { id: job.id, name: file.name, type: file.type, size: file.size, kind };
    let sent = 0;
    const pending: Promise<unknown>[] = [];
    try {
      const data = await connection.waitForReady(job.controller.signal);
      if (job.cancelled) return;
      connection.setFileSelection(false);
      setUpload({ id: job.id, name: file.name, progress: 0, sending: true });
      await request(data, 'transfer:begin', meta);
      for (let offset = 0, index = 0; offset < file.size; offset += CHUNK_BYTES, index++) {
        if (job.cancelled) return;
        const bytes = await file.slice(offset, offset + CHUNK_BYTES).arrayBuffer();
        if (job.cancelled) return;
        const length = bytes.byteLength;
        const task = request(data, 'transfer:chunk', job.id, index, bytes).then(() => {
          sent += length;
          if (!job.cancelled && active.current === job) setUpload({ id: job.id, name: file.name, progress: sent / file.size, sending: true });
        });
        // Attach a handler immediately; the batch awaits the original promise below.
        void task.catch(() => {});
        pending.push(task);
        if (pending.length === TRANSFER_WINDOW) { await Promise.all(pending); pending.length = 0; }
      }
      await Promise.all(pending);
      if (job.cancelled) return;
      await request(data, 'transfer:end', job.id);
      if (active.current === job) setUpload({ id: job.id, name: file.name, progress: 1, sending: false });
    } catch (reason) {
      if (!job.cancelled && active.current === job) {
        setError((reason as Error).message); setUpload(null);
        void request(connection.control, 'asset:cancel', job.id).catch(() => {});
      }
    } finally { if (active.current === job) connection.setFileSelection(false); await Promise.allSettled(pending); }
  };
  return { upload, error, setError, send, cancel };
}

function Slider({ label, value, min, max, step, onCommit, display, icon }: { label: string; value: number; min: number; max: number; step?: number; onCommit: (value: number) => void; display: ReactNode; icon?: ReactNode }) {
  const [local, setLocal] = useState(value);
  const active = useRef(false);
  useEffect(() => { if (!active.current) setLocal(value); }, [value]);
  const commit = () => { active.current = false; onCommit(local); };
  return <label className="slider-control"><span>{icon}{label}<b>{display}</b></span><input type="range" aria-label={label} min={min} max={Math.max(min, max)} step={step || 1} value={Math.max(min, Math.min(max, local))} onPointerDown={() => { active.current = true; }} onChange={(event) => { active.current = true; setLocal(Number(event.target.value)); }} onPointerUp={commit} onPointerCancel={() => { active.current = false; setLocal(value); }} onKeyUp={commit} onBlur={() => { if (active.current) commit(); }} /></label>;
}

function LaserPad({ connection, assetId, enabled }: { connection: Connection; assetId: string | null; enabled: boolean }) {
  const pad = useRef<HTMLDivElement>(null);
  const dot = useRef<HTMLDivElement>(null);
  const position = useRef({ x: 0.5, y: 0.5 });
  const active = useRef(false);
  const lastSent = useRef(0);
  const heartbeat = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const emit = (visible: boolean, force = false) => {
    if (!connection.control.connected) return;
    const now = performance.now();
    if (visible && !force && now - lastSent.current < 33) return;
    lastSent.current = now;
    connection.control.volatile.emit('viewer:pointer', { ...position.current, visible, assetId } satisfies PointerPosition);
  };
  const move = (x: number, y: number) => {
    position.current = { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
    if (dot.current && pad.current) { dot.current.style.transform = `translate(${position.current.x * pad.current.clientWidth}px, ${position.current.y * pad.current.clientHeight}px)`; dot.current.style.opacity = '1'; }
    emit(true);
  };
  const stop = () => { active.current = false; clearInterval(heartbeat.current); if (dot.current) dot.current.style.opacity = '0'; emit(false, true); };
  useEffect(() => { if (!enabled) stop(); return stop; }, [enabled, assetId]);
  return <div className={`laser-section ${enabled ? '' : 'is-disabled'}`}><div className="section-caption"><span><MousePointer2 size={18} aria-hidden="true" />Puntero láser</span><span>Mantén y desliza</span></div><div ref={pad} className="laser-pad" role="application" tabIndex={enabled ? 0 : -1} aria-label="Puntero láser. Mantén y desliza, o usa las flechas del teclado." aria-disabled={!enabled}
    onPointerDown={(event) => {
      if (!enabled) return;
      event.currentTarget.setPointerCapture(event.pointerId); active.current = true;
      const rect = event.currentTarget.getBoundingClientRect(); move((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
      clearInterval(heartbeat.current); heartbeat.current = setInterval(() => emit(active.current, true), 150);
    }}
    onPointerMove={(event) => { if (!active.current || !enabled) return; const rect = event.currentTarget.getBoundingClientRect(); move((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height); }}
    onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop}
    onKeyDown={(event) => {
      if (!enabled || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault(); move(position.current.x + (event.key === 'ArrowRight' ? 0.025 : event.key === 'ArrowLeft' ? -0.025 : 0), position.current.y + (event.key === 'ArrowDown' ? 0.025 : event.key === 'ArrowUp' ? -0.025 : 0));
    }} onKeyUp={() => emit(false, true)} onBlur={stop}>
    <div className="pad-crosshair" aria-hidden="true"><i /><i /></div><span className="pad-hint">Tu dedo guía la presentación</span><div ref={dot} className="pad-dot" aria-hidden="true" />
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
  const wakeLock = useRef<WakeLockSentinel | undefined>(undefined);
  const state = snapshot.viewer;
  const connected = snapshot.status === 'connected';
  const canSend = connected && snapshot.dataReady;
  useEffect(() => {
    const input = picker.current;
    const cancelled = () => connection.setFileSelection(false);
    input?.addEventListener('cancel', cancelled);
    return () => input?.removeEventListener('cancel', cancelled);
  }, [connection, snapshot.status]);
  useEffect(() => { setPage(String(state.page)); }, [state.page, state.assetId]);
  useEffect(() => {
    if (!running) return;
    const started = Date.now() - elapsed * 1000;
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(interval);
  }, [running]);
  useEffect(() => {
    const acquire = async () => {
      if (connected && document.visibilityState === 'visible' && 'wakeLock' in navigator) {
        try { wakeLock.current = await navigator.wakeLock.request('screen'); } catch { /* The browser or battery policy may deny the wake lock. */ }
      }
    };
    const visibility = () => { if (document.visibilityState === 'visible') void acquire(); };
    void acquire(); document.addEventListener('visibilitychange', visibility);
    return () => { document.removeEventListener('visibilitychange', visibility); void wakeLock.current?.release(); };
  }, [connected]);
  const command = (type: CommandType, value?: Command['value']) => {
    if (!connected) return;
    setError('');
    void request(connection.control, 'viewer:command', { id: createId(), assetId: state.assetId, type, value } satisfies Command).catch((reason: Error) => setError(reason.message));
  };
  const editInk = (type: 'undo' | 'clear') => {
    if (!connected || !state.assetId) return;
    setError('');
    void request(connection.control, 'viewer:ink', { id: createId(), assetId: state.assetId, page: state.page, type } satisfies InkCommand).catch((reason: Error) => setError(reason.message));
  };
  const leave = () => {
    cancel(); setRunning(false);
    void request(connection.control, 'pair:end').then(() => connection.finish(), (reason: Error) => setError(reason.message));
  };
  if (snapshot.status === 'ended') return <div className="end-screen mobile-end"><Brand /><div className="end-symbol"><CheckCheck size={52} /></div><h1>Todo listo.<br />Todo cerrado.</h1><p>La presentación terminó.<br />Escanea un nuevo QR para volver a conectar.</p><span className="privacy-line"><ShieldCheck size={16} />No conservamos tus archivos.</span></div>;
  if (snapshot.status === 'error') return <div className="end-screen mobile-end"><Brand /><div className="end-symbol error-symbol"><Smartphone size={52} /></div><h1>No pudimos<br />conectarte.</h1><p role="alert">{snapshot.error}</p><Button className="primary" onClick={() => connection.retry()}><ScanLine size={18} />Volver a intentar</Button><p className="muted">Solo el primer celular que escanea<br />puede tomar el mando.</p></div>;
  return <div className="controller-app">
    <header className="controller-header"><Brand /><Button className="leave-button" onClick={leave} disabled={!connection.credentials}><X size={17} />Salir</Button></header>
    <main className="controller-main">
      <div className="controller-intro"><Status snapshot={snapshot} /><h1>Tú tienes<br />el mando.</h1><p>{state.name ? 'Tu presentación, a tu ritmo.' : 'Elige algo. Dale pantalla.'}</p></div>
      <input ref={picker} className="visually-hidden" type="file" accept={FILE_ACCEPT} aria-label="Seleccionar archivo para presentar" tabIndex={-1} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void send(file); else connection.setFileSelection(false); }} />
      <Button className="upload-button" disabled={!canSend} onClick={() => { connection.setFileSelection(true); picker.current?.click(); }}><span className="upload-icon"><Upload size={25} /></span><span><strong>{state.assetId ? 'Enviar otro archivo' : 'Enviar un archivo'}</strong><small>Hasta 1 GB · se muestra en tu pantalla</small></span><Plus size={23} /></Button>
      {upload && (upload.sending || state.phase !== 'idle') && <div className="upload-progress" role="status"><div><strong>{upload.name}</strong><IconButton label="Cancelar envío" onClick={cancel}><X size={18} /></IconButton></div><div className="progress-track"><i style={{ transform: `scaleX(${upload.sending ? upload.progress : state.progress})` }} /></div><span>{upload.waiting ? 'Recuperando conexión para enviar…' : upload.sending ? `Enviando · ${Math.round(upload.progress * 100)}%` : state.phase === 'converting' ? `Convirtiendo en la pantalla · ${Math.round(state.progress * 100)}%` : 'Preparando en la pantalla…'}</span></div>}
      {(error || uploadError) && <div className="controller-error" role="alert"><CircleX size={19} /><span>{error || uploadError}</span><IconButton label="Cerrar aviso" onClick={() => { setError(''); setUploadError(''); }}><X size={16} /></IconButton></div>}
      {state.assetId ? <>
        <div className="current-file"><span className="current-file-icon">{state.kind === 'audio' ? <AudioLines /> : state.kind === 'video' ? <Video /> : state.kind === 'image' ? <Image /> : <FileText />}</span><div><span>Ahora en pantalla</span><strong>{state.name}</strong></div><Check size={20} className="file-check" /></div>
        <div className="controls-panel">
          {state.capabilities.includes('pages') && <section className="page-controls"><div className="section-caption"><span>{state.kind === 'powerpoint' ? 'Diapositivas' : 'Páginas'}</span><span>{state.page} de {state.pages}</span></div><div className="page-navigation"><Button aria-label="Página anterior" disabled={!connected || state.page === 1 && state.animationStep === 0} onClick={() => command('previous')}><ChevronLeft size={27} /></Button><form onSubmit={(event) => { event.preventDefault(); const target = Number(page); if (Number.isInteger(target) && target >= 1 && target <= state.pages) command('page', target); else setPage(String(state.page)); }}><input aria-label="Ir a página" type="number" min={1} max={state.pages} value={page} onChange={(event) => setPage(event.target.value)} /><span>/ {state.pages}</span><button type="submit" className="visually-hidden">Ir</button></form><Button aria-label="Página siguiente" disabled={!connected || state.page === state.pages && state.animationStep >= state.animationSteps} onClick={() => command('next')}><ChevronRight size={27} /></Button></div>
            {state.kind === 'powerpoint' && <div className="animation-control"><label><input type="checkbox" checked={state.staticMode} disabled={!connected} onChange={(event) => command('static', event.target.checked)} />Vista estática</label>{!state.staticMode && state.animationSteps > 0 && <span>Avance {state.animationStep} / {state.animationSteps}</span>}</div>}
          </section>}
          {state.capabilities.includes('media') && <section className="media-controls"><div className="section-caption"><span>Reproducción</span><span>{formatTime(state.duration)}</span></div><Button className="play-button" disabled={!connected} onClick={() => command(state.paused ? 'play' : 'pause')}>{state.paused ? <Play size={29} fill="currentColor" /> : <Pause size={29} fill="currentColor" />}<span>{state.paused ? 'Reproducir' : 'Pausar'}</span></Button><Slider label="Posición" value={state.currentTime} min={0} max={state.duration || 1} step={0.1} display={`${formatTime(state.currentTime)} / ${formatTime(state.duration)}`} onCommit={(value) => command('seek', value)} /><Slider label="Volumen" value={state.volume} min={0} max={1} step={0.01} display={`${Math.round(state.volume * 100)}%`} icon={<Volume2 size={16} />} onCommit={(value) => command('volume', value)} /><div className="media-extras"><Button disabled={!connected} aria-label={state.volume ? 'Silenciar' : 'Activar sonido'} onClick={() => command('volume', state.volume ? 0 : 1)}>{state.volume ? <Volume2 size={18} /> : <VolumeX size={18} />}{state.volume ? 'Silenciar' : 'Sonido'}</Button><label>Velocidad<select aria-label="Velocidad de reproducción" value={state.rate} disabled={!connected} onChange={(event) => command('rate', Number(event.target.value))}>{[0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => <option key={value} value={value}>{value}×</option>)}</select></label></div>{state.needsActivation && <p className="activation-hint">Toca «Activar audio» en el computador antes de reproducir.</p>}</section>}
          {state.capabilities.includes('zoom') && <section className="zoom-controls"><div className="section-caption"><span><ZoomIn size={18} />Zoom</span><span>{Math.round(state.zoom * 100)}%</span></div><div className="zoom-row"><IconButton label="Alejar" disabled={!connected || state.zoom <= 0.25} onClick={() => command('zoom', Math.max(0.25, state.zoom - 0.25))}><Minus size={20} /></IconButton><Button disabled={!connected} onClick={() => command('fit')}><Expand size={17} />Ajustar</Button><IconButton label="Acercar" disabled={!connected || state.zoom >= 4} onClick={() => command('zoom', Math.min(4, state.zoom + 0.25))}><Plus size={20} /></IconButton></div>
            {state.zoom > 1 && state.capabilities.includes('pan') && <div className="pan-controls" aria-label="Desplazar contenido"><IconButton label="Desplazar a la izquierda" onClick={() => command('pan', { x: -0.5, y: 0 })}><ArrowLeft size={19} /></IconButton><IconButton label="Desplazar hacia arriba" onClick={() => command('pan', { x: 0, y: -0.5 })}><ArrowUp size={19} /></IconButton><IconButton label="Desplazar hacia abajo" onClick={() => command('pan', { x: 0, y: 0.5 })}><ArrowDown size={19} /></IconButton><IconButton label="Desplazar a la derecha" onClick={() => command('pan', { x: 0.5, y: 0 })}><ArrowRight size={19} /></IconButton></div>}
          </section>}
          {state.capabilities.includes('scroll') && <section className="scroll-controls"><span>Desplazar documento</span><IconButton label="Subir documento" disabled={!connected} onClick={() => command('scroll', -1)}><ArrowUp size={20} /></IconButton><IconButton label="Bajar documento" disabled={!connected} onClick={() => command('scroll', 1)}><ArrowDown size={20} /></IconButton></section>}
        </div>
        {state.capabilities.includes('laser') && <section className="guide-panel" aria-label="Herramientas para señalar">
          <div className="guide-mode" role="group" aria-label="Herramienta de presentación">
            <Button aria-pressed={guideMode === 'laser'} className={guideMode === 'laser' ? 'is-active' : ''} onClick={() => setGuideMode('laser')}><MousePointer2 size={18} aria-hidden="true" />Láser</Button>
            {state.capabilities.includes('draw') && <Button aria-pressed={guideMode === 'marker'} className={guideMode === 'marker' ? 'is-active' : ''} onClick={() => setGuideMode('marker')}><PenLine size={18} aria-hidden="true" />Marcador</Button>}
          </div>
          {guideMode === 'laser' ? <LaserPad connection={connection} assetId={state.assetId} enabled={connected && !state.black} /> : <>
            <MarkerTools color={inkColor} width={inkWidth} onColor={setInkColor} onWidth={setInkWidth} onUndo={() => editInk('undo')} onClear={() => editInk('clear')} disabled={!connected || state.black || state.phase !== 'idle'} count={state.inkCount} />
            <MarkerPad connection={connection} assetId={state.assetId} page={state.page} zoom={state.zoom} enabled={connected && !state.black && state.phase === 'idle'} color={inkColor} width={inkWidth} count={state.inkCount} onError={setError} />
          </>}
        </section>}
        <Button className={`black-button ${state.black ? 'is-active' : ''}`} disabled={!connected} onClick={() => command('black', !state.black)}><Square size={18} fill="currentColor" />{state.black ? 'Mostrar presentación' : 'Pantalla negra'}<span>{state.black ? 'Activada' : 'Pausa visual'}</span></Button>
      </> : <div className="controller-empty"><div className="empty-orbit"><FileImage size={29} /><span><Video size={19} /></span></div><h2>Tu próxima gran idea<br />empieza con un archivo.</h2><p>Presenta, reproduce y guía.<br />Todo desde aquí.</p></div>}
      {state.notice && <p className="controller-notice" role="status">{state.notice}</p>}
      <div className="presentation-timer"><Timer size={19} /><span>Tu tiempo</span><strong>{formatTime(elapsed)}</strong><IconButton label={running ? 'Pausar temporizador' : 'Iniciar temporizador'} onClick={() => setRunning(!running)}>{running ? <Pause size={16} /> : <Play size={16} />}</IconButton><IconButton label="Reiniciar temporizador" onClick={() => { setRunning(false); setElapsed(0); }}><Square size={13} /></IconButton></div>
      <footer className="controller-footer"><ShieldCheck size={15} />Sin cuentas, sin historial, sin archivos guardados.</footer>
    </main>
    {snapshot.status === 'reconnecting' && <div className="reconnect-banner" role="status"><LoaderCircle className="spin" size={17} />Reconectando. Tu pantalla sigue reservada.</div>}
  </div>;
}

export function App() { return window.location.pathname.replace(/\/$/, '') === '/control' ? <ControlPage /> : <HostPage />; }
