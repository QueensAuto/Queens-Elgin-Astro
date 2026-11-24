import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Internal links like href="/about" make Cloudflare Pages answer with a
// 308 to "/about/" before the page loads. This adds the slash at build time,
// but only when "/about/" really is a built page (dist/about/index.html), so
// files, API routes and _redirects targets are never touched.
const HREF = /\bhref=(["'])(\/(?!\/)[^"'#?\s]*)([#?][^"']*)?\1/g;

export function addTrailingSlashes(html, isPageDir) {
  return html.replace(HREF, (match, quote, path, rest = '') => {
    if (path.endsWith('/') || !isPageDir(path)) return match;
    return `href=${quote}${path}/${rest}${quote}`;
  });
}

async function htmlFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await htmlFiles(full)));
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

export default function trailingSlash() {
  return {
    name: 'trailing-slash-links',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const root = fileURLToPath(dir);
        const pageDirs = new Map();
        const files = await htmlFiles(root);
        // Collect every built page directory up front (sync lookups below).
        for (const file of files) {
          const rel = file.slice(root.length).replace(/\\/g, '/').replace(/^\/?/, '/');
          if (rel.endsWith('/index.html')) pageDirs.set(decodeURI(rel.slice(0, -'index.html'.length - 1)), true);
        }
        const isPageDir = (path) => {
          let p;
          try { p = decodeURI(path); } catch { return false; }
          return pageDirs.has(p);
        };
        let changed = 0;
        for (const file of files) {
          const html = await readFile(file, 'utf8');
          const next = addTrailingSlashes(html, isPageDir);
          if (next !== html) {
            await writeFile(file, next);
            changed++;
          }
        }
        logger.info(`added trailing slashes to internal links in ${changed} pages`);
      }
    }
  };
}
