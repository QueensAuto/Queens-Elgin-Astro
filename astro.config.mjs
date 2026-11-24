import { defineConfig } from 'astro/config';
import { setDefaultResultOrder } from 'node:dns';
import sitemap from '@astrojs/sitemap';
import agentMarkdown from './src/integrations/agent-markdown/index.mjs';
import trailingSlash from './src/integrations/trailing-slash/index.mjs';

setDefaultResultOrder('ipv4first');

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://queensautoserviceselgin.com',
  integrations: [
    // Runs first so the markdown twins get the slashed links too.
    trailingSlash(),
    // Writes a markdown twin (index.md) next to every built page for AI
    // agents; functions/_middleware.ts serves it on Accept: text/markdown.
    agentMarkdown({
      exclude: [/^\/customer-details/, /^\/schedule-/, /^\/thank-you/]
    }),
    sitemap({
      filter: (page) =>
        !page.includes('/customer-details') &&
        !page.includes('/schedule-') &&
        !page.includes('/thank-you') &&
        !page.includes('/404')
    })
  ],
  devToolbar: {
    enabled: false
  },
  build: {
    // Inline page CSS into the HTML so the first paint doesn't wait on
    // separate render-blocking stylesheet requests.
    inlineStylesheets: 'always'
  },
  vite: {
    plugins: [tailwindcss()],
    server: {
      /*
      host: '127.0.0.1',
      */
      proxy: {
        // Booking Pages Functions in local dev (`npm run worker:dev`, port 8799).
        // Cloudflare Pages serves these routes in production.
        '/api/booking': {
          target: 'http://127.0.0.1:8799',
          changeOrigin: true
        },
        '/api/webhook': {
          target: 'https://n8n.queensautoservices.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/webhook/, '')
        }
      },
      // Fix MIME types for video files in Edge
      headers: {
        '*.mp4': {
          'Content-Type': 'video/mp4'
        },
        '*.webm': {
          'Content-Type': 'video/webm'
        }
      }
    },
    // Ensure proper MIME type association
    assetsInclude: ['**/*.mp4', '**/*.webm']
  }
});
