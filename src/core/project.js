// Modelo do projeto (.json), validação e utilidades compartilhadas por MIDI e LilyPond.

import { parseChord, formatChord, ChordError } from './chords.js';
import { isValidKey, keyShortName } from './theory.js';

export const SCHEMA_VERSION = 1;
export const STEPS_PER_BEAT = 4; // 1 step = semicolcheia
export const TIME_SIGNATURES = [[2, 4], [3, 4], [4, 4]];
export const MAX_SECTION_BARS = 32;
export const MAX_ARRANGEMENT = 64;
export const MELODIC_TRACKS = ['lead', 'lead2', 'bass'];

export const DRUM_PIECES = {
  kick: { note: 36, label: 'Bumbo' },
  snare: { note: 38, label: 'Caixa' },
  clap: { note: 39, label: 'Palma' },
  hhClosed: { note: 42, label: 'Chimbal fechado' },
  hhOpen: { note: 46, label: 'Chimbal aberto' },
  tomLow: { note: 45, label: 'Tom grave' },
  tomHigh: { note: 50, label: 'Tom agudo' },
  crash: { note: 49, label: 'Prato' },
};

export function stepsPerBar(ts) {
  return ts[0] * STEPS_PER_BEAT;
}

export function sectionLength(section, ts) {
  return section.bars * stepsPerBar(ts);
}

export function newSection(id, name, bars = 4) {
  return { id, name, bars, lead: [], lead2: [], chords: [], bass: [], drums: [] };
}

export function newProject({ id = 'MZK-0001', title = 'Sem título', composers = [], year } = {}) {
  return {
    schema: SCHEMA_VERSION,
    meta: { id, title, composers, year: year ?? new Date().getFullYear(), copyright: '', notes: '' },
    settings: { bpm: 90, key: { tonic: 'C', mode: 'major' }, timeSignature: [4, 4], lead2Name: 'Lead2' },
    sections: [newSection('a', 'A')],
    arrangement: ['a'],
  };
}

