import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { slugify } from '../../../server/src/slug.ts';

marked.setOptions({ gfm: true, breaks: true });

// Links to other sites open in a new tab.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && /^https?:\/\//.test(node.getAttribute('href') ?? '')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

/**
 * Markdown to safe HTML. [[Page title]] and [[Page title|label]] link to wiki pages;
 * links to pages that don't exist yet get the "missing" class.
 */
export function renderMarkdown(src: string, existing?: Set<string>): string {
  const withLinks = src.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, title: string, label?: string) => {
    const slug = slugify(title.trim());
    const text = (label ?? title).trim().replace(/[[\]]/g, '');
    const missing = existing && !existing.has(slug);
    return missing ? `<a href="/wiki/new?title=${encodeURIComponent(title.trim())}" class="missing">${text}</a>` : `[${text}](/wiki/${slug})`;
  });
  return DOMPurify.sanitize(marked.parse(withLinks, { async: false }));
}
