// Projeto → lista de eventos de áudio (em segundos) para o mp3: segue o roteiro,
// aplica o pacote de som, a levada dos acordes e uma humanização leve e determinística
// (o mesmo projeto gera sempre o mesmo mp3).

import { STEPS_PER_BEAT } from '../core/project.js';
import { buildTimeline, occurrencesFor } from '../core/timeline.js';
import { DEFAULT_PACK, LEVADAS, PACKS } from './packs.js';

export const TAIL_SECONDS = 2;

const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

/** Escolhas de som do projeto (campo opcional `render`), com padrões. */
export function renderSettings(project) {
  const r = project.render || {};
  const pack = PACKS[r.pack] ? r.pack : DEFAULT_PACK;
  const levada = LEVADAS[r.levada] ? r.levada : PACKS[pack].levada;
  return { pack, levada, humanize: r.humanize !== false };
}

/** Gerador pseudoaleatório com semente (mulberry32 sobre um hash do texto). */
export function seededRandom(text) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * { duration, stepSec, settings, pack, events: [{ time, synth, params, rev, dly }] }
 * `params` sempre traz amp e pan; notas trazem também freq e dur (s).
 */
export function buildRenderScore(project) {
  const settings = renderSettings(project);
  const pack = PACKS[settings.pack];
  const levada = LEVADAS[settings.levada];
  const stepSec = 60 / project.settings.bpm / STEPS_PER_BEAT;
  const tl = buildTimeline(project, occurrencesFor(project));
  const rand = seededRandom(`${project.meta.uid || project.meta.id}:${settings.pack}`);
  const jitter = (amount) => (settings.humanize ? (rand() * 2 - 1) * amount : 0);

  const events = [];
  const add = (step, spec, extra, { timeJitter = 0.006, ampJitter = 0.08, ampScale = 1 } = {}) => {
    const time = Math.max(0, step * stepSec + jitter(timeJitter));
    events.push({
      time,
      synth: spec.synth,
      params: {
        ...spec.params,
        amp: spec.amp * ampScale * (1 + jitter(ampJitter)),
        pan: spec.pan ?? 0,
        ...extra,
      },
      rev: spec.rev ?? 0,
      dly: spec.dly ?? 0,
    });
  };

  const chordGroups = new Map(); // step → { dur, pitches }
  for (const n of tl.notes) {
    if (n.track === 'drums') {
      const spec = pack.drums[n.drum];
      if (!spec) continue;
      const steady = n.drum === 'kick' || n.drum === 'snare';
      add(n.step, spec, {}, {
        timeJitter: steady ? 0 : 0.003,
        ampJitter: steady ? 0.04 : 0.15,
        ampScale: n.vel / 100,
      });
    } else if (n.track === 'chords') {
      const g = chordGroups.get(n.step) || { dur: n.dur, pitches: [] };
      g.pitches.push(n.pitch);
      chordGroups.set(n.step, g);
    } else {
      const spec = pack.tracks[n.track];
      add(n.step, spec, { freq: mtof(n.pitch), dur: n.dur * stepSec }, { ampScale: n.vel / 100 });
    }
  }

  for (const [step, { dur, pitches }] of chordGroups) {
    pitches.sort((a, b) => a - b);
    if (levada.pad) {
      const spec = pack.tracks.pad;
      // Pad mais baixo quando divide espaço com o arpejo.
      const ampScale = levada.arp ? 0.75 : 1;
      for (const p of pitches) add(step, spec, { freq: mtof(p), dur: dur * stepSec }, { ampScale, timeJitter: 0.004 });
    }
    if (levada.arp) {
      const spec = pack.tracks.arp;
      const seq = [...pitches, pitches[0] + 12].map((p) => p + (spec.octave || 0));
      for (let i = 0; i < dur; i++) {
        const onBeat = (step + i) % STEPS_PER_BEAT === 0;
        const pan = spec.spread ? (i % 2 ? spec.spread : -spec.spread) : spec.pan;
        add(step + i, spec, { freq: mtof(seq[i % seq.length]), dur: stepSec * 0.8, pan }, {
          ampScale: onBeat ? 1 : 0.78, timeJitter: 0.003, ampJitter: 0.06,
        });
      }
    }
  }

  events.sort((a, b) => a.time - b.time);
  return {
    duration: tl.length * stepSec + TAIL_SECONDS,
    stepSec,
    settings,
    pack,
    events,
  };
}
