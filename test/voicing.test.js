import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChord } from '../src/core/chords.js';
import { voiceChord, voicingPitchClasses, VOICING_LOW, VOICING_HIGH } from '../src/core/voicing.js';

const pcsOf = (notes) => new Set(notes.map((n) => n % 12));

test('primeiro acorde: fundamental embaixo, dentro da faixa', () => {
  const v = voiceChord(parseChord('Am7'));
  assert.equal(v[0] % 12, 9);
  assert.ok(v.every((n) => n >= VOICING_LOW && n <= VOICING_HIGH));
  assert.deepEqual(pcsOf(v), new Set([9, 0, 4, 7]));
});

test('baixo invertido não entra no voicing', () => {
  const v = voiceChord(parseChord('C/E'));
  assert.equal(v[0] % 12, 0);
  assert.deepEqual(pcsOf(v), new Set([0, 4, 7]));
});

test('acordes cheios omitem 5ª (e fundamental com 6+ notas)', () => {
  assert.deepEqual(new Set(voicingPitchClasses(parseChord('C7(9/13)'))), new Set([0, 4, 10, 2, 9]));
  assert.deepEqual(new Set(voicingPitchClasses(parseChord('C7(9/11/13)'))), new Set([4, 10, 2, 5, 9]));
  assert.ok(voicingPitchClasses(parseChord('Bm7(b5)')).includes(5)); // 5ª diminuta fica
});

test('condução de vozes: ii–V–I com pouco movimento', () => {
  let prev = null;
  let total = 0;
  for (const sym of ['Dm7', 'G7', 'C7M', 'Am7', 'Dm7', 'G7']) {
    const v = voiceChord(parseChord(sym), prev);
    assert.ok(v.every((n) => n >= VOICING_LOW && n <= VOICING_HIGH), `${sym} fora da faixa: ${v}`);
    assert.ok(v.length >= 3 && v.length <= 5);
    if (prev) {
      const p = prev;
      const leaps = v.length === p.length ? v.map((n, i) => Math.abs(n - p[i])) : [Math.abs(v[0] - p[0])];
      assert.ok(Math.max(...leaps) <= 4, `${sym}: salto grande demais (${p} → ${v})`);
      total += leaps.reduce((a, b) => a + b, 0);
    }
    prev = v;
  }
  assert.ok(total <= 40, `movimento total ${total}`);
});

test('determinístico', () => {
  const a = voiceChord(parseChord('F#m7(11)'), [57, 60, 64, 67]);
  const b = voiceChord(parseChord('F#m7(11)'), [57, 60, 64, 67]);
  assert.deepEqual(a, b);
});
