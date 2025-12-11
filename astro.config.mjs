import { defineConfig } from 'astro/config';
import { setDefaultResultOrder } from 'node:dns';
import sitemap from '@astrojs/sitemap';

setDefaultResultOrder('ipv4first');

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://queensmobiletires.com',
  integrations: [sitemap()],
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
      }
    }
  }
});