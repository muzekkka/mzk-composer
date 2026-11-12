// Cifras: parser tolerante (BR / americano / jazz) → modelo → texto canônico BR.
//
// Modelo:
// { nc: true }  (N.C.)
// { root: 'A', third: 'M'|'m'|'sus2'|'sus4'|null, fifth: 'P'|'b5'|'#5',
//   seventh: null|'m7'|'M7'|'6'|'d7', tensions: ['9','b13',...], bass: 'G'|null }

import { parseNoteName, noteNameString } from './theory.js';

const TENSION_ORDER = ['b9', '9', '#9', '11', '#11', 'b13', '13'];
const TENSION_INTERVAL = { b9: 1, 9: 2, '#9': 3, 11: 5, '#11': 6, b13: 8, 13: 9 };
const THIRD_INTERVAL = { M: 4, m: 3, sus2: 2, sus4: 5 };
const FIFTH_INTERVAL = { P: 7, b5: 6, '#5': 8 };
const SEVENTH_INTERVAL = { m7: 10, M7: 11, 6: 9, d7: 9 };

export class ChordError extends Error {}

function fail(input, detail) {
  throw new ChordError(`Cifra não reconhecida: "${input}"${detail ? ` (${detail})` : ''}`);
}

function normalizeText(s) {
  return s
    .replace(/\(([^)]*)\)/g, (_, inner) => `(${inner.trim().replace(/\s+/g, '/')})`)
    .replace(/\s+/g, '')
    .replace(/♯/g, '#')
    .replace(/♭/g, 'b')
    .replace(/[º˚o](?=7?$|7?[(/])/g, '°') // "Co", "Cº7" → "C°"
    .replace(/−|–/g, '-')
    .replace(/Δ(?!\d)/g, 'maj7')
    .replace(/Δ/g, 'maj')
    .replace(/6\/9|69/g, '6(9)');
}

// Item de dentro dos parênteses (ou alteração solta) → efeito no acorde.
function applyItem(ch, item, input) {
  const it = item.replace(/^\+/, '#').replace(/^-/, 'b').replace(/^add/, '');
  switch (it) {
    case 'b5': ch.fifth = 'b5'; return;
    case '#5': ch.fifth = '#5'; return;
    case 'b6': ch.tensions.add('b13'); return;
    case '4': ch.third = 'sus4'; return;
    case '2': ch.tensions.add('9'); return;
    case '6': ch.seventh = ch.seventh ?? '6'; return;
    case '7': ch.seventh = ch.seventh ?? 'm7'; return;
    case '7M': ch.seventh = 'M7'; return;
    default:
      if (TENSION_ORDER.includes(it)) { ch.tensions.add(it); return; }
      fail(input, `item "${item}"`);
  }
}

