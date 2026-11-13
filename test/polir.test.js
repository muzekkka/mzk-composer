import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const POLIR = fileURLToPath(new URL('../scripts/polir.py', import.meta.url));
const has = (cmd, args) => !spawnSync(cmd, args).error;
const ready = has('ffmpeg', ['-version']) && spawnSync('python3', ['-c', 'import numpy']).status === 0;

test('polir: segura o agudo que cresce no fim e guarda o original', { skip: !ready && 'sem ffmpeg/numpy' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'mzk-polir-'));
  try {
    // 40 s: tom grave constante + chiado agudo (7–14 kHz) que fica 8 dB mais forte na segunda metade.
    const src = join(dir, 'Muzeka - Teste - Faixa.mp3');
    const gen = spawnSync('ffmpeg', ['-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'sine=f=220:d=40',
      '-f', 'lavfi', '-i', 'anoisesrc=d=40:c=white:a=0.05',
      '-filter_complex', "[1]highpass=f=7000,lowpass=f=14000,volume='if(lt(t,20),1,2.5)':eval=frame[h];[0][h]amix=inputs=2:normalize=0",
      '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '320k', src]);
    assert.equal(gen.status, 0, gen.stderr?.toString());
    const radio = join(dir, 'radio');
    const orig = join(dir, 'orig');
    const r = spawnSync('python3', [POLIR, src, '--radio', radio, '--originais', orig, '--json'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const rep = JSON.parse(r.stdout);
    assert.ok(existsSync(join(orig, 'Teste', 'Muzeka - Teste - Faixa.mp3')));
    assert.ok(existsSync(join(radio, 'Teste', 'Muzeka - Teste - Faixa.mp3')));
    const rise = (rows) => rows.at(-1).sibil - rows[0].sibil;
    assert.ok(rise(rep.antes) > 4, `subida antes: ${rise(rep.antes)}`);
    assert.ok(rise(rep.depois) < rise(rep.antes) - 3, `antes ${rise(rep.antes)} depois ${rise(rep.depois)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('polir: faixa já na pasta da rádio fica na própria pasta, mesmo se o nome diz outro gênero', { skip: !ready && 'sem ffmpeg/numpy' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'mzk-polir-'));
  try {
    const radio = join(dir, 'radio');
    const orig = join(dir, 'orig');
    const home = join(radio, 'Lounge');
    spawnSync('mkdir', ['-p', home]);
    const src = join(home, 'Muzeka - R&B - Faixa.mp3');
    const gen = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=220:d=8', '-ac', '2', '-c:a', 'libmp3lame', src]);
    assert.equal(gen.status, 0);
    const r = spawnSync('python3', [POLIR, src, '--radio', radio, '--originais', orig, '--json'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(orig, 'Lounge', 'Muzeka - R&B - Faixa.mp3')));
    assert.ok(!existsSync(join(radio, 'R&B')));
    assert.equal(JSON.parse(r.stdout).file, src);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
