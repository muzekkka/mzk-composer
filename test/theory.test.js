import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyFifths, isValidKey, spellPitchClass, spellMidi, noteNameString, scalePitchClasses } from '../src/core/theory.js';

const spell = (pc, tonic, mode) => noteNameString(spellPitchClass(pc, { tonic, mode }));

test('armaduras', () => {
  assert.equal(keyFifths({ tonic: 'C', mode: 'major' }), 0);
  assert.equal(keyFifths({ tonic: 'A', mode: 'minor' }), 0);
  assert.equal(keyFifths({ tonic: 'Bb', mode: 'major' }), -2);
  assert.equal(keyFifths({ tonic: 'F#', mode: 'minor' }), 3);
  assert.equal(keyFifths({ tonic: 'C#', mode: 'major' }), 7);
  assert.equal(keyFifths({ tonic: 'Ab', mode: 'minor' }), -7);
  assert.ok(!isValidKey({ tonic: 'G#', mode: 'major' })); // 8 sustenidos
  assert.ok(!isValidKey({ tonic: 'H', mode: 'major' }));
});

test('grafia diatônica segue a armadura', () => {
  assert.equal(spell(3, 'Bb', 'major'), 'Eb');
  assert.equal(spell(5, 'F#', 'major'), 'E#');
  assert.equal(spell(11, 'Gb', 'major'), 'Cb');
  assert.equal(spell(10, 'D', 'minor'), 'Bb');
});

test('grafia cromática: sensível em menor, empréstimos em maior', () => {
  assert.equal(spell(8, 'A', 'minor'), 'G#'); // sensível
  assert.equal(spell(1, 'D', 'minor'), 'C#'); // sensível com armadura de bemol
  assert.equal(spell(6, 'A', 'minor'), 'F#'); // 6ª maior (dórico/melódico)
  assert.equal(spell(10, 'A', 'minor'), 'Bb'); // b2
  assert.equal(spell(1, 'A', 'minor'), 'C#'); // 3ª maior (picarda / dominante de Ré)
  assert.equal(spell(10, 'C', 'major'), 'Bb'); // b7
  assert.equal(spell(8, 'C', 'major'), 'Ab'); // b6
  assert.equal(spell(6, 'C', 'major'), 'F#'); // #4
  assert.equal(spell(3, 'C', 'major'), 'Eb'); // b3
});

test('oitava respeita a letra (Cb4, B#3)', () => {
  assert.deepEqual(spellMidi(59, { tonic: 'Gb', mode: 'major' }), { letter: 'C', acc: -1, octave: 4 });
  assert.deepEqual(spellMidi(60, { tonic: 'C#', mode: 'major' }), { letter: 'B', acc: 1, octave: 3 });
  assert.deepEqual(spellMidi(69, { tonic: 'C', mode: 'major' }), { letter: 'A', acc: 0, octave: 4 });
});

test('escala para travamento', () => {
  assert.deepEqual(scalePitchClasses({ tonic: 'A', mode: 'minor' }), [9, 11, 0, 2, 4, 5, 7]);
});
