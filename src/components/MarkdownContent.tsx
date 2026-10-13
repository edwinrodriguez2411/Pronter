import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { t, useLocale } from '../i18n';

export default function MarkdownContent({ text }: { text: string }) {
  useLocale();
  return <article className="markdown-content"><Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} skipHtml
    urlTransform={(url) => /^(data:image\/(png|jpeg|webp|gif);base64,|blob:|#)/i.test(url) ? url : ''}
    components={{ a: ({ children }) => <span className="document-link">{children}</span>, img: ({ src, alt }) => src ? <img src={src} alt={alt || ''} /> : <span className="missing-image">{alt || t('Imagen externa no incluida')}</span> }}
  >{text}</Markdown></article>;
}
