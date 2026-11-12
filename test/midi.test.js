import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMidi, PPQ } from '../src/core/midi.js';
import { readMidi, trackName, notes } from './helpers/midi-reader.js';
import { exampleProject } from './helpers/fixtures.js';

const midi = () => readMidi(buildMidi(exampleProject()));
const metas = (events, type) => events.filter((e) => e.meta === type);

test('Format 1, PPQ 480, condutor + 5 trilhas na ordem fixa', () => {
  const m = midi();
  assert.equal(m.format, 1);
  assert.equal(m.ppq, PPQ);
  assert.deepEqual(m.tracks.map(trackName), ['Exemplo de Canção', 'Lead', 'Chords', 'Bass', 'Sax', 'Drums']);
});

test('metadados no condutor', () => {
  const [cond] = midi().tracks;
  assert.equal(metas(cond, 0x02)[0].text, '© 2026 Leo Santos');
  assert.deepEqual(metas(cond, 0x01).map((e) => e.text), ['composer:Leo Santos', 'id:MZK-0001', 'year:2026']);
  const tempo = metas(cond, 0x51)[0].data;
  assert.equal((tempo[0] << 16) | (tempo[1] << 8) | tempo[2], Math.round(60e6 / 92));
  assert.deepEqual([...metas(cond, 0x58)[0].data], [4, 2, 24, 8]);
  assert.deepEqual([...metas(cond, 0x59)[0].data], [0, 1]); // Lá menor
  assert.deepEqual(metas(cond, 0x06).map((e) => [e.tick, e.text]), [
    [0, '[Intro]'], [64 * 120, '[A]'], [128 * 120, '[A]'], [192 * 120, '[B]'], [256 * 120, '[A]'],
  ]);
});

test('canais: Lead 1, Chords 2, Bass 3, Lead2 4, Drums 10', () => {
  const m = midi();
  const channelsOf = (t) => new Set(m.tracks[t].filter((e) => e.type !== undefined).map((e) => e.channel));
  assert.deepEqual([1, 2, 3, 4, 5].map((t) => [...channelsOf(t)]), [[0], [1], [2], [3], [9]]);
  assert.equal(m.tracks[5].some((e) => e.type === 0xc0), false); // bateria sem program change
});

test('melodia quantizada: posições e durações em múltiplos de 1/16', () => {
  const m = midi();
  for (const t of [1, 2, 3, 4, 5]) {
    for (const n of notes(m.tracks[t])) {
      assert.equal(n.tick % 120, 0);
      assert.equal(n.dur % 120, 0);
    }
  }
  const lead = notes(m.tracks[1]);
  assert.equal(lead.length, 11 * 3 + 10); // A ×3 + B
  assert.deepEqual(lead[0], { tick: 64 * 120, dur: 4 * 120, pitch: 76, channel: 0, vel: 100 });
  const lead2 = notes(m.tracks[4]);
  assert.equal(lead2.length, 10); // só na intro
});

test('acordes: texto chord:… canônico + voicing sustentado até o próximo', () => {
  const chordTrack = midi().tracks[2];
  const texts = metas(chordTrack, 0x01).map((e) => e.text);
  assert.deepEqual(texts.slice(0, 5), ['chord:Am7', 'chord:F7M', 'chord:Dm7(9)', 'chord:G7sus4', 'chord:E7(b9)']);
  assert.ok(texts.includes('chord:N.C.'));
  const first = notes(chordTrack).filter((n) => n.tick === 0);
  assert.deepEqual(first.map((n) => n.pitch % 12).sort((a, b) => a - b), [0, 4, 7, 9]);
  assert.ok(first.every((n) => n.dur === 16 * 120));
  // N.C. em B (pos 60): nada soa nos últimos 4 steps de B
  const bStart = 192 * 120;
  const late = notes(chordTrack).filter((n) => n.tick < bStart + 64 * 120 && n.tick + n.dur > bStart + 60 * 120);
  assert.equal(late.length, 0);
});

test('bateria: notas GM, acento = 120', () => {
  const drums = notes(midi().tracks[5]);
  const pitches = new Set(drums.map((n) => n.pitch));
  for (const p of pitches) assert.ok([36, 38, 39, 42, 45, 46, 49, 50].includes(p));
  assert.deepEqual(new Set(drums.map((n) => n.vel)), new Set([90, 120]));
});

test('projeto inválido não gera MIDI', () => {
  const p = exampleProject();
  p.sections[0].chords[0].symbol = '???';
  assert.throws(() => buildMidi(p), /Projeto inválido/);
});
