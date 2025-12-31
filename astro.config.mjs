import { defineConfig } from 'astro/config';
import { setDefaultResultOrder } from 'node:dns';
import sitemap from '@astrojs/sitemap';

setDefaultResultOrder('ipv4first');

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://queensautoserviceselgin.com',
  integrations: [
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
  vite: {
    plugins: [tailwindcss()],
    server: {
      /*
      host: '127.0.0.1',
      */
      proxy: {
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