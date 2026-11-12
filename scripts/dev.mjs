import { context } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const outDir = path.join(root, 'dist');
const tmpDir = path.join(root, '.build');
const port = 5173;

await mkdir(outDir, { recursive: true });
await mkdir(tmpDir, { recursive: true });

const loaders = { '.woff2': 'dataurl' };

/** HTML 指向 dev 产物 */
async function writeHtml() {
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  const out = html
    .replace('<link rel="stylesheet" href="./src/style.css" />', '<link rel="stylesheet" href="./style.css" />')
    .replace('<script type="module" src="./src/main.ts"></script>', '<script type="module" src="./app.js"></script>');
  await writeFile(path.join(outDir, 'index.html'), out, 'utf8');
}

const jsCtx = await context({
  entryPoints: [path.join(root, 'src/main.ts')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  outfile: path.join(outDir, 'app.js'),
  loader: loaders,
  logLevel: 'warning',
});

const cssCtx = await context({
  entryPoints: [path.join(root, 'src/style.css')],
  bundle: true,
  outfile: path.join(outDir, 'style.css'),
  loader: loaders,
  logLevel: 'warning',
});

await Promise.all([jsCtx.watch(), cssCtx.watch()]);
await writeHtml();

const server = await jsCtx.serve({ servedir: outDir, port });
console.log(`dev server → http://localhost:${server.port}`);
console.log('改 src/ 下的文件会自动重建，刷新浏览器即可看到。');

