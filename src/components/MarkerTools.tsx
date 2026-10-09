import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { Check, PenLine, Trash2, Undo2 } from 'lucide-react';
import { INK_COLORS, type InkColor, type InkPoint, type InkWidth } from '../../shared/protocol';
import { request, type Connection } from '../connection';
import { InkGesture } from '../lib/ink-gesture';

const colorNames: Record<InkColor, string> = { coral: 'coral', blue: 'azul', yellow: 'amarillo', white: 'blanco', dark: 'oscuro' };
export function MarkerTools({ color, width, onColor, onWidth, onUndo, onClear, disabled, count }: {
  color: InkColor; width: InkWidth; onColor: (color: InkColor) => void; onWidth: (width: InkWidth) => void;
  onUndo: () => void; onClear: () => void; disabled: boolean; count: number;
}) {
  return <div className="marker-tools">
    <div className="marker-colors" role="group" aria-label="Color del marcador">
      {(Object.keys(INK_COLORS) as InkColor[]).map((value) => <button key={value} type="button" className={`marker-swatch ${value === color ? 'is-selected' : ''}`} style={{ '--marker-color': INK_COLORS[value] } as React.CSSProperties} disabled={disabled} aria-label={`Color ${colorNames[value]}`} aria-pressed={color === value} onClick={() => onColor(value)}><i>{color === value && <Check size={14} aria-hidden="true" />}</i></button>)}
    </div>
    <label className="marker-width"><span>Trazo</span><select aria-label="Grosor del marcador" value={width} disabled={disabled} onChange={(event) => onWidth(Number(event.target.value) as InkWidth)}><option value="0.006">Fino</option><option value="0.014">Grueso</option></select></label>
    <div className="marker-actions"><button type="button" className="button" disabled={disabled || count === 0} onClick={onUndo} aria-label="Deshacer último trazo" title="Deshacer último trazo"><Undo2 size={18} aria-hidden="true" /><span>Deshacer</span></button><button type="button" className="button" disabled={disabled || count === 0} onClick={onClear} aria-label="Borrar trazos de esta página" title="Borrar trazos de esta página"><Trash2 size={18} aria-hidden="true" /><span>Borrar</span></button></div>
  </div>;
}

export function MarkerPad({ connection, assetId, page, zoom, enabled, color, width, count, onError }: {
  connection: Connection; assetId: string; page: number; zoom: number; enabled: boolean; color: InkColor; width: InkWidth; count: number; onError: (message: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pointerId = useRef<number | undefined>(undefined);
  const sender = useRef<InkGesture | undefined>(undefined);
  const last = useRef<InkPoint | undefined>(undefined);
  const errorHandler = useRef(onError); errorHandler.current = onError;
  useEffect(() => {
    sender.current = new InkGesture((command) => request(connection.control, 'viewer:ink', command), (message) => { if (connection.snapshot.status === 'connected') errorHandler.current(message); });
    return () => sender.current?.cancel();
  }, [connection]);
  const clearPreview = () => { const node = canvas.current; node?.getContext('2d')?.clearRect(0, 0, node.width, node.height); };
  useEffect(() => { sender.current?.cancel(); pointerId.current = undefined; last.current = undefined; clearPreview(); }, [assetId, page, zoom, enabled]);
  useEffect(() => { if (!count) clearPreview(); }, [count]);
  const point = (event: ReactPointerEvent<HTMLDivElement> | PointerEvent, node: HTMLDivElement): InkPoint => {
    const rect = node.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  };
  const preview = (position: InkPoint) => {
    const node = canvas.current, context = node?.getContext('2d'); if (!node || !context) return;
    context.lineCap = 'round'; context.lineJoin = 'round'; context.lineWidth = width * node.height;
    context.strokeStyle = context.fillStyle = INK_COLORS[color]; context.beginPath();
    if (last.current) { context.moveTo(last.current.x * node.width, last.current.y * node.height); context.lineTo(position.x * node.width, position.y * node.height); context.stroke(); }
    else { context.arc(position.x * node.width, position.y * node.height, context.lineWidth / 2, 0, Math.PI * 2); context.fill(); }
    last.current = position;
  };
  const stop = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== pointerId.current) return;
    if (event.type === 'pointerup') { const position = point(event, event.currentTarget); sender.current?.move(position); preview(position); }
    pointerId.current = undefined; last.current = undefined; sender.current?.end();
  };
  return <div className={`marker-section ${enabled ? '' : 'is-disabled'}`}>
    <div className="section-caption"><span><PenLine size={18} aria-hidden="true" />Marcador</span><span>Página {page}</span></div>
    <div className="marker-pad" role="application" aria-label="Panel para dibujar sobre la presentación" aria-disabled={!enabled}
      onPointerDown={(event) => {
        if (!enabled || event.button !== 0 || !event.isPrimary || pointerId.current !== undefined) return;
        event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); pointerId.current = event.pointerId;
        clearPreview(); last.current = undefined; onError('');
        const position = point(event, event.currentTarget); preview(position); sender.current?.begin(assetId, page, color, width, position);
      }}
      onPointerMove={(event) => {
        if (event.pointerId !== pointerId.current || !enabled) return;
        const samples = event.nativeEvent.getCoalescedEvents?.();
        for (const sample of samples?.length ? samples : [event.nativeEvent]) { const position = point(sample, event.currentTarget); preview(position); sender.current?.move(position); }
      }} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop}>
      <canvas ref={canvas} width={800} height={480} aria-hidden="true" /><span>Dibuja aquí mirando la pantalla</span>
    </div>
    <p className="marker-help">Este panel representa el área visible del archivo. Los trazos se conservan en cada página.</p>
  </div>;
}
