// Operações de edição puras (mutam o projeto recebido). A camada de estado do app
// clona o projeto antes de cada operação para manter o desfazer/refazer.

import { canonicalChord, chordBassPc } from './chords.js';
import {
  chordSpans, newSection, sectionLength, stepsPerBar, MAX_SECTION_BARS, MELODIC_TRACKS,
} from './project.js';

export const findSection = (p, id) => p.sections.find((s) => s.id === id);

// ---------- notas (Lead, Lead2, Bass) ----------

/** Índice da nota que cobre `step` na altura `pitch` (ou -1). */
export function noteIndexAt(section, track, step, pitch) {
  return section[track].findIndex((n) => n.pitch === pitch && step >= n.pos && step < n.pos + n.dur);
}

/** Insere uma nota respeitando a monofonia: corta a anterior e remove as que começam dentro. */
export function addNote(section, track, { pos, dur, pitch }, len) {
  const d = Math.max(1, Math.min(dur, len - pos));
  const notes = section[track].filter((n) => n.pos < pos || n.pos >= pos + d);
  for (const n of notes) if (n.pos < pos && n.pos + n.dur > pos) n.dur = pos - n.pos;
  const note = { pos, dur: d, pitch };
  notes.push(note);
  notes.sort((a, b) => a.pos - b.pos);
  section[track] = notes;
  return note;
}

export function removeNote(section, track, index) {
  section[track].splice(index, 1);
}

/** Muda posição/altura/duração de uma nota existente (reaplica a monofonia). */
export function updateNote(section, track, index, changes, len) {
  const [old] = section[track].splice(index, 1);
  return addNote(section, track, { ...old, ...changes }, len);
}

// ---------- acordes ----------

/** Coloca (ou troca) o acorde do tempo `pos`; `symbol` null remove. Devolve o canônico. */
export function setChord(section, pos, symbol) {
  section.chords = section.chords.filter((c) => c.pos !== pos);
  if (symbol === null || symbol === undefined || symbol === '') return null;
  const canon = canonicalChord(symbol);
  section.chords.push({ pos, symbol: canon });
  section.chords.sort((a, b) => a.pos - b.pos);
  return canon;
}

// ---------- bateria ----------

/** off → normal → acento → off. Devolve o novo estado: null | 'normal' | 'accent'. */
export function cycleDrum(section, piece, pos) {
  const i = section.drums.findIndex((d) => d.piece === piece && d.pos === pos);
  if (i < 0) {
    section.drums.push({ pos, piece, accent: false });
    return 'normal';
  }
  if (!section.drums[i].accent) {
    section.drums[i].accent = true;
    return 'accent';
  }
  section.drums.splice(i, 1);
  return null;
}

export function setDrum(section, piece, pos, state) {
  section.drums = section.drums.filter((d) => !(d.piece === piece && d.pos === pos));
  if (state) section.drums.push({ pos, piece, accent: state === 'accent' });
}

// ---------- seções ----------

/** Remove tudo que passou do fim da seção (após encurtar ou mudar a fórmula). */
export function trimSection(section, ts) {
  const len = sectionLength(section, ts);
  const beat = 4;
  for (const t of MELODIC_TRACKS) {
    section[t] = section[t].filter((n) => n.pos < len).map((n) => ({ ...n, dur: Math.min(n.dur, len - n.pos) }));
  }
  section.chords = section.chords.filter((c) => c.pos < len && c.pos % beat === 0);
  section.drums = section.drums.filter((d) => d.pos < len);
}

export function setSectionBars(p, sectionId, bars) {
  const s = findSection(p, sectionId);
  s.bars = Math.max(1, Math.min(MAX_SECTION_BARS, Math.round(bars)));
  trimSection(s, p.settings.timeSignature);
}

export function setTimeSignature(p, ts) {
  p.settings.timeSignature = [...ts];
  for (const s of p.sections) trimSection(s, ts);
}

export function uniqueSectionId(p, base = 's') {
  const slug = String(base).toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '') || 's';
  let id = slug;
  for (let i = 2; p.sections.some((s) => s.id === id); i++) id = `${slug}${i}`;
  return id;
}

const DEFAULT_NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

export function nextSectionName(p) {
  const used = new Set(p.sections.map((s) => s.name));
  return DEFAULT_NAMES.find((n) => !used.has(n)) ?? `Parte ${p.sections.length + 1}`;
}

/** Cria seção nova (vazia) e a acrescenta ao fim do roteiro. */
export function addSection(p, name = nextSectionName(p), bars = 4) {
  const s = newSection(uniqueSectionId(p, name), name, bars);
  p.sections.push(s);
  p.arrangement.push(s.id);
  return s;
}

/** Duplica a seção logo depois dela (lista e roteiro: a cópia entra após a última ocorrência). */
export function duplicateSection(p, sectionId) {
  const src = findSection(p, sectionId);
  const copy = structuredClone(src);
  copy.name = `${src.name}'`;
  copy.id = uniqueSectionId(p, copy.name);
  p.sections.splice(p.sections.indexOf(src) + 1, 0, copy);
  const last = p.arrangement.lastIndexOf(sectionId);
  p.arrangement.splice(last < 0 ? p.arrangement.length : last + 1, 0, copy.id);
  return copy;
}

