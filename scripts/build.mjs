import { build } from 'esbuild';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const single = process.argv.includes('--single');
const outDir = path.join(root, single ? 'dist-single' : 'dist');
const tmpDir = path.join(root, '.build');

/** 浏览器端：TS + 字体（woff2 直接变 data URI，产物离线可用） */
const browserConfig = (outfile) => ({
  entryPoints: [path.join(root, 'src/main.ts')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  sourcemap: false,
  outfile,
  loader: { '.woff2': 'dataurl' },
  logLevel: 'warning',
});

async function main() {
  await rm(tmpDir, { recursive: true, force: true });
  await mkdir(tmpDir, { recursive: true });
  await mkdir(outDir, { recursive: true });

  const jsPath = path.join(tmpDir, 'app.js');
  const cssPath = path.join(tmpDir, 'style.css');
  await build(browserConfig(jsPath));
  await build({
    entryPoints: [path.join(root, 'src/style.css')],
    bundle: true,
    minify: true,
    outfile: cssPath,
    loader: { '.woff2': 'dataurl' },
    logLevel: 'warning',
  });

  const js = await readFile(jsPath, 'utf8');
  const css = await readFile(cssPath, 'utf8');
  const html = await readFile(path.join(root, 'index.html'), 'utf8');

  if (single) {
    // 单文件版：样式与脚本全部内联，双击即可打开
    const out = html
      .replace('<link rel="stylesheet" href="./src/style.css" />', `<style>\n${css}\n</style>`)
      .replace(
        '<script type="module" src="./src/main.ts"></script>',
        `<script type="module">\n${js}\n</script>`,
      );
    await writeFile(path.join(outDir, '签名生成器.html'), out, 'utf8');
  } else {
    await writeFile(path.join(outDir, 'app.js'), js, 'utf8');
    await writeFile(path.join(outDir, 'style.css'), css, 'utf8');
    const out = html
      .replace('<link rel="stylesheet" href="./src/style.css" />', '<link rel="stylesheet" href="./style.css" />')
      .replace('<script type="module" src="./src/main.ts"></script>', '<script type="module" src="./app.js"></script>');
    await writeFile(path.join(outDir, 'index.html'), out, 'utf8');
  }

  const size = (Buffer.byteLength(js) + Buffer.byteLength(css)) / 1024;
  console.log(`built ${single ? 'dist-single/签名生成器.html' : 'dist/'} · ${size.toFixed(1)}KB (js+css, 字体已内联)`);
}

await main();

