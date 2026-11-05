import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
const APP_VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string;
import { buildManifest } from './scripts/manifest.mjs';

export default defineConfig(({ mode }) => {
  const target = mode === 'firefox' ? 'firefox' : mode === 'web' ? 'web' : 'chrome';
  const web = target === 'web'; // the calendar as a web page served by the home server (phones)
  const test = process.env.FC_TEST === '1'; // dist/chrome-test: extra permission for e2e only
  return {
    base: web ? '/app/' : './',
    publicDir: web ? 'public-web' : 'public',
    define: { __TARGET__: JSON.stringify(target), __APP_VERSION__: JSON.stringify(APP_VERSION) },
    plugins: [
      react(),
      !web && {
        name: 'emit-manifest',
        generateBundle() {
          this.emitFile({ type: 'asset', fileName: 'manifest.json', source: JSON.stringify(buildManifest(target, { test }), null, 2) });
        },
      },
    ],
    build: {
      outDir: test ? 'dist/chrome-test' : `dist/${target}`,
      emptyOutDir: true,
      target: 'es2022',
      sourcemap: false,
      rollupOptions: {
        input: (web ? { app: resolve('app.html') } : { calendar: resolve('calendar.html') }) as Record<string, string>,
        // Extension: stable names. Web app: hashed names so phones never keep serving an old copy after an update.
        output: web
          ? { entryFileNames: 'assets/[name]-[hash].js', chunkFileNames: 'assets/[name]-[hash].js', assetFileNames: 'assets/[name]-[hash][extname]' }
          : { entryFileNames: 'assets/[name].js', chunkFileNames: 'assets/[name].js', assetFileNames: 'assets/[name][extname]' },
      },
    },
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts'],
      fileParallelism: false, // server + sync tests share one test database
      define: { __TARGET__: JSON.stringify('chrome'), __APP_VERSION__: JSON.stringify(APP_VERSION) },
    },
  };
});