/** Próximo ID de catálogo livre: maior número existente + 1 ("MZK-0043"). */
export function nextCatalogId(ids) {
  let max = 0;
  for (const id of ids) {
    const m = /^MZK-(\d+)$/.exec(id || '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `MZK-${String(max + 1).padStart(4, '0')}`;
}

export function copyrightLine(meta) {
  if (meta.copyright && meta.copyright.trim()) return meta.copyright.trim();
  const names = (meta.composers || []).filter(Boolean).join(', ');
  return `© ${meta.year}${names ? ` ${names}` : ''}`;
}

export function slugify(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'sem-titulo';
}

/** "MZK-0042_titulo-da-obra_92bpm_Am" (sem extensão). */
export function fileBaseName(project) {
  const { meta, settings } = project;
  return `${meta.id}_${slugify(meta.title)}_${settings.bpm}bpm_${keyShortName(settings.key)}`;
}

const isInt = (n) => Number.isInteger(n);

/** Lista de erros em português. Vazia = projeto válido. */
export function validateProject(p) {
  const errors = [];
  const err = (msg) => errors.push(msg);
  if (!p || typeof p !== 'object') return ['Arquivo de projeto vazio ou inválido.'];
  if (p.schema !== SCHEMA_VERSION) err(`Versão de formato não suportada: ${p.schema} (esperado ${SCHEMA_VERSION}).`);

  const meta = p.meta || {};
  if (!/^MZK-\d{4,}$/.test(meta.id || '')) err(`ID de catálogo inválido: "${meta.id}" (formato MZK-0042).`);
  if (!meta.title || !String(meta.title).trim()) err('Título da obra está vazio.');
  if (!Array.isArray(meta.composers)) err('Compositor(es) deve ser uma lista.');
  if (!isInt(meta.year)) err('Ano inválido.');

  const s = p.settings || {};
  if (!isInt(s.bpm) || s.bpm < 20 || s.bpm > 300) err(`BPM inválido: ${s.bpm} (20–300).`);
  if (!isValidKey(s.key)) err(`Tonalidade inválida: ${JSON.stringify(s.key)}.`);
  const ts = s.timeSignature;
  if (!Array.isArray(ts) || !TIME_SIGNATURES.some(([n, d]) => ts[0] === n && ts[1] === d)) {
    err(`Fórmula de compasso inválida: ${JSON.stringify(ts)} (2/4, 3/4 ou 4/4).`);
    return errors;
  }

  const ids = new Set();
  for (const sec of p.sections || []) {
    const where = `Seção "${sec.name ?? sec.id}"`;
    if (!sec.id || ids.has(sec.id)) err(`${where}: id ausente ou repetido.`);
    ids.add(sec.id);
    if (!isInt(sec.bars) || sec.bars < 1 || sec.bars > MAX_SECTION_BARS) {
      err(`${where}: número de compassos inválido (${sec.bars}).`);
      continue;
    }
    const len = sectionLength(sec, ts);
    for (const track of MELODIC_TRACKS) {
      for (const n of sec[track] || []) {
        if (!isInt(n.pos) || !isInt(n.dur) || n.dur < 1 || n.pos < 0 || n.pos >= len) {
          err(`${where}, ${track}: nota com posição/duração inválida (${JSON.stringify(n)}).`);
        }
        if (!isInt(n.pitch) || n.pitch < 0 || n.pitch > 127) err(`${where}, ${track}: altura inválida (${n.pitch}).`);
      }
    }
    for (const c of sec.chords || []) {
      if (!isInt(c.pos) || c.pos < 0 || c.pos >= len || c.pos % STEPS_PER_BEAT !== 0) {
        err(`${where}: acorde "${c.symbol}" fora de um tempo válido (pos ${c.pos}).`);
      }
      try {
        parseChord(c.symbol);
      } catch (e) {
        if (e instanceof ChordError) err(`${where}: ${e.message}`);
        else throw e;
      }
    }
    for (const d of sec.drums || []) {
      if (!DRUM_PIECES[d.piece]) err(`${where}: peça de bateria desconhecida "${d.piece}".`);
      if (!isInt(d.pos) || d.pos < 0 || d.pos >= len) err(`${where}: step de bateria inválido (${d.pos}).`);
    }
  }
  const arr = p.arrangement || [];
  if (!arr.length) err('O roteiro está vazio.');
  if (arr.length > MAX_ARRANGEMENT) err(`Roteiro com mais de ${MAX_ARRANGEMENT} entradas.`);
  for (const id of arr) if (!ids.has(id)) err(`Roteiro cita seção inexistente: "${id}".`);
  return errors;
}

export function assertValid(p) {
  const errors = validateProject(p);
  if (errors.length) {
    const e = new Error(`Projeto inválido:\n- ${errors.join('\n- ')}`);
    e.errors = errors;
    throw e;
  }
}

/** Notas ordenadas, monofônicas (a nova corta a anterior) e cortadas no fim da seção. */
export function monophonic(notes, sectionLen) {
  const sorted = [...notes].sort((a, b) => a.pos - b.pos || b.pitch - a.pitch);
  const out = [];
  for (const n of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev.pos === n.pos) continue; // mesma posição: fica a mais aguda
    if (prev && prev.pos + prev.dur > n.pos) prev.dur = n.pos - prev.pos;
    out.push({ pos: n.pos, dur: Math.min(n.dur, sectionLen - n.pos), pitch: n.pitch });
  }
  return out;
}

/** Acordes com início/fim: [{ pos, end, symbol, chord }] (N.C. incluído, com chord.nc). */
export function chordSpans(section, ts) {
  const len = sectionLength(section, ts);
  const sorted = [...(section.chords || [])].sort((a, b) => a.pos - b.pos);
  return sorted.map((c, i) => {
    const chord = parseChord(c.symbol);
    return { pos: c.pos, end: i + 1 < sorted.length ? sorted[i + 1].pos : len, symbol: formatChord(chord), chord };
  });
}

/** Roteiro expandido: [{ section, start (steps) }]. */
export function expandArrangement(project) {
  const ts = project.settings.timeSignature;
  const byId = new Map(project.sections.map((s) => [s.id, s]));
  let start = 0;
  return project.arrangement.map((id) => {
    const section = byId.get(id);
    const occ = { section, start };
    start += sectionLength(section, ts);
    return occ;
  });
}

/** Roteiro agrupado em repetições consecutivas: [{ section, count }]. */
export function arrangementRuns(project) {
  const byId = new Map(project.sections.map((s) => [s.id, s]));
  const runs = [];
  for (const id of project.arrangement) {
    const last = runs[runs.length - 1];
    if (last && last.section.id === id) last.count++;
    else runs.push({ section: byId.get(id), count: 1 });
  }
  return runs;
}
