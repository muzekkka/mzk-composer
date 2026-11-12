// Gerador de lead sheet em LilyPond (2.24) a partir do projeto.
// As cifras são impressas como texto, exatamente no texto canônico do projeto.

import {
  assertValid, chordSpans, copyrightLine, monophonic, sectionLength, stepsPerBar,
} from './project.js';
import { canonicalChord } from './chords.js';
import { parseNoteName, spellMidi } from './theory.js';

const DUR_TOKEN = { 1: '16', 2: '8', 3: '8.', 4: '4', 6: '4.', 8: '2', 12: '2.', 16: '1' };
const FULL_BAR = { 2: '2', 3: '2.', 4: '1' };
const BARS_PER_LINE = 4;

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const str = (s) => `"${esc(s)}"`;

/** Pode uma figura de `d` steps começar em `pos` (dentro do compasso)? */
function allowed(pos, d, beats) {
  const dotted = d === 3 || d === 6 || d === 12;
  const base = dotted ? (d * 2) / 3 : d;
  // Semínima sincopada (8 4 8) é legível, desde que não cruze o meio do 4/4.
  if (d === 4 && pos % 4 === 2) return beats !== 4 || Math.floor(pos / 8) === Math.floor((pos + 3) / 8);
  // "4 2" em 3/4 e "4 2 4" em 4/4: mínima no tempo 2.
  if (d === 8 && pos === 4 && beats >= 3) return true;
  if (pos % base !== 0) return false;
  // Nota que começa fora do tempo termina no próximo tempo (mostra onde cai o tempo).
  if (pos % 4 !== 0 && pos + d > Math.ceil(pos / 4) * 4) return false;
  return true;
}

/** Quebra uma duração (em steps, dentro de um compasso) em figuras legíveis. */
export function splitDuration(pos, len, beats) {
  const bar = beats * 4;
  const out = [];
  while (len > 0) {
    const d = [16, 12, 8, 6, 4, 3, 2, 1].find((x) => x <= len && pos + x <= bar && allowed(pos, x, beats));
    out.push(d);
    pos += d;
    len -= d;
  }
  return out;
}

export function lilyPitch(midi, key) {
  const { letter, acc, octave } = spellMidi(midi, key);
  const accStr = acc > 0 ? 's'.repeat(acc) : 'f'.repeat(-acc);
  const marks = octave >= 3 ? "'".repeat(octave - 3) : ','.repeat(3 - octave);
  return letter.toLowerCase() + accStr + marks;
}

function lilyKeyName(tonic) {
  const { letter, acc } = parseNoteName(tonic);
  return letter.toLowerCase() + (acc > 0 ? 's'.repeat(acc) : 'f'.repeat(-acc));
}

/** Peças (nota/pausa) de uma linha monofônica, cortadas nas barras de compasso. */
function barPieces(notes, len, bar) {
  const pieces = [];
  let cursor = 0;
  for (const n of notes) {
    if (n.pos > cursor) pieces.push({ rest: true, start: cursor, dur: n.pos - cursor });
    pieces.push({ rest: false, start: n.pos, dur: n.dur, pitch: n.pitch });
    cursor = n.pos + n.dur;
  }
  if (cursor < len) pieces.push({ rest: true, start: cursor, dur: len - cursor });

  const bars = Array.from({ length: len / bar }, () => []);
  for (const p of pieces) {
    let { start, dur } = p;
    while (dur > 0) {
      const barEnd = (Math.floor(start / bar) + 1) * bar;
      const d = Math.min(dur, barEnd - start);
      bars[Math.floor(start / bar)].push({ ...p, start, dur: d, tie: !p.rest && d < dur });
      start += d;
      dur -= d;
    }
  }
  return bars;
}

/** Música de uma linha melódica numa seção: um array de strings, uma por compasso. */
function melodyBars(notes, section, settings) {
  const { timeSignature: ts, key } = settings;
  const beats = ts[0];
  const bar = stepsPerBar(ts);
  const len = sectionLength(section, ts);
  return barPieces(monophonic(notes, len), len, bar).map((items) => {
    if (items.length === 1 && items[0].rest) return `R${FULL_BAR[beats]}`;
    const tokens = [];
    for (const it of items) {
      const durs = splitDuration(it.start % bar, it.dur, beats);
      durs.forEach((d, i) => {
        if (it.rest) tokens.push(`r${DUR_TOKEN[d]}`);
        else {
          const tie = i < durs.length - 1 || it.tie ? '~' : '';
          tokens.push(`${lilyPitch(it.pitch, key)}${DUR_TOKEN[d]}${tie}`);
        }
      });
    }
    return tokens.join(' ');
  });
}

