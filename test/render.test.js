import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildRenderScore, renderSettings, seededRandom, TAIL_SECONDS } from '../src/render/score.js';
import { buildNrt, int, oscBundle, oscMessage } from '../src/render/nrt.js';
import { PACKS } from '../src/render/packs.js';

const example = () => JSON.parse(readFileSync(new URL('../examples/MZK-0001_exemplo.json', import.meta.url), 'utf8'));
const DEFS_DIR = fileURLToPath(new URL('../sc/defs/', import.meta.url));

function tiny(render) {
  return {
    schema: 1,
    meta: { id: 'MZK-0009', title: 'T', composers: ['X'], year: 2026, copyright: '', notes: '' },
    settings: { bpm: 120, key: { tonic: 'C', mode: 'major' }, timeSignature: [4, 4], lead2Name: 'Lead2' },
    sections: [{
      id: 'a', name: 'A', bars: 1,
      lead: [{ pos: 0, dur: 4, pitch: 72 }], lead2: [],
      chords: [{ pos: 0, symbol: 'C' }, { pos: 8, symbol: 'N.C.' }],
      bass: [{ pos: 0, dur: 2, pitch: 36 }],
      drums: [{ pos: 0, piece: 'kick', accent: false }, { pos: 4, piece: 'snare', accent: true }],
    }],
    arrangement: ['a', 'a'],
    ...(render ? { render } : {}),
  };
}

test('padrões: pacote synthwave, levada do pacote, humanização ligada', () => {
  assert.deepEqual(renderSettings(tiny()), { pack: 'synthwave', levada: 'padArp', humanize: true });
  assert.deepEqual(renderSettings(tiny({ pack: 'nada', levada: 'xx', humanize: false })),
    { pack: 'synthwave', levada: 'padArp', humanize: false });
});

test('duração = roteiro inteiro + cauda', () => {
  const s = buildRenderScore(tiny());
  assert.equal(s.stepSec, 0.125);
  assert.equal(s.duration, 2 * 16 * 0.125 + TAIL_SECONDS);
});

test('sem humanização os tempos caem exatamente na grade', () => {
  const s = buildRenderScore(tiny({ humanize: false, levada: 'pad' }));
  const lead = s.events.filter((e) => e.synth === 'mzk_lead');
  assert.deepEqual(lead.map((e) => e.time), [0, 2]);
  assert.equal(lead[0].params.dur, 0.5);
  assert.ok(Math.abs(lead[0].params.freq - 523.25) < 0.01);
  // Acento da bateria vale mais que o normal.
  const kick = s.events.find((e) => e.synth === 'mzk_kick');
  const snare = s.events.find((e) => e.synth === 'mzk_snare');
  assert.equal(kick.params.amp, PACKS.synthwave.drums.kick.amp * 0.9);
  assert.equal(snare.params.amp, PACKS.synthwave.drums.snare.amp * 1.2);
});

test('levada pad: um evento por nota do acorde, até o N.C.', () => {
  const s = buildRenderScore(tiny({ humanize: false, levada: 'pad' }));
  const pad = s.events.filter((e) => e.synth === 'mzk_pad');
  assert.equal(pad.length, 2 * 3); // C = 3 notas, 2 ocorrências
  assert.ok(pad.every((e) => e.params.dur === 8 * 0.125));
  assert.equal(s.events.filter((e) => e.synth === 'mzk_pluck').length, 0);
});

test('levada arpejo: uma semicolcheia por step, subindo e voltando', () => {
  const s = buildRenderScore(tiny({ humanize: false, levada: 'arp' }));
  const arp = s.events.filter((e) => e.synth === 'mzk_pluck' && e.time < 2);
  assert.equal(arp.length, 8);
  const midi = arp.map((e) => Math.round(69 + 12 * Math.log2(e.params.freq / 440)));
  const [a, b, c, d] = midi;
  assert.ok(a < b && b < c && c < d && d === a + 12);
  assert.deepEqual(midi.slice(4), midi.slice(0, 4));
  assert.equal(s.events.filter((e) => e.synth === 'mzk_pad').length, 0);
});

test('mesmo projeto, mesmo resultado (humanização determinística)', () => {
  const a = buildRenderScore(example());
  const b = buildRenderScore(example());
  assert.deepEqual(a.events, b.events);
  assert.notDeepEqual(seededRandom('x')(), seededRandom('y')());
  for (let i = 1; i < a.events.length; i++) assert.ok(a.events[i].time >= a.events[i - 1].time);
});

test('todo timbre usado pelos pacotes existe compilado em sc/defs', () => {
  const defs = new Set(readdirSync(DEFS_DIR).map((f) => f.replace('.scsyndef', '')));
  for (const fx of ['mzk_reverb', 'mzk_delay', 'mzk_master']) assert.ok(defs.has(fx), fx);
  for (const pack of Object.values(PACKS)) {
    for (const spec of [...Object.values(pack.tracks), ...Object.values(pack.drums)]) {
      assert.ok(defs.has(spec.synth), `${spec.synth} não compilado (rode sclang sc/synthdefs.scd)`);
    }
  }
});

test('OSC: strings e argumentos alinhados em 4 bytes', () => {
  const m = oscMessage('/s_new', ['mzk_kick', int(-1), 0.5]);
  assert.equal(m.length % 4, 0);
  assert.equal(m.subarray(0, 8).toString(), '/s_new\0\0');
  assert.equal(m.subarray(8, 12).toString(), ',sif');
  const b = oscBundle(1.5, [m]);
  assert.equal(b.subarray(0, 8).toString(), '#bundle\0');
  assert.equal(b.readUInt32BE(8), 1);
  assert.equal(b.readUInt32BE(12), 2 ** 31);
  assert.equal(b.readInt32BE(16), m.length);
});

test('arquivo NRT: bundles em ordem de tempo, terminando na duração', () => {
  const s = buildRenderScore(example());
  const buf = buildNrt(s, []);
  const times = [];
  for (let off = 0; off < buf.length;) {
    const len = buf.readInt32BE(off);
    const t = buf.readUInt32BE(off + 12) + buf.readUInt32BE(off + 16) / 2 ** 32;
    times.push(t);
    off += 4 + len;
  }
  for (let i = 1; i < times.length; i++) assert.ok(times[i] >= times[i - 1]);
  assert.ok(Math.abs(times.at(-1) - s.duration) < 1e-6);
});
