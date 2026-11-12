import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildLilypond, splitDuration, chordMarkup, lilyPitch } from '../src/core/lilypond.js';
import { exampleProject } from './helpers/fixtures.js';

test('divisão rítmica legível', () => {
  assert.deepEqual(splitDuration(0, 16, 4), [16]);
  assert.deepEqual(splitDuration(0, 12, 4), [12]);
  assert.deepEqual(splitDuration(6, 10, 4), [2, 8]); // g8~ g2
  assert.deepEqual(splitDuration(2, 4, 4), [4]); // síncope 8 4 8
  assert.deepEqual(splitDuration(6, 4, 4), [2, 2]); // não cruza o meio do 4/4
  assert.deepEqual(splitDuration(4, 6, 4), [6]); // 4 4. 8
  assert.deepEqual(splitDuration(4, 8, 4), [8]); // 4 2 4
  assert.deepEqual(splitDuration(4, 10, 4), [8, 2]);
  assert.deepEqual(splitDuration(2, 8, 4), [4, 2, 2]); // síncope + divisão no meio do compasso
  assert.deepEqual(splitDuration(4, 8, 3), [8]); // 3/4: 4 2
  assert.deepEqual(splitDuration(1, 3, 4), [1, 2]);
  assert.deepEqual(splitDuration(0, 12, 3), [12]);
});

test('alturas LilyPond com grafia da tonalidade', () => {
  const am = { tonic: 'A', mode: 'minor' };
  assert.equal(lilyPitch(60, am), "c'");
  assert.equal(lilyPitch(68, am), "gs'");
  assert.equal(lilyPitch(45, am), 'a,');
  assert.equal(lilyPitch(70, { tonic: 'F', mode: 'major' }), "bf'");
});

test('cifra vira markup com glifos de acidente', () => {
  assert.equal(chordMarkup('N.C.'), '\\markup "N.C."');
  const m = chordMarkup('Bbm7(b5)/Ab');
  assert.match(m, /\\flat/);
  assert.match(m, /\\super/);
  assert.match(m, /"\/"/);
});

test('estrutura: repetição, marcas de ensaio, segunda pauta, cabeçalho', () => {
  const ly = buildLilypond(exampleProject());
  assert.match(ly, /title = "Exemplo de Canção"/);
  assert.match(ly, /composer = "Leo Santos"/);
  assert.match(ly, /copyright = "© 2026 Leo Santos"/);
  assert.match(ly, /\\key a \\minor/);
  assert.match(ly, /meter = .* = 92/);
  assert.equal((ly.match(/\\repeat volta 2/g) || []).length, 3); // lead, lead2, cifras
  assert.equal((ly.match(/\\box "A"/g) || []).length, 2);
  assert.match(ly, /instrumentName = "Sax"/);
});

test('sem Lead2: uma pauta só, sem nome de instrumento', () => {
  const p = exampleProject();
  for (const s of p.sections) s.lead2 = [];
  const ly = buildLilypond(p);
  assert.doesNotMatch(ly, /instrumentName/);
  assert.equal((ly.match(/\\new Staff/g) || []).length, 1);
});

const hasLily = !spawnSync('lilypond', ['--version']).error;

test('compila no LilyPond sem erros', { skip: !hasLily && 'LilyPond não instalado' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'mzk-ly-'));
  try {
    for (const [name, mutate] of [
      ['exemplo', () => {}],
      ['tres-por-quatro', (p) => { p.settings.timeSignature = [3, 4]; for (const s of p.sections) { s.lead = s.lead.filter((n) => n.pos < s.bars * 12).map((n) => ({ ...n, dur: Math.min(n.dur, 3) })); s.lead2 = []; s.chords = s.chords.filter((c) => c.pos < s.bars * 12); s.bass = []; s.drums = []; } }],
      ['bemois', (p) => { p.settings.key = { tonic: 'Eb', mode: 'major' }; p.arrangement = ['a', 'a', 'a']; }],
    ]) {
      const p = exampleProject();
      mutate(p);
      writeFileSync(join(dir, `${name}.ly`), buildLilypond(p));
      const r = spawnSync('lilypond', ['-l', 'WARN', `${name}.ly`], { cwd: dir, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stderr.trim(), '', `avisos do LilyPond em ${name}:\n${r.stderr}`);
      assert.ok(existsSync(join(dir, `${name}.pdf`)));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('partes seguidas com a mesma escrita viram repetição (bateria não conta)', async () => {
  const { leadSheetRuns } = await import('../src/core/lilypond.js');
  const p = exampleProject();
  const a = p.sections.find((s) => s.id === 'a');
  const copy = { ...structuredClone(a), id: 'a2', name: "A'", drums: [] };
  p.sections.push(copy);
  p.arrangement = ['intro', 'a', 'a2', 'a', 'b', 'a2'];
  assert.deepEqual(leadSheetRuns(p).map((r) => [r.section.name, r.count]), [['Intro', 1], ['A', 3], ['B', 1], ["A'", 1]]);
  copy.lead[0].pitch += 1;
  assert.deepEqual(leadSheetRuns(p).map((r) => [r.section.name, r.count]), [['Intro', 1], ['A', 1], ["A'", 1], ['A', 1], ['B', 1], ["A'", 1]]);
  assert.match(buildLilypond(p), /\\repeat volta 3|\\box "A'"/);
});
