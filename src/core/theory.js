// Teoria básica: nomes de notas, tonalidades, armaduras e grafia enarmônica.

export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
export const NATURAL_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const LETTER_FIFTHS = { F: -1, C: 0, G: 1, D: 2, A: 3, E: 4, B: 5 };

const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];

// Grafia das notas cromáticas relativa à tônica: semitom → [grau (0-6), alteração].
const CHROMATIC = {
  major: { 1: [1, -1], 3: [2, -1], 6: [3, +1], 8: [5, -1], 10: [6, -1] },
  minor: { 1: [1, -1], 4: [2, +1], 6: [3, +1], 9: [5, +1], 11: [6, +1] },
};

const mod = (n, m) => ((n % m) + m) % m;

/** "Bb" → { letter: 'B', acc: -1, pc: 10 }. Aceita #, b, ♯, ♭ (até duplos). */
export function parseNoteName(name) {
  const m = /^([A-Ga-g])(##|bb|#|b|♯|♭)?$/.exec(String(name).trim());
  if (!m) throw new Error(`Nome de nota inválido: "${name}"`);
  const letter = m[1].toUpperCase();
  const accStr = (m[2] || '').replace('♯', '#').replace('♭', 'b');
  const acc = accStr.startsWith('#') ? accStr.length : -accStr.length;
  return { letter, acc, pc: mod(NATURAL_PC[letter] + acc, 12) };
}

export function accidentalString(acc) {
  return acc > 0 ? '#'.repeat(acc) : 'b'.repeat(-acc);
}

export function noteNameString({ letter, acc }) {
  return letter + accidentalString(acc);
}

/** Número de acidentes da armadura (+ sustenidos, − bemóis). */
export function keyFifths(key) {
  const { letter, acc } = parseNoteName(key.tonic);
  const major = LETTER_FIFTHS[letter] + 7 * acc;
  return key.mode === 'minor' ? major - 3 : major;
}

export function isValidKey(key) {
  if (!key || (key.mode !== 'major' && key.mode !== 'minor')) return false;
  try {
    return Math.abs(keyFifths(key)) <= 7;
  } catch {
    return false;
  }
}

/** Escala diatônica soletrada: 7 × { letter, acc, pc }. */
export function scaleOf(key) {
  const tonic = parseNoteName(key.tonic);
  const steps = key.mode === 'minor' ? MINOR_STEPS : MAJOR_STEPS;
  const li = LETTERS.indexOf(tonic.letter);
  return steps.map((step, k) => {
    const letter = LETTERS[(li + k) % 7];
    const pc = mod(tonic.pc + step, 12);
    const acc = mod(pc - NATURAL_PC[letter] + 6, 12) - 6;
    return { letter, acc, pc };
  });
}

/** Classes de altura da escala (para o travamento de escala na entrada). */
export function scalePitchClasses(key) {
  return scaleOf(key).map((n) => n.pc);
}

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** Soletra uma classe de altura (0–11) de acordo com a tonalidade. */
export function spellPitchClass(pc, key) {
  const scale = scaleOf(key);
  const diatonic = scale.find((n) => n.pc === pc);
  if (diatonic) return { letter: diatonic.letter, acc: diatonic.acc };
  const rel = mod(pc - scale[0].pc, 12);
  const [degree, delta] = CHROMATIC[key.mode][rel];
  const base = scale[degree];
  const acc = base.acc + delta;
  if (Math.abs(acc) <= 1) return { letter: base.letter, acc };
  // Evita dobrados (tons extremos): grafia simples na direção da armadura.
  const simple = parseNoteName((keyFifths(key) < 0 ? FLAT_NAMES : SHARP_NAMES)[pc]);
  return { letter: simple.letter, acc: simple.acc };
}

/** Soletra uma nota MIDI: { letter, acc, octave } (oitava científica, C4 = 60). */
export function spellMidi(midi, key) {
  const { letter, acc } = spellPitchClass(mod(midi, 12), key);
  const natural = midi - acc;
  return { letter, acc, octave: Math.floor(natural / 12) - 1 };
}

/** Nome curto da tonalidade para arquivos: "Am", "Bb", "F#m". */
export function keyShortName(key) {
  return key.tonic + (key.mode === 'minor' ? 'm' : '');
}
