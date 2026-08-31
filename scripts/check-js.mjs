// ============================================================
// scripts/check-js.mjs
// ------------------------------------------------------------
// Слой 1: проверка JS-синтаксиса без выполнения.
//   1) все js/**/*.js (и .mjs) → node --check
//   2) inline <script> в *.html (без src, type=js|module|пусто)
//      → сохраняем во временный файл, node --check
// Ошибки печатаются с путём и приблизительной строкой в HTML.
// exit 1 если хоть одна.
// ============================================================
import { spawnSync } from 'node:child_process';
import {
  readFileSync, readdirSync, statSync, writeFileSync,
  mkdtempSync, rmSync
} from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';

const root = process.cwd();

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.git')) continue;
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const allFiles = walk(root);
const jsFiles = allFiles.filter(f => /\.(m?js)$/.test(f));
const htmlFiles = allFiles.filter(f => f.endsWith('.html'));

let errors = 0;
const nodeBin = process.execPath;

function runCheck(file) {
  return spawnSync(nodeBin, ['--check', file], { encoding: 'utf8' });
}
// Пытается как CJS; при синтаксической ошибке из-за import/export —
// перепробовать файл как ESM (копия в .mjs во временную папку).
const tmpForEsm = mkdtempSync(join(tmpdir(), 'cfd-js-esm-'));
let esmIdx = 0;
function runCheckAuto(file) {
  const r = runCheck(file);
  if (r.status === 0) return r;
  const stderr = r.stderr || '';
  if (/Unexpected token '(export|import)'/.test(stderr)
      || /Cannot use import statement outside a module/.test(stderr)) {
    const asMjs = join(tmpForEsm, 'as-esm-' + (esmIdx++) + '.mjs');
    writeFileSync(asMjs, readFileSync(file, 'utf8'));
    return runCheck(asMjs);
  }
  return r;
}

// 1) внешние js
for (const f of jsFiles) {
  const r = runCheckAuto(f);
  if (r.status !== 0) {
    console.error(`✗ JS: ${relative(root, f)}`);
    const msg = (r.stderr || '').trim().split('\n').slice(0, 8).join('\n');
    if (msg) console.error(msg);
    errors++;
  }
}

// 2) inline <script> в html
const tmp = mkdtempSync(join(tmpdir(), 'cfd-js-'));
const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const jsTypes = new Set([
  '', 'text/javascript', 'application/javascript',
  'application/ecmascript', 'text/ecmascript', 'module',
]);
let inlineIdx = 0;

for (const f of htmlFiles) {
  const src = readFileSync(f, 'utf8');
  let m;
  scriptRe.lastIndex = 0;
  while ((m = scriptRe.exec(src)) !== null) {
    const attrs = m[1] || '';
    const body = m[2] || '';
    if (/\bsrc\s*=/.test(attrs)) continue;
    const typeMatch = attrs.match(/\btype\s*=\s*["']([^"']*)["']/i);
    const t = (typeMatch ? typeMatch[1] : '').toLowerCase();
    if (!jsTypes.has(t)) continue;
    if (!body.trim()) continue;
    const isModule = t === 'module';
    const ext = isModule ? '.mjs' : '.js';
    const tmpFile = join(tmp, `inline-${inlineIdx++}${ext}`);
    writeFileSync(tmpFile, body);
    const r = runCheck(tmpFile);
    if (r.status !== 0) {
      const lineInHtml = src.slice(0, m.index).split('\n').length;
      console.error(`✗ inline <script>: ${relative(root, f)}:${lineInHtml}`);
      const msg = (r.stderr || '').trim().split('\n').slice(0, 8).join('\n');
      if (msg) console.error(msg);
      errors++;
    }
  }
}

rmSync(tmp, { recursive: true, force: true });
rmSync(tmpForEsm, { recursive: true, force: true });

if (errors) {
  console.error(`\n${errors} JS syntax error(s).`);
  process.exit(1);
} else {
  console.log(`✓ JS ok (${jsFiles.length} files + inline scripts in ${htmlFiles.length} HTML)`);
}
