// Trilha de acordes: um cartão por compasso, um botão por tempo. Seletor de cifra em folha.

import { h, openSheet, toast } from '../ui.js';
import { findSection, setChord } from '../../src/core/edit.js';
import { canonicalChord, parseChord } from '../../src/core/chords.js';
import { chordSpans, sectionLength, stepsPerBar, STEPS_PER_BEAT } from '../../src/core/project.js';
import { noteNameString, scaleOf, spellPitchClass } from '../../src/core/theory.js';
import { voiceChord } from '../../src/core/voicing.js';

const QUALITIES = [
  ['maior', ''], ['m', 'm'], ['7', '7'], ['7M', '7M'], ['m7', 'm7'], ['m7M', 'm7M'], ['6', '6'], ['m6', 'm6'],
  ['m7(b5)', 'm7(b5)'], ['°', '°'], ['+', '+'], ['sus4', 'sus4'], ['7sus4', '7sus4'], ['sus2', 'sus2'], ['5', '5'],
];
const TENSIONS = ['b9', '9', '#9', '11', '#11', 'b13', '13'];

const DIATONIC = {
  major: {
    romans: ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii'],
    triads: ['', 'm', 'm', '', '', 'm', 'm(b5)'],
    tetrads: ['7M', 'm7', 'm7', '7M', '7', 'm7', 'm7(b5)'],
    extras: [],
  },
  minor: {
    romans: ['i', 'ii', 'III', 'iv', 'v', 'VI', 'VII'],
    triads: ['m', 'm(b5)', '', 'm', 'm', '', ''],
    tetrads: ['m7', 'm7(b5)', '7M', 'm7', 'm7', '7M', '7'],
    // Dominante e diminuto da menor harmônica (semitons acima da tônica).
    extras: [[7, '', 'V'], [7, '7', 'V7'], [11, '°', 'vii°']],
  },
};

