import { defineConfig, type Plugin } from 'vite'
import { resolve } from 'node:path'

/**
 * Vite stamps `crossorigin` on the emitted <script> and <link rel=stylesheet>.
 * Every asset here is same-origin, so it buys nothing — but it does make the
 * browser send an `Origin` header, and Cloudflare Pages answers that CORS
 * variant with the SPA fallback HTML instead of the file. Dropping the
 * attribute keeps the request simple and the response correct.
 */
function noCrossorigin(): Plugin {
  return {
    name: 'no-crossorigin-on-same-origin-assets',
    enforce: 'post',
    transformIndexHtml(html) {
      return html.replace(/\s+crossorigin(=("|')[^"']*\2)?/g, '')
    },
  }
}

export default defineConfig({
  plugins: [noCrossorigin()],
  // Vercel sets VERCEL=1 in its build environment. Analytics posts to
  // /_vercel/insights, which only exists there — anywhere else (local, CI,
  // Cloudflare Pages) it 404s and logs a console error.
  define: { __ON_VERCEL__: JSON.stringify(process.env.VERCEL === '1') },
  server: { port: 5180, open: false },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
})
