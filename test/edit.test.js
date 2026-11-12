import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/core/edit.js';
import { newProject, newSection, validateProject } from '../src/core/project.js';
import { buildTimeline, occurrencesFor } from '../src/core/timeline.js';
import { exampleProject } from './helpers/fixtures.js';

const sec = () => newSection('a', 'A', 2); // 32 steps em 4/4

test('addNote: monofonia (corta a anterior, remove as que começam dentro)', () => {
  const s = sec();
  E.addNote(s, 'lead', { pos: 0, dur: 8, pitch: 60 }, 32);
  E.addNote(s, 'lead', { pos: 8, dur: 2, pitch: 62 }, 32);
  E.addNote(s, 'lead', { pos: 4, dur: 8, pitch: 64 }, 32);
  assert.deepEqual(s.lead, [{ pos: 0, dur: 4, pitch: 60 }, { pos: 4, dur: 8, pitch: 64 }]);
  E.addNote(s, 'lead', { pos: 30, dur: 8, pitch: 65 }, 32);
  assert.equal(s.lead.at(-1).dur, 2); // cortada no fim da seção
});

test('noteIndexAt / updateNote / removeNote', () => {
  const s = sec();
  E.addNote(s, 'bass', { pos: 4, dur: 4, pitch: 40 }, 32);
  assert.equal(E.noteIndexAt(s, 'bass', 6, 40), 0);
  assert.equal(E.noteIndexAt(s, 'bass', 8, 40), -1);
  E.updateNote(s, 'bass', 0, { dur: 12 }, 32);
  assert.deepEqual(s.bass, [{ pos: 4, dur: 12, pitch: 40 }]);
  E.removeNote(s, 'bass', 0);
  assert.deepEqual(s.bass, []);
});

test('setChord normaliza para o canônico e substitui no mesmo tempo', () => {
  const s = sec();
  assert.equal(E.setChord(s, 0, 'Cmaj7'), 'C7M');
  E.setChord(s, 8, 'G7');
  E.setChord(s, 0, 'Am9');
  assert.deepEqual(s.chords, [{ pos: 0, symbol: 'Am(9)' }, { pos: 8, symbol: 'G7' }]);
  E.setChord(s, 8, null);
  assert.equal(s.chords.length, 1);
  assert.throws(() => E.setChord(s, 4, 'Xyz'), /Cifra não reconhecida/);
});

test('cycleDrum: off → normal → acento → off', () => {
  const s = sec();
  assert.equal(E.cycleDrum(s, 'kick', 0), 'normal');
  assert.equal(E.cycleDrum(s, 'kick', 0), 'accent');
  assert.equal(E.cycleDrum(s, 'kick', 0), null);
  assert.deepEqual(s.drums, []);
});

test('encurtar seção e mudar fórmula de compasso removem o que sobrou', () => {
  const p = exampleProject();
  E.setSectionBars(p, 'a', 2);
  const a = E.findSection(p, 'a');
  assert.ok(a.lead.every((n) => n.pos + n.dur <= 32));
  assert.ok(a.chords.every((c) => c.pos < 32));
  E.setTimeSignature(p, [3, 4]);
  assert.deepEqual(validateProject(p), []);
});

test('seções: adicionar, duplicar, renomear, apagar', () => {
  const p = newProject({ id: 'MZK-0009', title: 'T', composers: ['X'] });
  const b = E.addSection(p);
  assert.equal(b.name, 'B');
  assert.deepEqual(p.arrangement, ['a', 'b']);
  E.addNote(E.findSection(p, 'a'), 'lead', { pos: 0, dur: 4, pitch: 72 }, 64);
  const copy = E.duplicateSection(p, 'a');
  assert.equal(copy.name, "A'");
  assert.deepEqual(copy.lead, [{ pos: 0, dur: 4, pitch: 72 }]);
  assert.deepEqual(p.arrangement, ['a', copy.id, 'b']);
  copy.lead[0].pitch = 74;
  assert.equal(E.findSection(p, 'a').lead[0].pitch, 72); // cópia profunda
  E.deleteSection(p, 'a');
  assert.deepEqual(p.arrangement, [copy.id, 'b']);
  assert.deepEqual(validateProject(p), []);
  E.deleteSection(p, 'b');
  assert.throws(() => E.deleteSection(p, copy.id), /pelo menos uma seção/);
});

