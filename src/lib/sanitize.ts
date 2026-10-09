import DOMPurify from 'dompurify';

const localResource = /^(blob:|data:(image\/|audio\/|video\/|font\/)|#)/i;
export function sanitizeSvg(svg: string) {
  const clean = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
    ADD_TAGS: ['foreignObject', 'video', 'audio', 'source'],
    HTML_INTEGRATION_POINTS: { foreignobject: true, 'annotation-xml': true },
    // Preserve non-URL SVG values (dimensions, transforms, colors), while allowing local blob assets.
    ALLOWED_URI_REGEXP: /^(?:(?:blob|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
    ADD_ATTR: ['controls', 'playsinline', 'preload'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'link', 'style'],
    ALLOW_DATA_ATTR: true,
  });
  const document = new DOMParser().parseFromString(clean, 'text/html');
  for (const element of document.body.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      if (/^(href|xlink:href|src|poster)$/i.test(attribute.name) && !localResource.test(attribute.value)) element.removeAttribute(attribute.name);
      if (attribute.name === 'srcset') element.removeAttribute(attribute.name);
      if (attribute.name === 'style' && /url\s*\(/i.test(attribute.value)) {
        const matches = attribute.value.matchAll(/url\s*\(\s*['"]?([^)'"\s]+)/gi);
        if ([...matches].some((match) => !localResource.test(match[1]))) element.removeAttribute('style');
      }
    }
  }
  return document.body.innerHTML;
}
