// Voicing automático da trilha Chords: posição fechada em C3–C5 com condução de
// vozes mínima em relação ao acorde anterior.

import { chordIntervals, chordRootPc } from './chords.js';

export const VOICING_LOW = 48; // C3
export const VOICING_HIGH = 72; // C5
const CENTER = 60;

/** Classes de altura que o voicing vai usar (omite 5ª / fundamental em acordes cheios). */
export function voicingPitchClasses(ch) {
  const rootPc = chordRootPc(ch);
  let intervals = [...new Set(chordIntervals(ch).map((i) => i % 12))];
  if (intervals.length >= 5 && ch.fifth === 'P') intervals = intervals.filter((i) => i !== 7);
  if (intervals.length >= 6) intervals = intervals.filter((i) => i !== 0);
  return intervals.map((i) => (rootPc + i) % 12);
}

/** Todas as disposições fechadas (cada inversão, cada oitava) dentro da faixa. */
function candidates(pcs) {
  const sorted = [...pcs].sort((a, b) => a - b);
  const out = [];
  for (let r = 0; r < sorted.length; r++) {
    const order = [...sorted.slice(r), ...sorted.slice(0, r)];
    for (let low = VOICING_LOW; low < VOICING_LOW + 12; low++) {
      if (low % 12 !== order[0]) continue;
      for (let base = low; base <= VOICING_HIGH; base += 12) {
        const notes = [base];
        for (const pc of order.slice(1)) {
          let n = notes[notes.length - 1] + 1;
          while (n % 12 !== pc) n++;
          notes.push(n);
        }
        if (notes[notes.length - 1] <= VOICING_HIGH) out.push(notes);
      }
    }
  }
  return out;
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

function distance(a, b) {
  if (a.length === b.length) return a.reduce((sum, n, i) => sum + Math.abs(n - b[i]), 0);
  return (
    Math.abs(a[0] - b[0]) +
    Math.abs(a[a.length - 1] - b[b.length - 1]) +
    Math.abs(mean(a) - mean(b)) * 2
  );
}

/**
 * Notas MIDI (ordem crescente) para um acorde já interpretado.
 * `prev` = voicing anterior na mesma seção, ou null para o primeiro acorde.
 */
export function voiceChord(ch, prev = null) {
  const pcs = voicingPitchClasses(ch);
  const rootPc = chordRootPc(ch);
  let pool = candidates(pcs);
  if (!prev) {
    const rootBottom = pool.filter((v) => v[0] % 12 === rootPc);
    if (rootBottom.length) pool = rootBottom;
  }
  const score = (v) =>
    (prev ? distance(v, prev) : 0) + Math.abs(mean(v) - CENTER) * (prev ? 0.1 : 1);
  return pool.reduce((best, v) => {
    const s = score(v);
    return s < best.s || (s === best.s && v[0] < best.v[0]) ? { v, s } : best;
  }, { v: null, s: Infinity }).v;
}
