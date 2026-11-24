// Pure helpers: HTML page -> agent-friendly markdown, and URL path -> markdown path.
import { parse } from 'node-html-parser';
import TurndownService from 'turndown';

export const DEFAULTS = {
  contentSelector: 'main',
  includeSelector: '[data-md-include]',
  skipSelector: '[data-md-skip]',
  removeTags: ['script', 'style', 'noscript', 'iframe', 'svg', 'form', 'button', 'template', 'video', 'audio', 'canvas'],
};

/**
 * Map a page's URL path to the path of its markdown twin.
 *   directory format: "/"  -> "/index.md", "/about/" or "/about" -> "/about/index.md"
 *   file format:      "/"  -> "/index.md", "/about" or "/about.html" -> "/about.md"
 */
export function markdownPathFor(pathname, format = 'directory') {
  let p = pathname.replace(/\.html$/, '').replace(/\/index$/, '/');
  if (p === '' || p === '/') return '/index.md';
  p = p.replace(/\/+$/, '');
  return format === 'file' ? `${p}.md` : `${p}/index.md`;
}

function makeTurndown(removeTags) {
  const td = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
  });
  td.remove(removeTags);
  // FAQ accordions: <details><summary>Question</summary>Answer</details> -> bold question.
  td.addRule('summary', {
    filter: 'summary',
    replacement: (content) => {
      const text = content.trim();
      if (!text) return '';
      // A heading inside <summary> is already marked up: "### Question", not "**### Question**".
      return /^#{1,6} /.test(text) ? `\n\n${text}\n\n` : `\n\n**${text}**\n\n`;
    },
  });
  return td;
}

const yamlString = (s) => JSON.stringify(s ?? ''); // JSON strings are valid YAML scalars

/**
 * Convert one built HTML page to markdown.
 * @param {string} html  full HTML document
 * @param {object} opts
 * @param {string} opts.url  absolute URL of the page (used for frontmatter and resolving links)
 * @returns {{ markdown: string, title: string, description: string, skipped?: string }}
 */
export function htmlToAgentMarkdown(html, opts) {
  const o = { ...DEFAULTS, ...opts };
  const doc = parse(html, { comment: false });

  const robots = doc.querySelector('meta[name="robots"]')?.getAttribute('content') || '';
  if (/noindex/i.test(robots)) return { markdown: '', title: '', description: '', skipped: 'noindex' };

  const title = doc.querySelector('title')?.text.trim() || '';
  const description = doc.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() || '';
  const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute('href') || o.url;

  const main = doc.querySelector(o.contentSelector) || doc.querySelector('body') || doc;
  const extras = doc.querySelectorAll(o.includeSelector).filter((el) => !isInside(el, main));
  const parts = [main, ...extras];

  for (const root of parts) {
    root.querySelectorAll(o.skipSelector).forEach((el) => el.remove());
    root.querySelectorAll('[aria-hidden="true"], [hidden]').forEach((el) => el.remove());
    // <address> children are separate lines (phone, street, hours) even when they are inline spans.
    for (const addr of [root, ...root.querySelectorAll('address')].filter((el) => el.rawTagName?.toLowerCase() === 'address')) {
      const kids = addr.childNodes.filter((n) => n.nodeType === 1);
      kids.slice(0, -1).forEach((k) => {
        if (k.nextElementSibling?.rawTagName?.toLowerCase() !== 'br') k.insertAdjacentHTML('afterend', '<br>');
      });
    }
    // Card links (<a> wrapping an image, heading and blurb) make broken markdown: "[\n\n### Title\n\n](url)".
    // Unwrap them and put the link on the card's heading instead (or on a trailing line if it has none).
    root.querySelectorAll('a[href]').forEach((a) => {
      if (!a.querySelector('h1, h2, h3, h4, h5, h6, p, div, ul, ol, li, figure, section, article, blockquote')) return;
      const href = a.getAttribute('href');
      const heading = a.querySelector('h1, h2, h3, h4, h5, h6');
      if (heading) heading.set_content(`<a href="${href}">${heading.innerHTML}</a>`);
      a.replaceWith(`<div>${a.innerHTML}${heading ? '' : `<p><a href="${href}">${href}</a></p>`}</div>`);
    });
    // Inline siblings that CSS lays out as separate lines (card title + blurb, photo + caption)
    // would otherwise be glued together: "Tile ServicesCustom shower…". Separate them.
    const INLINE = new Set(['span', 'a', 'img', 'small', 'strong', 'em', 'b', 'i', 'time']);
    root.querySelectorAll('span, a, img, small, strong, em, b, i, time').forEach((el) => {
      const next = el.nextSibling;
      if (!next || next.nodeType !== 1 || !INLINE.has(next.rawTagName?.toLowerCase())) return;
      if (el.closest?.('address')) return;
      const tag = el.rawTagName.toLowerCase();
      if (tag === 'img' || (!el.text.trim() && el.querySelector('img'))) return el.insertAdjacentHTML('afterend', ' ');
      if (el.text.trim().length >= 3 && next.text.trim().length >= 3) el.insertAdjacentHTML('afterend', ' — ');
    });
    // Decorative images (no alt) add nothing for an agent.
    root.querySelectorAll('img').forEach((img) => {
      if (!img.getAttribute('alt')?.trim()) img.remove();
    });
    // Absolute URLs so the markdown works out of context.
    for (const [sel, attr] of [['a[href]', 'href'], ['img[src]', 'src']]) {
      root.querySelectorAll(sel).forEach((el) => {
        const v = el.getAttribute(attr);
        if (!v || /^(#|tel:|mailto:|javascript:|data:)/i.test(v)) return;
        try {
          el.setAttribute(attr, new URL(v, o.url).href);
        } catch {}
      });
    }
  }

  const td = makeTurndown(o.removeTags);
  const body = parts
    .map((el) => td.turndown(el.innerHTML).trim())
    .filter(Boolean)
    .join('\n\n---\n\n')
    .replace(/^(\s*)(-|\d+\.)\s{2,}/gm, '$1$2 ') // "-   item" -> "- item"
    .replace(/\n{3,}/g, '\n\n');

  const front = ['---', `title: ${yamlString(title)}`];
  if (description) front.push(`description: ${yamlString(description)}`);
  front.push(`url: ${canonical}`, '---', '');

  return { markdown: `${front.join('\n')}\n${body}\n`, title, description };
}

function isInside(el, ancestor) {
  for (let n = el.parentNode; n; n = n.parentNode) if (n === ancestor) return true;
  return false;
}
