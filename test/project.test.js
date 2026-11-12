import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateProject, monophonic, fileBaseName, copyrightLine, chordSpans, expandArrangement,
  arrangementRuns, newProject,
} from '../src/core/project.js';
import { exampleProject } from './helpers/fixtures.js';

test('exemplo e projeto novo são válidos', () => {
  assert.deepEqual(validateProject(exampleProject()), []);
  assert.deepEqual(validateProject(newProject({ id: 'MZK-0002', title: 'X', composers: ['Y'] })), []);
});

test('validação aponta os problemas em português', () => {
  const p = exampleProject();
  p.meta.id = 'XYZ';
  p.settings.timeSignature = [6, 8];
  assert.ok(validateProject(p).some((e) => /ID de catálogo/.test(e)));
  assert.ok(validateProject(p).some((e) => /Fórmula de compasso/.test(e)));

  const q = exampleProject();
  q.sections[1].chords.push({ pos: 6, symbol: 'Xm7' });
  q.arrangement.push('nada');
  const errs = validateProject(q);
  assert.ok(errs.some((e) => /fora de um tempo válido/.test(e)));
  assert.ok(errs.some((e) => /Cifra não reconhecida: "Xm7"/.test(e)));
  assert.ok(errs.some((e) => /seção inexistente: "nada"/.test(e)));
});

test('monofonia: nota nova corta a anterior; corte no fim da seção', () => {
  const out = monophonic([{ pos: 4, dur: 8, pitch: 60 }, { pos: 0, dur: 8, pitch: 62 }, { pos: 14, dur: 8, pitch: 64 }], 16);
  assert.deepEqual(out, [{ pos: 0, dur: 4, pitch: 62 }, { pos: 4, dur: 8, pitch: 60 }, { pos: 14, dur: 2, pitch: 64 }]);
});

test('nome de arquivo e copyright', () => {
  assert.equal(fileBaseName(exampleProject()), 'MZK-0001_exemplo-de-cancao_92bpm_Am');
  assert.equal(copyrightLine({ year: 2026, composers: ['A', 'B'], copyright: '' }), '© 2026 A, B');
  assert.equal(copyrightLine({ year: 2026, composers: ['A'], copyright: 'Editora X' }), 'Editora X');
});

test('acordes soam até o próximo / N.C. / fim da seção', () => {
  const b = exampleProject().sections.find((s) => s.id === 'b');
  const spans = chordSpans(b, [4, 4]);
  assert.deepEqual(spans.map((s) => [s.pos, s.end, s.symbol]), [
    [0, 16, 'F7M'], [16, 24, 'Em7'], [24, 32, 'A7'], [32, 40, 'Dm7'], [40, 48, 'G7sus4'], [48, 60, 'E7(#9)'], [60, 64, 'N.C.'],
  ]);
});

test('roteiro expandido e agrupado', () => {
  const p = exampleProject();
  assert.deepEqual(expandArrangement(p).map((o) => [o.section.id, o.start]), [['intro', 0], ['a', 64], ['a', 128], ['b', 192], ['a', 256]]);
  assert.deepEqual(arrangementRuns(p).map((r) => [r.section.id, r.count]), [['intro', 1], ['a', 2], ['b', 1], ['a', 1]]);
});

test('próximo ID de catálogo livre', async () => {
  const { nextCatalogId } = await import('../src/core/project.js');
  assert.equal(nextCatalogId([]), 'MZK-0001');
  assert.equal(nextCatalogId(['MZK-0001', 'MZK-0042', 'lixo', null]), 'MZK-0043');
  assert.equal(nextCatalogId(['MZK-9999']), 'MZK-10000');
});
