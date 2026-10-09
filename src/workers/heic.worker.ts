import libheif from 'libheif-js/libheif-wasm/libheif-bundle.mjs';
const runtime = libheif();

self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    const decoder = new (await runtime).HeifDecoder();
    const images = decoder.decode(new Uint8Array(event.data));
    const image = images[0];
    if (!image) throw new Error('La imagen HEIC está dañada o no se puede decodificar.');
    const width = image.get_width();
    const height = image.get_height();
    if (width * height > 50_000_000) throw new Error('La imagen supera los 50 megapíxeles del visor.');
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d')!;
    const pixels = context.createImageData(width, height);
    await new Promise<void>((resolve, reject) => image.display(pixels, (result: ImageData | null) => {
      if (!result) reject(new Error('No se pudo decodificar la imagen HEIC.'));
      else { context.putImageData(result, 0, 0); resolve(); }
    }));
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    self.postMessage({ bytes }, { transfer: [bytes.buffer] });
  } catch (error) { self.postMessage({ error: (error as Error).message }); }
};
