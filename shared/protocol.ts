import { z } from 'zod';

export const MAX_FILE_BYTES = 1_000_000_000;
export const MAX_CONVERSION_BYTES = 200_000_000;
export const CHUNK_BYTES = 256 * 1024;
export const TRANSFER_WINDOW = 4;
export const ACK_TIMEOUT_MS = 15000;
export const FILE_PICKER_GRACE_MS = 10 * 60 * 1000;
export const MAX_PREVIEW_BYTES = 128 * 1024;
export interface DisplayState { expanded: boolean; native: boolean; needsClick: boolean }
export const emptyDisplay = (): DisplayState => ({ expanded: false, native: false, needsClick: false });
export const displaySchema = z.object({ expanded: z.boolean(), native: z.boolean(), needsClick: z.boolean() }).strict();
export interface PairPresence { selectingFile: boolean; reconnectUntil: number | null }
export const FILE_ACCEPT = '.jpg,.jpeg,.png,.webp,.gif,.avif,.svg,.heic,.heif,.pdf,.ppt,.pptx,.mp3,.wav,.m4a,.aac,.ogg,.flac,.opus,.mp4,.webm,.mov,.mkv,.avi,.md,.markdown';
export type FileKind = 'image' | 'pdf' | 'powerpoint' | 'audio' | 'video' | 'markdown';
export type Role = 'host' | 'controller';
export type Capability = 'pages' | 'zoom' | 'pan' | 'laser' | 'media' | 'scroll' | 'animations' | 'draw';
export type ConnectionStatus = 'connecting' | 'waiting' | 'connected' | 'reconnecting' | 'ended' | 'error';
export type Reply<T = unknown> = { ok: boolean; data?: T; error?: string; code?: string };
export type Ack<T = unknown> = (reply: Reply<T>) => void;
export interface Credentials { id: string; key: string; role: Role }
export interface PairResponse extends Credentials { token?: string; connected: boolean }
export interface FileMeta { id: string; name: string; size: number; type: string; kind: FileKind }
export interface PointerPosition { x: number; y: number; visible: boolean; assetId: string | null }
export interface ViewerState {
  assetId: string | null;
  name: string;
  kind: FileKind | null;
  capabilities: Capability[];
  page: number;
  pages: number;
  zoom: number;
  paused: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  rate: number;
  black: boolean;
  staticMode: boolean;
  animationStep: number;
  animationSteps: number;
  needsActivation: boolean;
  progress: number;
  phase: 'idle' | 'receiving' | 'preparing' | 'converting';
  notice: string;
  inkCount: number;
}
export const emptyViewer = (): ViewerState => ({
  assetId: null, name: '', kind: null, capabilities: [], page: 1, pages: 1,
  zoom: 1, paused: true, currentTime: 0, duration: 0, volume: 1, rate: 1,
  black: false, staticMode: false, animationStep: 0, animationSteps: 0,
  needsActivation: false, progress: 0, phase: 'idle', notice: '', inkCount: 0,
});
export const COMMANDS = ['next', 'previous', 'page', 'zoom', 'fit', 'pan', 'scroll', 'play', 'pause', 'volume', 'seek', 'rate', 'black', 'static'] as const;
export type CommandType = typeof COMMANDS[number];
export interface Command { id: string; assetId: string | null; type: CommandType; value?: number | boolean | { x: number; y: number } }