// "(b9/#11)" → markup com glifos de acidente.
function accidentalMarkup(text) {
  const parts = [];
  for (const m of text.matchAll(/([b#])(?=\d)|[^b#]+|[b#]/g)) {
    if (m[1] === 'b') parts.push('\\flat');
    else if (m[1] === '#') parts.push('\\sharp');
    else parts.push(str(m[0]));
  }
  return parts.join(' ');
}

function noteMarkup(name) {
  const { letter, acc } = parseNoteName(name);
  const glyph = acc > 0 ? ' \\raise #0.7 \\fontsize #-3 \\sharp' : acc < 0 ? ' \\raise #0.5 \\fontsize #-3 \\flat' : '';
  return `${str(letter)}${glyph}`;
}

/** Cifra canônica → \markup do LilyPond. */
export function chordMarkup(symbol) {
  const canon = canonicalChord(symbol);
  if (canon === 'N.C.') return '\\markup "N.C."';
  const m = /^([A-G][#b]?)([^(]*?)(\(.*\))?(?:\/([A-G][#b]?))?$/.exec(canon);
  const [, root, main, paren, bass] = m;
  const parts = [noteMarkup(root)];
  if (main) parts.push(str(main));
  if (paren) parts.push(`\\super \\concat { ${accidentalMarkup(paren)} }`);
  if (bass) parts.push(`"/" ${noteMarkup(bass)}`);
  return `\\markup \\concat { ${parts.join(' ')} }`;
}

/** Linha de cifras de uma seção: espaçadores com markups, um trecho por compasso. */
function chordBars(section, ts) {
  const bar = stepsPerBar(ts);
  const len = sectionLength(section, ts);
  const marks = new Map(chordSpans(section, ts).map((s) => [s.pos, s.symbol]));
  const bars = [];
  for (let b = 0; b * bar < len; b++) {
    const tokens = [];
    const points = [...marks.keys()].filter((p) => p > b * bar && p < (b + 1) * bar);
    const cuts = [b * bar, ...points, (b + 1) * bar];
    for (let i = 0; i < cuts.length - 1; i++) {
      const sym = marks.get(cuts[i]);
      const markup = sym !== undefined ? `^${chordMarkup(sym)}` : '';
      tokens.push(`s16*${cuts[i + 1] - cuts[i]}${markup}`);
    }
    bars.push(tokens.join(' '));
  }
  return bars;
}

function indent(lines, n = 2) {
  return lines.map((l) => ' '.repeat(n) + l);
}

/**
 * Monta uma linha (lead, lead2 ou cifras) percorrendo o roteiro agrupado em repetições.
 * `barsOf(section)` devolve as strings de cada compasso.
 */
function voiceBody(runs, barsOf, { marks = false, breaks = false } = {}) {
  const lines = [];
  runs.forEach((run, ri) => {
    const body = [];
    if (marks) {
      const times = run.count > 2 ? ` " (${run.count}x)"` : '';
      body.push(`\\mark \\markup { \\box ${str(run.section.name)}${times} }`);
    }
    barsOf(run.section).forEach((b, i, all) => {
      const brk = breaks && (i + 1) % BARS_PER_LINE === 0 && i + 1 < all.length ? ' \\break' : '';
      body.push(`${b} |${brk}`);
    });
    if (ri > 0) {
      if (breaks) lines.push('\\break');
      if (marks && run.count === 1 && runs[ri - 1].count === 1) lines.push('\\bar "||"');
    }
    if (run.count > 1) {
      lines.push(`\\repeat volta ${run.count} {`, ...indent(body), '}');
    } else {
      lines.push(...body);
    }
  });
  if (marks && runs[runs.length - 1].count === 1) lines.push('\\bar "|."');
  return lines;
}

function clefFor(notes) {
  if (!notes.length) return 'treble';
  const avg = notes.reduce((s, n) => s + n.pitch, 0) / notes.length;
  return avg < 57 ? 'bass' : 'treble';
}

// O que aparece no lead sheet (melodia, Lead2, cifras). Baixo e bateria não contam.
function printedSignature(section, ts) {
  const len = sectionLength(section, ts);
  return JSON.stringify([
    section.bars,
    monophonic(section.lead || [], len),
    monophonic(section.lead2 || [], len),
    chordSpans(section, ts).map((c) => [c.pos, c.symbol]),
  ]);
}

/**
 * Roteiro agrupado para a partitura: partes seguidas com a mesma escrita
 * (ex.: A e A' que só mudam a bateria) viram uma repetição.
 */
export function leadSheetRuns(project) {
  const ts = project.settings.timeSignature;
  const byId = new Map(project.sections.map((s) => [s.id, s]));
  const runs = [];
  for (const id of project.arrangement) {
    const section = byId.get(id);
    const sig = printedSignature(section, ts);
    const last = runs[runs.length - 1];
    if (last && last.sig === sig) last.count++;
    else runs.push({ section, count: 1, sig });
  }
  return runs;
}

/** Gera o arquivo .ly completo (string). Lança erro se o projeto for inválido. */
export function buildLilypond(project) {
  assertValid(project);
  const { meta, settings } = project;
  const ts = settings.timeSignature;
  const runs = leadSheetRuns(project);
  const used = runs.map((r) => r.section);
  const lead2Notes = used.flatMap((s) => s.lead2 || []);
  const hasLead2 = lead2Notes.length > 0;
  const leadNotes = used.flatMap((s) => s.lead || []);
  const composers = (meta.composers || []).filter(Boolean).join(', ');

  const leadBody = voiceBody(runs, (s) => melodyBars(s.lead || [], s, settings), { marks: true, breaks: true });
  const lead2Body = hasLead2 ? voiceBody(runs, (s) => melodyBars(s.lead2 || [], s, settings)) : [];
  const chordBody = voiceBody(runs, (s) => chordBars(s, ts));

  const staff = (name, instrument, clef, music) => [
    `\\new Staff = ${str(name)} \\with {`,
    ...(hasLead2 ? [`  instrumentName = ${str(instrument)}`] : []),
    '} {',
    `  \\global \\clef ${clef}`,
    ...indent(music),
    '}',
  ];

  return [
    '\\version "2.24.0"',
    '\\language "english"',
    '',
    '\\header {',
    `  title = ${str(meta.title)}`,
    `  composer = ${str(composers)}`,
    `  opus = ${str(meta.id)}`,
    `  meter = \\markup { \\fontsize #-1 \\note {4} #UP " = ${settings.bpm}" }`,
    `  copyright = ${str(copyrightLine(meta))}`,
    `  tagline = ${str(`${meta.id} · Muzeka · gerado por MZK Composer`)}`,
    '}',
    '',
    '\\paper {',
    '  #(set-paper-size "a4")',
    '  indent = 0',
    '  ragged-last = ##f',
    '  page-breaking = #ly:minimal-breaking',
    '}',
    '',
    'global = {',
    `  \\key ${lilyKeyName(settings.key.tonic)} \\${settings.key.mode}`,
    `  \\numericTimeSignature \\time ${ts[0]}/${ts[1]}`,
    '}',
    '',
    '\\score {',
    '  <<',
    '    \\new Dynamics \\with {',
    "      \\override TextScript.font-shape = #'upright",
    "      \\override TextScript.font-series = #'bold",
    '      \\override TextScript.font-size = #1.5',
    '      \\textLengthOn',
    '    } {',
    ...indent(chordBody, 6),
    '    }',
    ...indent(staff('lead', 'Lead', clefFor(leadNotes), leadBody), 4),
    ...(hasLead2 ? indent(staff('lead2', settings.lead2Name || 'Lead2', clefFor(lead2Notes), lead2Body), 4) : []),
    '  >>',
    '  \\layout {',
    '    \\context { \\Score \\override NonMusicalPaperColumn.line-break-permission = ##f }',
    '  }',
    '}',
    '',
  ].join('\n');
}
