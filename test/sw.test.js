import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
const list = JSON.parse(`[${/const PRECACHE = \[([\s\S]*?)\];/.exec(sw)[1].replace(/'/g, '"').replace(/,\s*$/, '')}]`);

const walk = (dir) => readdirSync(join(ROOT, dir), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));

test('service worker guarda todos os arquivos do app (para funcionar offline)', () => {
  const needed = [...walk('app'), ...walk('src/core'), 'index.html', 'manifest.webmanifest'];
  const missing = needed.filter((f) => !list.includes(f));
  assert.deepEqual(missing, [], `faltam no PRECACHE de sw.js: ${missing.join(', ')}`);
});

test('todos os arquivos da lista do service worker existem', () => {
  const absent = list.filter((f) => f !== './' && !existsSync(join(ROOT, f)));
  assert.deepEqual(absent, []);
});

test('manifesto aponta para ícones existentes', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.webmanifest'), 'utf8'));
  for (const icon of manifest.icons) assert.ok(existsSync(join(ROOT, icon.src)), icon.src);
});