test('roteiro: inserir, mover, remover (nunca fica vazio)', () => {
  const p = exampleProject();
  E.arrangementMove(p, 0, 1);
  assert.deepEqual(p.arrangement.slice(0, 2), ['a', 'intro']);
  E.arrangementInsert(p, 0, 'b');
  assert.equal(p.arrangement[0], 'b');
  while (p.arrangement.length > 1) E.arrangementRemove(p, 0);
  E.arrangementRemove(p, 0);
  assert.equal(p.arrangement.length, 1);
});

test('copiar/colar/limpar compasso', () => {
  const p = exampleProject();
  const a = E.findSection(p, 'a');
  const clip = E.copyBar(a, 'lead', 0, [4, 4]);
  assert.equal(clip.events.length, 4);
  E.pasteBar(a, 3, clip, [4, 4]);
  assert.deepEqual(a.lead.filter((n) => n.pos >= 48).map((n) => [n.pos, n.pitch]), [[48, 76], [52, 72], [54, 74], [56, 76]]);
  const chordClip = E.copyBar(a, 'chords', 0, [4, 4]);
  E.pasteBar(a, 1, chordClip, [4, 4]);
  assert.equal(a.chords.find((c) => c.pos === 16).symbol, 'Am7');
  E.clearBar(a, 'drums', 0, [4, 4]);
  assert.ok(a.drums.every((d) => d.pos >= 16));
  // nota que atravessa o compasso limpo é cortada
  const b = E.findSection(p, 'b');
  E.clearBar(b, 'lead', 1, [4, 4]);
  assert.ok(b.lead.every((n) => n.pos + n.dur <= 16 || n.pos >= 32));
  assert.deepEqual(validateProject(p), []);
});

test('gerar baixo: usa baixo da inversão, respeita N.C. e o fim do acorde', () => {
  const s = sec();
  E.setChord(s, 0, 'C/E');
  E.setChord(s, 8, 'G7');
  E.setChord(s, 16, 'N.C.');
  E.setChord(s, 24, 'Am');
  E.generateBass(s, [4, 4], 'quarters');
  assert.deepEqual(s.bass.map((n) => [n.pos, n.dur, n.pitch]), [
    [0, 4, 28], [4, 4, 28], // E1
    [8, 4, 31], [12, 4, 31], // G1
    [24, 4, 33], [28, 4, 33], // A1
  ]);
  E.generateBass(s, [4, 4], 'rootFifth');
  assert.deepEqual(s.bass.slice(0, 2).map((n) => n.pitch), [28, 43]); // E1 (baixo /E), depois G2 (quinta de C2)
  E.generateBass(s, [4, 4], 'sustain');
  assert.deepEqual(s.bass.map((n) => [n.pos, n.dur]), [[0, 8], [8, 8], [24, 8]]);
  for (const preset of Object.keys(E.BASS_PRESETS)) E.generateBass(s, [4, 4], preset);
});

test('timeline: loop de seção e roteiro inteiro', () => {
  const p = exampleProject();
  const loop = buildTimeline(p, occurrencesFor(p, 'b'));
  assert.equal(loop.length, 64);
  assert.ok(loop.notes.every((n) => n.step < 64));
  const full = buildTimeline(p, occurrencesFor(p));
  assert.equal(full.length, 64 * 5);
  assert.deepEqual(full.markers.map((m) => m.name), ['Intro', 'A', 'A', 'B', 'A']);
});