/** Remove a seção e suas entradas no roteiro. Não remove a última seção. */
export function deleteSection(p, sectionId) {
  if (p.sections.length <= 1) throw new Error('O projeto precisa de pelo menos uma seção.');
  p.sections = p.sections.filter((s) => s.id !== sectionId);
  p.arrangement = p.arrangement.filter((id) => id !== sectionId);
  if (!p.arrangement.length) p.arrangement.push(p.sections[0].id);
}

export function renameSection(p, sectionId, name) {
  const n = String(name).trim();
  if (n) findSection(p, sectionId).name = n;
}

// ---------- roteiro ----------

export function arrangementInsert(p, index, sectionId) {
  p.arrangement.splice(index, 0, sectionId);
}

export function arrangementRemove(p, index) {
  if (p.arrangement.length > 1) p.arrangement.splice(index, 1);
}

export function arrangementMove(p, index, delta) {
  const j = index + delta;
  if (j < 0 || j >= p.arrangement.length) return;
  const [id] = p.arrangement.splice(index, 1);
  p.arrangement.splice(j, 0, id);
}

// ---------- copiar / colar / limpar compasso ----------

const inBar = (pos, start, bar) => pos >= start && pos < start + bar;

/** Copia um compasso de uma trilha: eventos com posição relativa ao compasso. */
export function copyBar(section, track, barIndex, ts) {
  const bar = stepsPerBar(ts);
  const start = barIndex * bar;
  const events = section[track]
    .filter((e) => inBar(e.pos, start, bar))
    .map((e) => ({ ...e, pos: e.pos - start, ...(e.dur ? { dur: Math.min(e.dur, start + bar - e.pos) } : {}) }));
  return { track, beats: ts[0], events };
}

export function clearBar(section, track, barIndex, ts) {
  const bar = stepsPerBar(ts);
  const start = barIndex * bar;
  if (MELODIC_TRACKS.includes(track)) {
    section[track] = section[track]
      .filter((n) => !inBar(n.pos, start, bar))
      .map((n) => (n.pos < start && n.pos + n.dur > start ? { ...n, dur: start - n.pos } : n));
  } else {
    section[track] = section[track].filter((e) => !inBar(e.pos, start, bar));
  }
}

/** Cola substituindo o conteúdo do compasso de destino (mesma trilha). */
export function pasteBar(section, barIndex, clip, ts) {
  const bar = stepsPerBar(ts);
  const start = barIndex * bar;
  const len = sectionLength(section, ts);
  clearBar(section, clip.track, barIndex, ts);
  for (const e of clip.events) {
    if (e.pos >= bar) continue;
    const pos = start + e.pos;
    if (MELODIC_TRACKS.includes(clip.track)) addNote(section, clip.track, { ...e, pos }, len);
    else if (clip.track === 'chords') setChord(section, pos, e.symbol);
    else section.drums.push({ ...e, pos });
  }
}

// ---------- gerar baixo a partir dos acordes ----------

export const BASS_PRESETS = {
  sustain: 'Sustentado',
  half: 'Mínimas',
  quarters: 'Semínimas',
  eighths: 'Colcheias',
  rootFifth: 'Fundamental–quinta',
  octaves: 'Oitavas',
};

const BASS_LOW = 28; // E1
const FIFTH = { P: 7, b5: 6, '#5': 8 };

/** Nota grave (E1–D#2) para a classe de altura. */
export const bassPitch = (pc) => BASS_LOW + ((pc - (BASS_LOW % 12) + 12) % 12);

/** Substitui o baixo da seção por um padrão derivado das cifras. */
export function generateBass(section, ts, preset) {
  if (!BASS_PRESETS[preset]) throw new Error(`Padrão de baixo desconhecido: ${preset}`);
  const notes = [];
  for (const span of chordSpans(section, ts)) {
    if (span.chord.nc) continue;
    const ch = span.chord;
    const low = bassPitch(chordBassPc(ch));
    const root = bassPitch(chordBassPc({ ...ch, bass: null }));
    const fifth = root + (FIFTH[ch.fifth] ?? 7);
    const fill = (step, pitchAt) => {
      for (let pos = span.pos, i = 0; pos < span.end; pos += step, i++) {
        notes.push({ pos, dur: Math.min(step, span.end - pos), pitch: pitchAt(i) });
      }
    };
    switch (preset) {
      case 'sustain': fill(span.end - span.pos, () => low); break;
      case 'half': fill(8, () => low); break;
      case 'quarters': fill(4, () => low); break;
      case 'eighths': fill(2, () => low); break;
      case 'rootFifth': fill(4, (i) => (i % 2 ? fifth : low)); break;
      case 'octaves': fill(2, (i) => (i % 2 ? low + 12 : low)); break;
    }
  }
  section.bass = notes;
}

