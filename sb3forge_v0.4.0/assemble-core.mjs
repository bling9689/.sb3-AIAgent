import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const sourceDirectory = resolve(root, 'core-source');
const names = Array.from(
  { length: 5 },
  (_, index) => `sb3core.mjs.gz.b64part-${String(index).padStart(2, '0')}`
);
const encoded = names
  .map((name) => readFileSync(resolve(sourceDirectory, name), 'utf8').trim())
  .join('');
const source = gunzipSync(Buffer.from(encoded, 'base64'));
writeFileSync(resolve(root, 'sb3core.mjs'), source);
console.log(`Restored sb3core.mjs (${source.length} bytes)`);
