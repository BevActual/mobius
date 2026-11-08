import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Strict CSP in production builds only. Vite's dev server needs inline scripts for hot reload. */
const productionCsp = (connect = "'self'"): Plugin => ({
  name: 'mobius-csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace(
      '<!--csp-->',
      `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' media: http://media.localhost; connect-src ${connect}; object-src 'none'; base-uri 'none'; form-action 'none'" />`,
    ),
});

export default defineConfig(({ mode }) => {
  // The shell loads the interface from its own folder and lets the page talk to Rust over `ipc:`. Plain `vite` (dev) is for looking at the interface alone.
  const tauri = mode === 'tauri';
  return {
    base: './',
    plugins: [react(), productionCsp(tauri ? "'self' ipc: http://ipc.localhost" : "'self'")],
    build: { outDir: tauri ? 'dist/tauri' : 'dist/renderer', emptyOutDir: true, sourcemap: true, target: tauri ? 'es2022' : 'chrome140' },
    server: { host: '127.0.0.1', port: 5180, strictPort: true },
  };
});