// Tokens fora dos parênteses, testados em ordem a partir da posição atual.
const TOKENS = [
  [/^(°7|°|dim7)/, (ch) => { ch.third = 'm'; ch.fifth = 'b5'; ch.seventh = 'd7'; }],
  [/^(ø7|ø)/, (ch) => { ch.third = 'm'; ch.fifth = 'b5'; ch.seventh = 'm7'; }],
  [/^dim/, (ch) => { ch.third = 'm'; ch.fifth = 'b5'; }],
  [/^(maj|Maj|MA(?=\d)|Ma(?=\d)|ma(?=\d))(7|9|11|13)?/, (ch, m) => {
    ch.seventh = 'M7';
    addStackedTensions(ch, m[2]);
  }],
  [/^(7M|M7|7\+)/, (ch) => { ch.seventh = 'M7'; }],
  [/^(M)(?![a-z])/, () => {}],
  [/^(b5|#5|b9|#9|#11|b13|b6|-5|\+5|-9|\+9|\+11|-13)/, (ch, m, input) => applyItem(ch, m[1], input)],
  [/^(min|mi|m|-)/, (ch) => { ch.third = 'm'; }],
  [/^(aug|\+)/, (ch) => { ch.fifth = '#5'; }],
  [/^sus2/, (ch) => { ch.third = 'sus2'; }],
  [/^sus4?/, (ch) => { ch.third = 'sus4'; }],
  [/^alt/, (ch) => { ch.seventh = 'm7'; ['b9', '#9', 'b13'].forEach((t) => ch.tensions.add(t)); }],
  [/^add(b9|#9|9|11|#11|13|b13|2|4)/, (ch, m, input) => applyItem(ch, m[1], input)],
  [/^(13|11|9)/, (ch, m) => {
    // Convenção BR: sem sétima declarada, 9/11/13 são notas adicionadas.
    if (ch.seventh) addStackedTensions(ch, m[1]);
    else ch.tensions.add(m[1]);
  }],
  [/^7/, (ch) => { ch.seventh = ch.seventh ?? 'm7'; }],
  [/^6/, (ch) => { ch.seventh = '6'; }],
  [/^5/, (ch) => { ch.third = null; }],
  [/^4/, (ch) => { ch.third = 'sus4'; }],
  [/^2/, (ch) => { ch.third = 'sus2'; }],
];

function addStackedTensions(ch, top) {
  if (!top || top === '7') return;
  ch.tensions.add('9');
  if (top === '11') ch.tensions.add('11');
  if (top === '13') ch.tensions.add('13');
}

/** Interpreta uma cifra em qualquer padrão aceito. Lança ChordError. */
export function parseChord(input) {
  const raw = String(input ?? '');
  let s = normalizeText(raw);
  if (!s) fail(raw, 'vazia');
  if (/^(N\.?C\.?)$/i.test(s)) return { nc: true };

  let bass = null;
  const slash = /\/([A-G](?:#|b)?)$/.exec(s);
  if (slash) {
    bass = noteNameString(parseNoteName(slash[1]));
    s = s.slice(0, slash.index);
  }

  const rootM = /^([A-G])(#|b)?/.exec(s);
  if (!rootM) fail(raw, 'fundamental deve ser A–G');
  const root = noteNameString(parseNoteName(rootM[0]));
  let rest = s.slice(rootM[0].length);

  const ch = { root, third: 'M', fifth: 'P', seventh: null, tensions: new Set(), bass };

  while (rest.length) {
    if (rest[0] === '(') {
      const close = rest.indexOf(')');
      if (close < 0) fail(raw, 'parêntese sem fechar');
      const items = rest.slice(1, close).split(/[/,]/).filter(Boolean);
      if (!items.length) fail(raw, 'parênteses vazios');
      for (const item of items) applyItem(ch, item, raw);
      rest = rest.slice(close + 1);
      continue;
    }
    const tok = TOKENS.find(([re]) => re.test(rest));
    if (!tok) fail(raw, `trecho "${rest}"`);
    const m = tok[0].exec(rest);
    tok[1](ch, m, raw);
    rest = rest.slice(m[0].length);
  }

  // Tríade aumentada com sétima/tensões continua válida (#5 vai para os parênteses).
  return { ...ch, tensions: TENSION_ORDER.filter((t) => ch.tensions.has(t)) };
}

/** Texto canônico no padrão popular brasileiro. */
export function formatChord(ch) {
  if (ch.nc) return 'N.C.';
  let s = ch.root;
  const paren = [];

  if (ch.third === null) {
    s += '5';
  } else if (ch.seventh === 'd7' && ch.third === 'm' && ch.fifth === 'b5') {
    s += '°';
  } else {
    if (ch.third === 'm') s += 'm';
    const augTriad = ch.fifth === '#5' && !ch.seventh && ch.third === 'M';
    if (augTriad) s += '+';
    if (ch.seventh === 'm7') s += '7';
    else if (ch.seventh === 'M7') s += '7M';
    else if (ch.seventh === '6') s += '6';
    else if (ch.seventh === 'd7') s += '7';
    if (ch.third === 'sus4') s += 'sus4';
    if (ch.third === 'sus2') s += 'sus2';
    if (ch.fifth === 'b5') paren.push('b5');
    if (ch.fifth === '#5' && !augTriad) paren.push('#5');
  }
  paren.push(...ch.tensions);
  if (paren.length) s += `(${paren.join('/')})`;
  if (ch.bass) s += `/${ch.bass}`;
  return s;
}

/** Normaliza qualquer cifra aceita para o texto canônico. Lança ChordError. */
export function canonicalChord(input) {
  return formatChord(parseChord(input));
}

/** Intervalos (semitons acima da fundamental) em ordem de prioridade de voicing. */
export function chordIntervals(ch) {
  const out = [0];
  if (ch.third) out.push(THIRD_INTERVAL[ch.third]);
  if (ch.seventh) out.push(SEVENTH_INTERVAL[ch.seventh]);
  for (const t of ch.tensions) out.push(TENSION_INTERVAL[t]);
  out.push(FIFTH_INTERVAL[ch.fifth]);
  return out;
}

export function chordRootPc(ch) {
  return parseNoteName(ch.root).pc;
}

export function chordBassPc(ch) {
  return parseNoteName(ch.bass ?? ch.root).pc;
}
