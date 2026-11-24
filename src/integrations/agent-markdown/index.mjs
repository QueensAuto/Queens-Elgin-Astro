// Astro integration: after `astro build`, write a markdown twin next to every HTML page.
import { readdir, readFile, writeFile, access } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { htmlToAgentMarkdown, markdownPathFor } from './convert.mjs';

export { htmlToAgentMarkdown, markdownPathFor } from './convert.mjs';

async function* walkHtml(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '_astro') yield* walkHtml(p);
    } else if (entry.name.endsWith('.html')) {
      yield p;
    }
  }
}

const exists = (p) => access(p).then(() => true, () => false);

/** Turn "about/index.html" into "/about/" and "about.html" into "/about". */
export function filePathToPathname(rel) {
  const p = '/' + rel.split(sep).join('/');
  if (p.endsWith('/index.html')) return p.slice(0, -'index.html'.length);
  return p.replace(/\.html$/, '');
}

/**
 * @param {object} [options]
 * @param {string} [options.site]             Absolute site URL. Defaults to `site` in astro.config.
 * @param {string} [options.contentSelector]  Main content element. Default "main" (falls back to <body>).
 * @param {string} [options.includeSelector]  Extra blocks outside main to append (e.g. footer NAP). Default "[data-md-include]".
 * @param {string} [options.skipSelector]     Blocks to drop. Default "[data-md-skip]".
 * @param {(string|RegExp)[]} [options.exclude] Pathnames to skip. 404/500 pages are always skipped.
 * @param {boolean|object} [options.llmsTxt]  Also write /llms.txt listing every page. `{ title, description }` to override the header.
 */
export default function agentMarkdown(options = {}) {
  let site = options.site;
  let format = 'directory';

  return {
    name: 'astro-agent-markdown',
    hooks: {
      'astro:config:done': ({ config, logger }) => {
        site ??= config.site;
        format = config.build?.format === 'file' ? 'file' : 'directory';
        if (!site) logger.warn('No `site` set in astro.config or options; links in markdown will stay relative to https://example.com.');
      },

      'astro:build:done': async ({ dir, logger }) => {
        const root = fileURLToPath(dir);
        const base = site || 'https://example.com';
        const exclude = options.exclude || [];
        const isExcluded = (pathname) =>
          /^\/(404|500)\/?$/.test(pathname) ||
          exclude.some((e) => (e instanceof RegExp ? e.test(pathname) : e === pathname));

        const pages = [];
        for await (const file of walkHtml(root)) {
          const pathname = filePathToPathname(relative(root, file));
          if (isExcluded(pathname)) continue;

          const url = new URL(pathname, base).href;
          const result = htmlToAgentMarkdown(await readFile(file, 'utf8'), { ...options, url });
          if (result.skipped) {
            logger.debug?.(`skip ${pathname} (${result.skipped})`);
            continue;
          }
          const mdFile = file.replace(/\.html$/, '.md');
          await writeFile(mdFile, result.markdown);
          pages.push({ pathname, url, mdUrl: new URL(markdownPathFor(pathname, format), base).href, ...result });
        }
        logger.info(`Wrote ${pages.length} markdown page${pages.length === 1 ? '' : 's'} for agents.`);

        if (options.llmsTxt) await writeLlmsTxt(root, pages, options.llmsTxt, logger);
      },
    },
  };
}

async function writeLlmsTxt(root, pages, cfg, logger) {
  const target = join(root, 'llms.txt');
  if (await exists(target)) {
    logger.warn('llms.txt already exists (probably in public/); leaving it alone.');
    return;
  }
  pages.sort((a, b) => (a.pathname === '/' ? -1 : b.pathname === '/' ? 1 : a.pathname.localeCompare(b.pathname)));
  const home = pages.find((p) => p.pathname === '/');
  const title = (typeof cfg === 'object' && cfg.title) || home?.title || 'Website';
  const description = (typeof cfg === 'object' && cfg.description) || home?.description || '';
  const lines = [`# ${title}`, ''];
  if (description) lines.push(`> ${description}`, '');
  lines.push('## Pages', '');
  for (const p of pages) lines.push(`- [${p.title || p.pathname}](${p.mdUrl})${p.description ? `: ${p.description}` : ''}`);
  await writeFile(target, lines.join('\n') + '\n');
  logger.info('Wrote llms.txt.');
}
