import { parse } from '@web-ppt/core';

// Preserve both PPTX and legacy PPT parsing off the UI thread. Transfer embedded resources
// as bytes because blob URLs created by a terminated Worker cannot be retained by its parent.
self.onmessage = async (event: MessageEvent<{ id: number; bytes: ArrayBuffer }>) => {
  const { id, bytes } = event.data;
  let dispose: (() => void) | undefined;
  try {
    const result = await parse(bytes, { lazy: false });
    dispose = result.dispose;
    const { dispose: _dispose, ...presentation } = result;
    const urls = new Map<string, number>();
    const collect = (value: unknown): unknown => {
      if (typeof value === 'string' && value.startsWith('blob:')) {
        if (!urls.has(value)) urls.set(value, urls.size);
        return `asset:${urls.get(value)}`;
      }
      if (Array.isArray(value)) return value.map(collect);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, collect(item)]));
      return value;
    };
    const data = collect(presentation);
    const assets = await Promise.all([...urls.keys()].map(async (url) => {
      const blob = await (await fetch(url)).blob();
      return { mime: blob.type, data: await blob.arrayBuffer() };
    }));
    self.postMessage({ id, ok: true, presentation: data, assets }, { transfer: assets.map((asset) => asset.data) });
  } catch (error) { self.postMessage({ id, ok: false, error: (error as Error).message }); }
  finally { dispose?.(); }
};
