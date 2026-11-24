// Cloudflare Pages Function middleware for a static Astro site.
// From astro-agent-markdown (copied into src/integrations/agent-markdown).
// public/_routes.json keeps static assets from invoking this function.
// On a paid Cloudflare plan you can instead turn on the built-in "Markdown for Agents"
// setting, but that converts the whole page (nav, footer, popups); this serves the clean twin.
//
// - Requests with `Accept: text/markdown` get the page's markdown twin.
// - Direct .md requests get the right Content-Type and stay out of Google's index.
// - Normal HTML pages get `Link: <...>; rel="alternate"; type="text/markdown"` and `Vary: Accept`.

// Must match `build.format` in astro.config ('directory' is Astro's default).
const FORMAT: 'directory' | 'file' = 'directory';

const MD_HEADERS: Record<string, string> = {
  'Content-Type': 'text/markdown; charset=utf-8',
  'X-Robots-Tag': 'noindex',
  Vary: 'Accept',
};

interface Ctx {
  request: Request;
  next: () => Promise<Response>;
  env: { ASSETS: { fetch: (req: Request | URL | string) => Promise<Response> } };
}

export function markdownPathFor(pathname: string, format = FORMAT): string {
  let p = pathname.replace(/\.html$/, '').replace(/\/index$/, '/');
  if (p === '' || p === '/') return '/index.md';
  p = p.replace(/\/+$/, '');
  return format === 'file' ? `${p}.md` : `${p}/index.md`;
}

function withHeaders(res: Response, headers: Record<string, string>): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  return out;
}

export const onRequest = async ({ request, next, env }: Ctx): Promise<Response> => {
  const url = new URL(request.url);
  const { pathname } = url;

  if (pathname.endsWith('.md')) return withHeaders(await next(), MD_HEADERS);

  const last = pathname.split('/').pop() || '';
  const isPage = !last.includes('.') || last.endsWith('.html');
  if (!isPage || pathname.startsWith('/_astro/')) return next();

  const mdPath = markdownPathFor(pathname);
  if (request.headers.get('accept')?.toLowerCase().includes('text/markdown')) {
    url.pathname = mdPath;
    const md = await env.ASSETS.fetch(new Request(url));
    if (md.ok) return withHeaders(md, MD_HEADERS);
    // No markdown twin for this URL: fall through to the normal page.
  }

  const res = await next();
  if (!(res.headers.get('content-type') || '').includes('text/html')) return res;
  return withHeaders(res, {
    Vary: 'Accept',
    Link: `<${mdPath}>; rel="alternate"; type="text/markdown", </llms.txt>; rel="describedby"; type="text/markdown"`,
  });
};
