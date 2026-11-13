import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plan, readEnv } from '../src/cli/publicar.js';

const MZK = fileURLToPath(new URL('../mzk', import.meta.url));

test('plano: só sobe o que é novo ou foi polido, e respeita a grafia da rádio', () => {
  const locals = [
    { rel: 'Funk/Muzeka - Funk - Nêga Lôra.mp3', full: 'a' },  // polida, já existe na rádio
    { rel: 'Natal/jingle.mp3', full: 'b' },                      // veio da rádio, intocada
    { rel: 'Lo-Fi/Muzeka - Lo-Fi - Nova.mp3', full: 'c' },       // nova
    { rel: 'Samba/Muzeka - Samba - Já Enviada.mp3', full: 'd' }, // polida e já enviada
  ];
  const remote = ['Funk/Muzeka - Funk - Ne\u0302ga Lo\u0302ra.mp3', 'Natal/jingle.mp3', 'Samba/Muzeka - Samba - Já Enviada.mp3'];
  const manifest = { 'Samba/Muzeka - Samba - Já Enviada.mp3': 'hd' };
  const todo = plan(locals, remote, manifest, { polished: (f) => f !== 'b', hash: (f) => `h${f}` });
  assert.deepEqual(todo.map((t) => [t.path, t.replace]), [
    ['Funk/Muzeka - Funk - Ne\u0302ga Lo\u0302ra.mp3', true],
    ['Lo-Fi/Muzeka - Lo-Fi - Nova.mp3', false],
  ]);
});

test('readEnv lê o formato do assistente', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mzk-env-'));
  writeFileSync(join(dir, 'a.env'), "AZURACAST_URL='https://x'\nAZURACAST_API_KEY='ab'\\''c'\n");
  assert.deepEqual(readEnv(join(dir, 'a.env')), { AZURACAST_URL: 'https://x', AZURACAST_API_KEY: "ab'c" });
  rmSync(dir, { recursive: true });
});

test('publicar --sim envia ao AzuraCast (falso) e não reenvia na segunda vez', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mzk-pub-'));
  const radio = join(dir, 'radio');
  mkdirSync(join(radio, 'Lounge'), { recursive: true });
  writeFileSync(join(radio, 'Lounge', 'Muzeka - Lounge - Nova.mp3'), 'audio-falso');
  const cfgDir = join(dir, 'cfg');
  mkdirSync(cfgDir);
  const uploads = [];
  const server = createServer((req, res) => {
    if (req.headers['x-api-key'] !== 'chave') { res.writeHead(403).end('{}'); return; }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (req.method === 'GET') res.end(JSON.stringify([{ path: 'Natal/x.mp3' }]));
      else { uploads.push(JSON.parse(body)); res.end('{}'); }
    });
  });
  await new Promise((r) => server.listen(0, r));
  writeFileSync(join(cfgDir, 'azuracast.env'), `AZURACAST_URL='http://127.0.0.1:${server.address().port}'\nAZURACAST_STATION='1'\nAZURACAST_API_KEY='chave'\n`);
  const env = { ...process.env, MZK_RADIO: radio, MZK_CONFIG_DIR: cfgDir };
  const run = () => new Promise((resolve) => {
    const p = spawn(MZK, ['publicar', '--sim'], { env });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('close', (code) => resolve({ code, out }));
  });
  try {
    const first = await run();
    assert.equal(first.code, 0, first.out);
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].path, 'Lounge/Muzeka - Lounge - Nova.mp3');
    assert.equal(Buffer.from(uploads[0].file, 'base64').toString(), 'audio-falso');
    assert.ok(JSON.parse(readFileSync(join(cfgDir, 'publicados.json'), 'utf8'))['Lounge/Muzeka - Lounge - Nova.mp3']);
    const second = await run();
    assert.match(second.out, /Nada novo/);
    assert.equal(uploads.length, 1);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
