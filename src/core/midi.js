// Gerador de Standard MIDI File (Format 1) a partir do projeto. Sem dependências.

import { assertValid, copyrightLine, expandArrangement } from './project.js';
import { keyFifths } from './theory.js';
import { buildTimeline } from './timeline.js';

export const PPQ = 480;
export const TICKS_PER_STEP = PPQ / 4;

/** Layout fixo das trilhas: nome, canal (0-based) e programa GM. */
export const TRACK_LAYOUT = [
  { key: 'lead', name: 'Lead', channel: 0, program: 80 }, // Square Lead
  { key: 'chords', name: 'Chords', channel: 1, program: 89 }, // Warm Pad
  { key: 'bass', name: 'Bass', channel: 2, program: 33 }, // Fingered Bass
  { key: 'lead2', name: 'Lead2', channel: 3, program: 81 }, // Saw Lead
  { key: 'drums', name: 'Drums', channel: 9, program: null }, // GM canal 10
];

const utf8 = (s) => Array.from(new TextEncoder().encode(String(s)));

function varLen(n) {
  const bytes = [n & 0x7f];
  while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
}

const meta = (type, data) => [0xff, type, ...varLen(data.length), ...data];
const text = (type, s) => meta(type, utf8(s));

// Ordem de eventos no mesmo tick: metas → program → note-off → note-on.
const ORDER = { meta: 0, program: 1, off: 2, on: 3 };

function encodeTrack(events) {
  const sorted = events
    .map((e, i) => ({ ...e, i }))
    .sort((a, b) => a.tick - b.tick || ORDER[a.kind] - ORDER[b.kind] || a.i - b.i);
  const body = [];
  let last = 0;
  for (const e of sorted) {
    body.push(...varLen(e.tick - last), ...e.bytes);
    last = e.tick;
  }
  body.push(0x00, 0xff, 0x2f, 0x00); // End of Track
  const len = body.length;
  return [0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff, ...body];
}

function noteEvents(channel, startTick, durTicks, pitch, velocity) {
  return [
    { tick: startTick, kind: 'on', bytes: [0x90 | channel, pitch, velocity] },
    { tick: startTick + durTicks, kind: 'off', bytes: [0x80 | channel, pitch, 0x40] },
  ];
}

function conductorTrack(project, occurrences) {
  const { meta: m, settings } = project;
  const [num, den] = settings.timeSignature;
  const usPerQuarter = Math.round(60_000_000 / settings.bpm);
  const fifths = keyFifths(settings.key);
  const ev = (tick, bytes) => ({ tick, kind: 'meta', bytes });
  const events = [
    ev(0, text(0x03, m.title)),
    ev(0, text(0x02, copyrightLine(m))),
    ev(0, text(0x01, `composer:${(m.composers || []).join(', ')}`)),
    ev(0, text(0x01, `id:${m.id}`)),
    ev(0, text(0x01, `year:${m.year}`)),
    ev(0, meta(0x51, [(usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff])),
    ev(0, meta(0x58, [num, Math.log2(den), 24, 8])),
    ev(0, meta(0x59, [fifths & 0xff, settings.key.mode === 'minor' ? 1 : 0])),
  ];
  for (const { section, start } of occurrences) {
    events.push(ev(start * TICKS_PER_STEP, text(0x06, `[${section.name}]`)));
  }
  return events;
}

function trackEvents(project, layout, timeline) {
  const name = layout.key === 'lead2' ? project.settings.lead2Name || layout.name : layout.name;
  const events = [{ tick: 0, kind: 'meta', bytes: text(0x03, name) }];
  if (layout.program !== null) {
    events.push({ tick: 0, kind: 'program', bytes: [0xc0 | layout.channel, layout.program] });
  }
  if (layout.key === 'chords') {
    for (const c of timeline.chords) {
      events.push({ tick: c.step * TICKS_PER_STEP, kind: 'meta', bytes: text(0x01, `chord:${c.symbol}`) });
    }
  }
  for (const n of timeline.notes) {
    if (n.track !== layout.key) continue;
    events.push(...noteEvents(layout.channel, n.step * TICKS_PER_STEP, n.dur * TICKS_PER_STEP, n.pitch, n.vel));
  }
  return events;
}

/** Gera o arquivo .mid completo (Uint8Array). Lança erro se o projeto for inválido. */
export function buildMidi(project) {
  assertValid(project);
  const occurrences = expandArrangement(project);
  const timeline = buildTimeline(project, occurrences);
  const tracks = [conductorTrack(project, occurrences), ...TRACK_LAYOUT.map((l) => trackEvents(project, l, timeline))];
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, tracks.length, (PPQ >> 8) & 0xff, PPQ & 0xff];
  return Uint8Array.from([...header, ...tracks.flatMap(encodeTrack)]);
}
