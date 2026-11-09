// Copies the built web app (dist/web) into the Android project assets: android/app/src/main/assets/app
// Run after `npm run build:web`.
import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
const src = 'dist/web', dst = 'android/app/src/main/assets/app';
if (!existsSync(src)) { console.error('dist/web not found: run "npm run build:web" first'); process.exit(1); }
rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
console.log('copied', src, '->', dst);
