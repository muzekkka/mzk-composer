import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalChord, parseChord, ChordError } from '../src/core/chords.js';

const CASES = [
  // canônico BR → ele mesmo
  ['C', 'C'], ['Am', 'Am'], ['C7M', 'C7M'], ['Am7(9)', 'Am7(9)'], ['Bm7(b5)', 'Bm7(b5)'],
  ['G7(b9)', 'G7(b9)'], ['C°', 'C°'], ['F#m7(11)', 'F#m7(11)'], ['C/E', 'C/E'], ['Gsus4', 'Gsus4'],
  ['G7sus4', 'G7sus4'], ['C6(9)', 'C6(9)'], ['E7(#9)', 'E7(#9)'], ['C+', 'C+'], ['Cm7M', 'Cm7M'],
  ['C(9)', 'C(9)'], ['C5', 'C5'], ['N.C.', 'N.C.'], ['C7(9/13)', 'C7(9/13)'], ['Bb7M(#11)', 'Bb7M(#11)'],
  ['Am7/G', 'Am7/G'], ['C7M(9)/E', 'C7M(9)/E'], ['Ebm6', 'Ebm6'], ['C°(b13)', 'C°(b13)'],
  ['Cm(b5)', 'Cm(b5)'], ['C7(#5)', 'C7(#5)'], ['Csus2', 'Csus2'], ['G7(b9/b13)', 'G7(b9/b13)'],
  // americano / jazz / variações → BR
  ['Cmaj7', 'C7M'], ['CM7', 'C7M'], ['CΔ7', 'C7M'], ['CΔ', 'C7M'], ['Cmaj9', 'C7M(9)'],
  ['Cmaj13', 'C7M(9/13)'], ['A-7', 'Am7'], ['Amin7', 'Am7'], ['Ami7', 'Am7'], ['Bm7b5', 'Bm7(b5)'],
  ['Bø', 'Bm7(b5)'], ['Bø7', 'Bm7(b5)'], ['Cdim7', 'C°'], ['Cº', 'C°'], ['Co7', 'C°'], ['Cdim', 'Cm(b5)'],
  ['Caug', 'C+'], ['C+7', 'C7(#5)'], ['C7#9', 'C7(#9)'], ['C7b9', 'C7(b9)'], ['C7-9', 'C7(b9)'],
  ['C7(9,13)', 'C7(9/13)'], ['C7(9 13)', 'C7(9/13)'], ['Cadd9', 'C(9)'], ['C(add9)', 'C(9)'],
  ['Cmadd9', 'Cm(9)'], ['C6/9', 'C6(9)'], ['C69', 'C6(9)'], ['C9', 'C(9)'], ['Am9', 'Am(9)'],
  ['G7(4)', 'G7sus4'], ['G4', 'Gsus4'], ['Gsus', 'Gsus4'], ['C7+', 'C7M'], ['C7alt', 'C7(b9/#9/b13)'],
  ['F#m7(11)', 'F#m7(11)'], ['C♯m7', 'C#m7'], ['B♭7M', 'Bb7M'], ['c7', null], ['  Dm7  ', 'Dm7'],
  ['nc', 'N.C.'], ['N.C', 'N.C.'], ['Am7(b5)/Eb', 'Am7(b5)/Eb'],
];

for (const [input, expected] of CASES) {
  test(`cifra "${input}" → ${expected ?? 'erro'}`, () => {
    if (expected === null) assert.throws(() => canonicalChord(input), ChordError);
    else assert.equal(canonicalChord(input), expected);
  });
}

test('canônico é ponto fixo', () => {
  for (const [, expected] of CASES) if (expected) assert.equal(canonicalChord(expected), expected);
});

test('cifras inválidas dão erro em português', () => {
  for (const bad of ['', 'H7', 'Cxyz', 'C7(', 'C()', 'C7(15)']) {
    assert.throws(() => parseChord(bad), (e) => e instanceof ChordError && /Cifra não reconhecida/.test(e.message));
  }
});
