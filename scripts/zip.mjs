import archiver from 'archiver';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';

mkdirSync('release', { recursive: true });
for (const target of ['chrome', 'firefox', 'web']) {
  const dir = `dist/${target}`;
  if (!existsSync(dir)) throw new Error(`Missing ${dir}; run npm run build first`);
  await new Promise((res, rej) => {
    const out = createWriteStream(`release/famabria-${target}.zip`);
    const zip = archiver('zip', { zlib: { level: 9 } });
    out.on('close', res); zip.on('error', rej);
    zip.pipe(out); zip.directory(dir, false); zip.finalize();
  });
  console.log(`release/famabria-${target}.zip`);
}

// Source package: Mozilla's reviewers ask for the source of any bundled/minified add-on.
await new Promise((res, rej) => {
  const out = createWriteStream('release/famabria-source.zip');
  const zip = archiver('zip', { zlib: { level: 9 } });
  out.on('close', res); zip.on('error', rej);
  zip.pipe(out);
  zip.glob('**/*', { ignore: ['node_modules/**', 'dist/**', 'release/**', 'docs/store-screenshots/**', '.git/**'] });
  zip.finalize();
});
console.log('release/famabria-source.zip');
