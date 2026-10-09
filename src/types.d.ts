declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  interface HeifImage {
    get_width(): number;
    get_height(): number;
    display(data: ImageData, callback: (result: ImageData | null) => void): void;
  }
  const libheif: () => Promise<{ HeifDecoder: new () => { decode(bytes: Uint8Array): HeifImage[] } }>;
  export default libheif;
}