const pretty = (s) => s.replace(/^([A-G])b/, '$1♭').replace(/\/([A-G])b/, '/$1♭').replace(/b(?=\d)/g, '♭').replace(/#/g, '♯');

export function createChords(host, { store, audio }) {
  const list = h('div.chord-list');
  host.append(list);
  let playStep = null;

  const section = () => findSection(store.project, store.ui.sectionId);
  const ts = () => store.project.settings.timeSignature;

  function render() {
    const sec = section();
    const beats = ts()[0];
    const bar = stepsPerBar(ts());
    const bars = sectionLength(sec, ts()) / bar;
    let spans = [];
    try { spans = chordSpans(sec, ts()); } catch { /* ignora inválidos */ }
    const at = new Map(spans.map((s) => [s.pos, s]));
    const covering = (pos) => spans.find((s) => pos > s.pos && pos < s.end && !s.chord.nc);

    list.replaceChildren(...Array.from({ length: bars }, (_, b) => {
      const slots = Array.from({ length: beats }, (_, beat) => {
        const pos = b * bar + beat * STEPS_PER_BEAT;
        const here = at.get(pos);
        const hold = !here && covering(pos);
        const playing = playStep !== null && playStep >= pos && playStep < pos + STEPS_PER_BEAT;
        const cls = here ? '.has' : hold ? '.hold' : '.empty';
        return h(`button.slot${cls}${playing ? '.playing' : ''}`, {
          title: `Compasso ${b + 1}, tempo ${beat + 1}`,
          onclick: () => openChordPicker({ store, audio, pos, label: `Compasso ${b + 1} · tempo ${beat + 1}` }),
        }, here ? pretty(here.symbol) : hold ? '—' : '·');
      });
      return h(`div.bar-card${store.ui.selectedBar === b ? '.selected' : ''}`, {},
        h('div.bar-head', {},
          h('span', {}, `Compasso ${b + 1}`),
          h(`button.ghost${store.ui.selectedBar === b ? '.on' : ''}`, {
            onclick: () => store.setUi({ selectedBar: store.ui.selectedBar === b ? null : b }),
          }, store.ui.selectedBar === b ? 'Selecionado' : 'Selecionar')),
        h('div.slots', { style: { gridTemplateColumns: `repeat(${beats}, 1fr)` } }, slots));
    }));
  }

  render();
  return {
    update: render,
    setPlayhead(step) {
      const beatStart = step === null ? null : Math.floor(step / STEPS_PER_BEAT) * STEPS_PER_BEAT;
      if (beatStart === playStep) return;
      playStep = beatStart;
      render();
    },
    destroy() { list.remove(); },
  };
}

/** Folha de escolha de cifra para o tempo `pos` da seção atual. */
export function openChordPicker({ store, audio, pos, label }) {
  const key = store.project.settings.key;
  const sec = findSection(store.project, store.ui.sectionId);
  const existing = sec.chords.find((c) => c.pos === pos)?.symbol ?? '';
  const scale = scaleOf(key);
  const rootNames = Array.from({ length: 12 }, (_, pc) => noteNameString(spellPitchClass(pc, key)));

  const state = { root: noteNameString(scale[0]), quality: '', tensions: new Set(), bass: null };
  try {
    const ch = parseChord(existing);
    if (!ch.nc) {
      state.root = ch.root;
      state.bass = ch.bass;
      state.tensions = new Set(ch.tensions);
      const match = QUALITIES.find(([, q]) => {
        try {
          const qc = parseChord(ch.root + q);
          return qc.third === ch.third && qc.fifth === ch.fifth && qc.seventh === ch.seventh;
        } catch { return false; }
      });
      if (match) state.quality = match[1];
    }
  } catch { /* vazio ou inválido: começa do padrão */ }

  openSheet((close) => {
    const input = h('input', { type: 'text', value: existing, autocapitalize: 'off', autocomplete: 'off', spellcheck: false, placeholder: 'ex.: Am7(9)' });
    const error = h('div.chord-error');
    const builder = h('div');

    const valid = () => {
      try {
        const canon = canonicalChord(input.value);
        error.textContent = '';
        return canon;
      } catch (e) {
        error.textContent = input.value.trim() ? e.message : '';
        return null;
      }
    };

    const audition = (text) => {
      try {
        const ch = parseChord(text);
        if (!ch.nc) {
          audio.unlock();
          audio.previewChord(voiceChord(ch));
        }
      } catch { /* inválido: sem som */ }
    };

    const fromBuilder = () => {
      const t = [...state.tensions];
      const raw = `${state.root}${state.quality}${t.length ? `(${t.join('/')})` : ''}${state.bass ? `/${state.bass}` : ''}`;
      try {
        input.value = canonicalChord(raw);
      } catch {
        input.value = raw;
      }
      valid();
      audition(input.value);
      renderBuilder();
    };

    const apply = (symbol) => {
      try {
        store.edit((p) => setChord(findSection(p, store.ui.sectionId), pos, symbol));
        close();
      } catch (e) {
        error.textContent = e.message;
      }
    };

    const chip = (text, sub, on, onclick) => h(`button${on ? '.on' : ''}`, { onclick }, pretty(text), sub ? h('small', {}, sub) : null);

    function renderBuilder() {
      const d = DIATONIC[key.mode];
      const name = (i, q) => canonicalChord(noteNameString(scale[i]) + q);
      const diatonicChip = (sym, roman) => chip(sym, roman, input.value === sym, () => {
        input.value = sym;
        const ch = parseChord(sym);
        Object.assign(state, { root: ch.root, tensions: new Set(), bass: null });
        state.quality = QUALITIES.find(([, q]) => canonicalChord(ch.root + q) === sym)?.[1] ?? state.quality;
        valid();
        audition(sym);
        renderBuilder();
      });
      builder.replaceChildren(
        h('h4', {}, 'Da tonalidade'),
        h('div.chip-grid.diatonic', {}, d.triads.map((q, i) => diatonicChip(name(i, q), d.romans[i]))),
        h('div.chip-grid.diatonic', { style: { marginTop: '6px' } },
          d.tetrads.map((q, i) => diatonicChip(name(i, q), `${d.romans[i]}7`)),
          d.extras.map(([semi, q, roman]) => diatonicChip(
            canonicalChord(noteNameString(spellPitchClass((scale[0].pc + semi) % 12, key)) + q), roman))),
        h('h4', {}, 'Fundamental'),
        h('div.chip-grid', {}, rootNames.map((n) => chip(n, null, state.root === n, () => { state.root = n; fromBuilder(); }))),
        h('h4', {}, 'Tipo'),
        h('div.chip-grid', {}, QUALITIES.map(([lbl, q]) => chip(lbl, null, state.quality === q, () => { state.quality = q; fromBuilder(); }))),
        h('h4', {}, 'Tensões'),
        h('div.chip-grid', {}, TENSIONS.map((t) => chip(t, null, state.tensions.has(t), () => {
          if (state.tensions.has(t)) state.tensions.delete(t);
          else state.tensions.add(t);
          fromBuilder();
        }))),
        h('h4', {}, 'Baixo (inversão)'),
        h('div.chip-grid', {},
          chip('—', null, !state.bass, () => { state.bass = null; fromBuilder(); }),
          rootNames.map((n) => chip(`/${n}`, null, state.bass === n, () => { state.bass = n; fromBuilder(); }))),
      );
    }

    input.addEventListener('input', valid);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const canon = valid();
        if (canon) apply(canon);
      }
    });
    renderBuilder();

    return h('div', {},
      h('h3', {}, label),
      h('div.chord-preview', {},
        input,
        h('button', { onclick: () => { if (valid()) audition(input.value); } }, 'Ouvir')),
      error,
      builder,
      h('div.sheet-actions', {},
        h('button.danger', { onclick: () => apply(null), disabled: !existing }, 'Remover'),
        h('button', { onclick: () => apply('N.C.') }, 'N.C.'),
        h('span.spacer'),
        h('button', { onclick: close }, 'Cancelar'),
        h('button.primary', {
          onclick: () => {
            const canon = valid();
            if (canon) apply(canon);
            else if (!input.value.trim()) toast('Escolha ou digite uma cifra.');
          },
        }, 'OK')),
    );
  });
}
