// Timeline linear de notas (em steps) — usada pela reprodução no app e pelo MIDI.

import { chordSpans, expandArrangement, monophonic, sectionLength, DRUM_PIECES } from './project.js';
import { voiceChord } from './voicing.js';

export const NOTE_VELOCITY = 100;
export const DRUM_VELOCITY = { normal: 90, accent: 120 };

/** Ocorrências a tocar: uma seção só (loop) ou o roteiro inteiro. */
export function occurrencesFor(project, sectionId = null) {
  if (sectionId) {
    const section = project.sections.find((s) => s.id === sectionId);
    return section ? [{ section, start: 0 }] : [];
  }
  return expandArrangement(project);
}

/**
 * { length, notes: [{ track, step, dur, pitch, vel, drum? }],
 *   chords: [{ step, symbol }], markers: [{ step, name, sectionId }] }
 */
export function buildTimeline(project, occurrences) {
  const ts = project.settings.timeSignature;
  const notes = [];
  const chords = [];
  const markers = [];
  let length = 0;
  for (const { section, start } of occurrences) {
    const len = sectionLength(section, ts);
    length = Math.max(length, start + len);
    markers.push({ step: start, name: section.name, sectionId: section.id });
    for (const track of ['lead', 'lead2', 'bass']) {
      for (const n of monophonic(section[track] || [], len)) {
        notes.push({ track, step: start + n.pos, dur: n.dur, pitch: n.pitch, vel: NOTE_VELOCITY });
      }
    }
    let prev = null;
    for (const span of chordSpans(section, ts)) {
      chords.push({ step: start + span.pos, symbol: span.symbol });
      if (span.chord.nc) continue;
      prev = voiceChord(span.chord, prev);
      for (const pitch of prev) {
        notes.push({ track: 'chords', step: start + span.pos, dur: span.end - span.pos, pitch, vel: NOTE_VELOCITY });
      }
    }
    for (const d of section.drums || []) {
      notes.push({
        track: 'drums', step: start + d.pos, dur: 1, pitch: DRUM_PIECES[d.piece].note, drum: d.piece,
        vel: d.accent ? DRUM_VELOCITY.accent : DRUM_VELOCITY.normal,
      });
    }
  }
  return { length, notes, chords, markers };
}
