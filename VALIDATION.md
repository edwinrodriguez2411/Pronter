# Verificación realizada

Última comprobación: 9 de octubre de 2026. La ejecución completa de Playwright aprobó los once escenarios en 1,7 minutos; la compilación de producción y la comprobación de tipos también pasaron.

- `npm run build`: completado, TypeScript sin errores y compilaciones de frontend/servidor generadas.
- `npm test`: 27 pruebas aprobadas en cuatro archivos; incluye retransmisión de 1.000.000.000 bytes con cuatro fragmentos como máximo pendientes, admisión simultánea, credenciales, caducidad, reserva del selector de archivos, recuperación de canales y generación de identificadores sin `crypto.randomUUID`. El marcador valida coordenadas, secuencias, límites de memoria, aislamiento por página, autorización, cancelación de lotes y cuatro confirmaciones simultáneas después de aceptar el inicio del trazo.
- Playwright / Chromium: once escenarios verificados con contextos independientes y QR decodificado desde la imagen renderizada.
  - Marcador desde el celular con entrada táctil emulada, sin desplazar accidentalmente la página; dibujo directo con ratón en el PC, colores, grosor, deshacer y borrar. Se leen píxeles reales de Canvas para comprobar posición y color después del zoom, desplazamiento y redimensionamiento. Reconexión conserva dibujos y elimina avisos tardíos; un archivo inválido conserva el anterior con sus trazos, el siguiente archivo los borra y salir elimina la capa antes de renovar el QR.
  - Trazos independientes en páginas PDF y diapositivas PPTX; al volver a una página se recuperan y borrar una no afecta a las otras. Markdown conserva la posición de los trazos al desplazar el documento; video y PowerPoint excluyen las bandas vacías al mapear coordenadas.
  - Imagen, láser, zoom, sustitución, conservación del archivo anterior ante error, rechazo de segundo celular y renovación del QR al salir.
  - PDF, PPTX, páginas, vista estática, Markdown GFM sin scripts, audio.
  - Vista pequeña y movimiento reducido.
  - MP4 nativo, conversión AVI con FFmpeg WASM, velocidad, reconexión y nuevo envío tras recuperar la conexión; sin cookies ni almacenamiento web.
  - Decodificación HEIC.
  - PPT antiguo.
  - Avances de animación y URLs de imágenes incrustadas que siguen funcionando después de terminar el Worker.
  - Celular emulado accediendo por HTTP a la IP privada del computador, con `isSecureContext` falso y `crypto.randomUUID` ausente: selección de archivo con página suspendida durante 16 segundos, envío y zoom. Una segunda selección corta ambos sockets durante 22 segundos; el segundo celular sigue rechazado, el archivo elegido espera la reconexión y después se recibe el PDF y se cambia de página.
  - Rechazo temporal de la autenticación del canal de archivos: reintento automático con la misma credencial, envío y cierre.
- Revisión visual de landing a 1440 px, presentación y mando a 375/320 px. Sin desbordamiento horizontal del mando a 320 px. Se añadieron comprobaciones de viewBox, dimensiones y color del SVG para detectar diapositivas presentes en el DOM pero no dibujadas.
- `/api/health`: responde `{ "ok": true }`.
- Preparación para Render Free: compilación aprobada y comprobación local de producción con `RENDER_EXTERNAL_URL`. `/api/config` devuelve el origen HTTPS público aunque Node recibe HTTP interno; los sockets aceptan ese origen y rechazan otro. También se verificó que `PUBLIC_URL` prevalece al configurar un dominio propio. `render.yaml` fija `plan: free` y despliegues manuales. El panel de facturación de “Edwin's workspace” confirma Hobby y ninguna tarjeta registrada. La publicación aún está pendiente de elegir el espacio de trabajo y autenticar GitHub para crear el repositorio privado.
- Las pruebas aceptan `PRONTER_E2E_URL` para verificar un sitio desplegado sin iniciar otro servidor. Tres escenarios locales aprobaron usando esa opción: QR y asociación exclusiva, PDF/PPTX/Markdown/audio y video/conversión/reconexión. Comprueban el dominio codificado en el QR contra `/api/config` y, en HTTPS, contra el dominio abierto.
- Pantalla completa: Chromium entra y sale mediante el botón del computador; se comprueba `document.fullscreenElement`, el texto y estado del botón y el atajo F. Los dibujos se mantienen alineados al cambiar al modo completo. Revisión visual de la barra del PC y del mando con marcador a 390 px; sin desbordamiento del mando a 320 px.

La prueba de corte de red cierra explícitamente ambos extremos de los WebSockets: la emulación de modo sin conexión puede dejar abierto un transporte existente. La comprobación del archivo recibido admite los 30 segundos de espera de conexión de la app y la preparación del PDF. El selector nativo de Android se aproxima suspendiendo la página mediante CDP; esto no sustituye la prueba en un teléfono físico.

HEIC/PPT/animaciones/imágenes incrustadas se probaron con los ejemplos opcionales de los proyectos originales indicados en README. La transferencia de 1 GB se comprobó a nivel de sockets; no demuestra que el navegador pueda decodificar cualquier documento de 1 GB.

Pendiente: teléfono físico, dominio público con HTTPS y construcción del contenedor Docker; Docker no está disponible en este entorno. El despliegue local de producción sí está ejecutándose.