const id = z.string().min(1).max(100);
export const previewViewSchema = z.object({ assetId: id, viewId: id, page: z.number().int().min(1).max(100000), zoom: z.number().min(0.25).max(4) }).strict();
export const previewFrameSchema = previewViewSchema.extend({ sequence: z.number().int().min(1), width: z.number().int().min(1).max(800), height: z.number().int().min(1).max(800) }).strict();
export type PreviewView = z.infer<typeof previewViewSchema>;
export type PreviewFrame = z.infer<typeof previewFrameSchema>;
export const INK_COLORS = { coral: '#e34234', blue: '#2448e8', yellow: '#f2b705', white: '#ffffff', dark: '#18234b' } as const;
export type InkColor = keyof typeof INK_COLORS;
export type InkWidth = 0.006 | 0.014;
export interface InkPoint { x: number; y: number }
const inkBase = { id, assetId: id, page: z.number().int().min(1).max(100000) };
const inkPoint = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict();
export const inkSchema = z.discriminatedUnion('type', [
  z.object({ ...inkBase, type: z.literal('begin'), strokeId: id, color: z.enum(['coral', 'blue', 'yellow', 'white', 'dark']), width: z.union([z.literal(0.006), z.literal(0.014)]), point: inkPoint, viewId: id.optional() }).strict(),
  z.object({ ...inkBase, type: z.literal('points'), strokeId: id, sequence: z.number().int().min(1).max(10000), points: z.array(inkPoint).min(1).max(32) }).strict(),
  z.object({ ...inkBase, type: z.literal('end'), strokeId: id }).strict(),
  z.object({ ...inkBase, type: z.literal('undo') }).strict(),
  z.object({ ...inkBase, type: z.literal('clear') }).strict(),
]);
export type InkCommand = z.infer<typeof inkSchema>;
export const fileMetaSchema = z.object({
  id, name: z.string().min(1).max(255), size: z.number().int().positive().max(MAX_FILE_BYTES),
  type: z.string().max(160), kind: z.enum(['image', 'pdf', 'powerpoint', 'audio', 'video', 'markdown']),
}).strict();
export const commandSchema = z.object({
  id, assetId: id.nullable(), type: z.enum(COMMANDS),
  value: z.union([z.number().finite(), z.boolean(), z.object({ x: z.number().finite(), y: z.number().finite() }).strict()]).optional(),
}).strict().refine((c) => {
  if (['next', 'previous', 'fit', 'play', 'pause'].includes(c.type)) return c.value === undefined;
  if (['black', 'static'].includes(c.type)) return typeof c.value === 'boolean';
  if (c.type === 'pan') return typeof c.value === 'object' && Math.abs(c.value.x) <= 1 && Math.abs(c.value.y) <= 1;
  if (typeof c.value !== 'number') return false;
  const ranges: Partial<Record<CommandType, [number, number]>> = { page: [1, 100000], zoom: [0.25, 4], scroll: [-1, 1], volume: [0, 1], seek: [0, 864000], rate: [0.25, 3] };
  const range = ranges[c.type];
  return !!range && c.value >= range[0] && c.value <= range[1] && (c.type !== 'page' || Number.isInteger(c.value));
});
export const pointerSchema = z.object({
  x: z.number().min(0).max(1), y: z.number().min(0).max(1), visible: z.boolean(), assetId: id.nullable(),
}).strict();
export const viewerSchema = z.object({
  assetId: id.nullable(), name: z.string().max(255), kind: z.enum(['image', 'pdf', 'powerpoint', 'audio', 'video', 'markdown']).nullable(),
  capabilities: z.array(z.enum(['pages', 'zoom', 'pan', 'laser', 'media', 'scroll', 'animations', 'draw'])).max(8),
  page: z.number().int().min(1).max(100000), pages: z.number().int().min(1).max(100000), zoom: z.number().min(0.25).max(4),
  paused: z.boolean(), currentTime: z.number().finite().min(0), duration: z.number().finite().min(0), volume: z.number().min(0).max(1), rate: z.number().min(0.25).max(3),
  black: z.boolean(), staticMode: z.boolean(), animationStep: z.number().int().min(0), animationSteps: z.number().int().min(0),
  needsActivation: z.boolean(), progress: z.number().min(0).max(1), phase: z.enum(['idle', 'receiving', 'preparing', 'converting']), notice: z.string().max(500), inkCount: z.number().int().min(0).max(250),
}).strict();

export function kindFromName(name: string): FileKind | null {
  const extension = name.toLowerCase().split('.').pop() ?? '';
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'svg', 'heic', 'heif'].includes(extension)) return 'image';
  if (extension === 'pdf') return 'pdf';
  if (['ppt', 'pptx'].includes(extension)) return 'powerpoint';
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus'].includes(extension)) return 'audio';
  if (['mp4', 'webm', 'mov', 'mkv', 'avi'].includes(extension)) return 'video';
  if (['md', 'markdown'].includes(extension)) return 'markdown';
  return null;
}

export function formatBytes(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}
export function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}
