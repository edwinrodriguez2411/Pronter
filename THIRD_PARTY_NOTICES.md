# Componentes de terceros

Las versiones exactas y dependencias transitivas figuran en `package-lock.json`. No se ha modificado el código de los paquetes instalados. La aplicación carga los motores como módulos o Workers independientes.

| Componente | Versión | Licencia declarada / origen |
|---|---|---|
| React y React DOM | 19.3.0 | MIT · https://github.com/facebook/react |
| Socket.IO y socket.io-client | 4.8.4 | MIT · https://github.com/socketio/socket.io |
| Express | 5.2.1 | MIT · https://github.com/expressjs/express |
| PDF.js / pdfjs-dist | 6.4.299 | Apache-2.0 · https://github.com/mozilla/pdf.js |
| @web-ppt/core y viewer-core | 0.4.5 | MIT · https://github.com/unStone/web-ppt |
| @ffmpeg/ffmpeg | 0.12.15 | MIT · https://github.com/ffmpegwasm/ffmpeg.wasm |
| @ffmpeg/core | 0.12.10 | GPL-2.0-or-later · https://github.com/ffmpegwasm/ffmpeg.wasm/tree/n0.12.10 |
| libheif-js / libheif | 1.23.5 | LGPL-3.0 · https://github.com/catdad-experiments/libheif-js · https://github.com/strukturag/libheif |
| DOMPurify | 3.4.16 | Apache-2.0 OR MPL-2.0 · https://github.com/cure53/DOMPurify |
| React Markdown / remark-gfm / rehype-sanitize | 10.1.0 / 4.0.1 / 6.0.0 | MIT · https://github.com/remarkjs/react-markdown |
| qrcode.react | 4.2.0 | ISC · https://github.com/zpao/qrcode.react |
| Lucide | 1.53.0 | ISC · https://github.com/lucide-icons/lucide |
| Bricolage Grotesque y DM Sans, via Fontsource | 5.3.0 | SIL Open Font License 1.1 · https://fontsource.org |

Los textos de licencia disponibles en los paquetes del frontend se copian a `/vendor/licenses/` al compilar, junto con este aviso. El código fuente del motor FFmpeg WASM y sus recetas de compilación se encuentran en su repositorio y versión enlazados; sus componentes conservan sus propias licencias. El motor de conversión y libheif se distribuyen sin modificaciones. No se debe retirar sus avisos ni sus enlaces de fuentes al redistribuirlos.

Los ejemplos externos HEIC/PPT usados en pruebas opcionales no forman parte del despliegue. Los archivos AVI/MP4 incluidos en pruebas son gráficos sintéticos creados por `scripts/create-test-media.mjs`.
