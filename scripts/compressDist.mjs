// Writes .br and .gz siblings for text assets in dist/ so the server can send
// them without compressing on every request.
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const compressible = /\.(js|css|svg|html|json|txt)$/;

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (compressible.test(entry.name)) yield full;
  }
}

let before = 0, after = 0, count = 0;
for await (const file of walk(dist)) {
  const { size } = await stat(file);
  if (size < 1024) continue;
  const data = await readFile(file);
  const br = zlib.brotliCompressSync(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: size } });
  await writeFile(`${file}.br`, br);
  await writeFile(`${file}.gz`, zlib.gzipSync(data, { level: 9 }));
  before += size; after += br.length; count++;
}
console.log(`compressDist: ${count} files, ${(before / 1024).toFixed(0)} KB → ${(after / 1024).toFixed(0)} KB (brotli)`);
