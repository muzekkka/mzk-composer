// Piano-roll monofônico para Lead, Lead2 e Baixo.

import { GridCanvas } from '../grid.js';
import {
  alpha, colors, drawColumns, drawCorner, drawHeaderBg, drawPlayhead, drawRuler, roundRect,
} from './gridcommon.js';
import { addNote, findSection, noteIndexAt } from '../../src/core/edit.js';
import { sectionLength, stepsPerBar } from '../../src/core/project.js';
import { scalePitchClasses, spellMidi, accidentalString } from '../../src/core/theory.js';

const RANGES = {
  lead: { low: 48, high: 96, center: 72 },
  lead2: { low: 48, high: 96, center: 72 },
  bass: { low: 24, high: 60, center: 40 },
};
const GHOST = { lead: 'lead2', lead2: 'lead' };
const BASE_STEP_W = 24;
const scrollMemory = {};

export function createPianoRoll(host, { store, audio, track }) {
  const range = RANGES[track];
  let rows = [];
  let playStep = null;
  let drag = null;

  const section = () => findSection(store.project, store.ui.sectionId);
  const ts = () => store.project.settings.timeSignature;
  const key = () => store.project.settings.key;

  function computeRows() {
    const pcs = new Set(scalePitchClasses(key()));
    const out = [];
    for (let p = range.high; p >= range.low; p--) {
      if (!store.ui.scaleLock || pcs.has(p % 12)) out.push(p);
    }
    rows = out;
  }

  const rowOf = (pitch) => rows.indexOf(pitch);

  function draw(g, v) {
    const c = colors();
    const sec = section();
    const k = key();
    const tonicPc = scalePitchClasses(k)[0];
    const pcs = new Set(scalePitchClasses(k));
    g.fillStyle = c.bg;
    g.fillRect(0, 0, v.width, v.height);

    // Linhas horizontais
    for (let r = v.firstRow; r < v.lastRow; r++) {
      const p = rows[r];
      const y = v.y(r);
      if (p % 12 === tonicPc) g.fillStyle = alpha(c[track], 0.07);
      else if (!pcs.has(p % 12)) g.fillStyle = 'rgba(0,0,0,0.28)';
      else g.fillStyle = 'transparent';
      g.fillRect(v.headerW, y, v.width, v.rowH);
      g.strokeStyle = p % 12 === 0 ? c['line-strong'] : alpha(c.line, 0.6);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(v.headerW, Math.round(y + v.rowH) - 0.5);
      g.lineTo(v.width, Math.round(y + v.rowH) - 0.5);
      g.stroke();
    }
    drawColumns(g, v, { ts: ts(), selectedBar: store.ui.selectedBar });

    // Notas "fantasma" da outra linha melódica
    const ghost = GHOST[track];
    if (ghost) {
      g.strokeStyle = alpha(c[ghost], 0.55);
      g.lineWidth = 1.5;
      for (const n of sec[ghost]) {
        const r = rowOf(n.pitch);
        if (r < 0) continue;
        roundRect(g, v.x(n.pos) + 2, v.y(r) + 4, n.dur * v.stepW - 4, v.rowH - 8, 4);
        g.stroke();
      }
    }

    // Notas
    for (const n of sec[track]) {
      const r = rowOf(n.pitch);
      const x = v.x(n.pos) + 1;
      const w = n.dur * v.stepW - 2;
      if (x + w < v.headerW || x > v.width) continue;
      if (r < 0) {
        // Nota fora da escala com travamento ligado: marca na borda.
        g.fillStyle = alpha(c[track], 0.5);
        g.fillRect(x, v.rulerH, w, 3);
        continue;
      }
      const y = v.y(r) + 2;
      g.fillStyle = c[track];
      roundRect(g, x, y, w, v.rowH - 4, 5);
      g.fill();
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(x + w - 6, y + 4, 2, v.rowH - 12);
    }

    drawPlayhead(g, v, playStep);
    drawHeaderBg(g, v);

    // Rótulos das notas
    g.textBaseline = 'middle';
    for (let r = v.firstRow; r < v.lastRow; r++) {
      const p = rows[r];
      const y = v.y(r);
      if (y + v.rowH < v.rulerH) continue;
      const sp = spellMidi(p, k);
      const isC = p % 12 === 0;
      const inScale = pcs.has(p % 12);
      g.fillStyle = p % 12 === tonicPc ? c[track] : inScale ? c.text : c.muted;
      g.font = `${isC || p % 12 === tonicPc ? 700 : 400} 12px system-ui, sans-serif`;
      g.fillText(`${sp.letter}${accidentalString(sp.acc).replace('#', '♯').replace(/b/g, '♭')}${sp.octave}`, 8, y + v.rowH / 2);
    }

    drawRuler(g, v, { section: sec, ts: ts(), selectedBar: store.ui.selectedBar });
    drawCorner(g, v, sec.name);
  }

  // Durante o arrasto, cada passo recalcula a partir das notas do início do gesto
  // (sem a nota arrastada): passar por cima de outras notas não as apaga.
  function onDown(cell) {
    const sec = section();
    const pitch = rows[cell.row];
    const len = sectionLength(sec, ts());
    const idx = noteIndexAt(sec, track, cell.step, pitch);
    if (idx >= 0) {
      const n = sec[track][idx];
      const xInNote = (cell.fracStep - n.pos) * grid.o.stepW;
      const widthPx = n.dur * grid.o.stepW;
      const nearEnd = widthPx - xInNote < Math.max(14, Math.min(26, widthPx * 0.4));
      drag = {
        mode: nearEnd ? 'resize' : 'move', note: { ...n }, downStep: cell.step, moved: false, opened: false,
        base: sec[track].filter((_, i) => i !== idx).map((x) => ({ ...x })),
      };
      audio.preview(track, pitch);
      return;
    }
    const note = { pos: cell.step, dur: Math.min(store.ui.noteLength, len - cell.step), pitch };
    drag = { mode: 'create', note, downStep: cell.step, moved: false, opened: false, base: sec[track].map((x) => ({ ...x })) };
    place(drag, note);
    audio.preview(track, pitch);
  }

  function place(d, note) {
    const len = sectionLength(section(), ts());
    store.edit((p) => {
      const s = findSection(p, store.ui.sectionId);
      s[track] = d.base.map((x) => ({ ...x }));
      if (note) addNote(s, track, note, len);
    }, { merge: d.opened });
    d.opened = true;
  }

  function onMove(cell) {
    if (!drag) return;
    drag.moved = true;
    const len = sectionLength(section(), ts());
    const n = drag.note;
    let next;
    if (drag.mode === 'resize' || drag.mode === 'create') {
      next = { ...n, dur: Math.max(1, Math.min(len - n.pos, cell.step - n.pos + 1)) };
    } else {
      const orig = drag.orig ?? (drag.orig = { ...n });
      const pos = Math.max(0, Math.min(len - 1, orig.pos + cell.step - drag.downStep));
      next = { ...n, pos, pitch: rows[cell.row], dur: Math.min(orig.dur, len - pos) };
    }
    if (next.pos === n.pos && next.pitch === n.pitch && next.dur === n.dur) return;
    if (next.pitch !== n.pitch) audio.preview(track, next.pitch, 0.15);
    drag.note = next;
    place(drag, next);
  }

  function onUp(cell, info) {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (info.cancelled) return;
    if (d.mode === 'move' && !d.moved) {
      place(d, null); // toque simples numa nota: apaga
    } else if ((d.mode === 'resize' || d.mode === 'create') && d.moved) {
      store.setUi({ noteLength: d.note.dur }); // lembra a última duração usada
    }
  }

  function onRulerTap(step) {
    const bar = Math.floor(step / stepsPerBar(ts()));
    store.setUi({ selectedBar: store.ui.selectedBar === bar ? null : bar });
  }

  function onHeaderTap(row) {
    audio.unlock();
    audio.preview(track, rows[row]);
  }

  computeRows();
  const grid = new GridCanvas(host, {
    headerW: 54, rulerH: 40, rowH: 30, stepW: BASE_STEP_W * store.ui.zoom,
    rows: rows.length, steps: sectionLength(section(), ts()),
    draw, onDown, onMove, onUp, onRulerTap, onHeaderTap,
  });
  const mem = scrollMemory[track];
  if (mem) grid.scrollTo(mem.x, mem.y);
  else grid.centerRow(Math.max(0, rows.findIndex((p) => p <= range.center)));

  return {
    update() {
      const before = rows[Math.floor((grid.scrollY + grid.viewH / 2) / grid.o.rowH)];
      const oldLen = rows.length;
      computeRows();
      grid.set({ rows: rows.length, steps: sectionLength(section(), ts()), stepW: BASE_STEP_W * store.ui.zoom });
      if (oldLen !== rows.length && before !== undefined) {
        grid.centerRow(Math.max(0, rows.findIndex((p) => p <= before)));
      }
    },
    setPlayhead(step) {
      playStep = step;
      if (step !== null) grid.ensureStepVisible(step);
      grid.redraw();
    },
    destroy() {
      scrollMemory[track] = { x: grid.scrollX, y: grid.scrollY };
      grid.destroy();
    },
  };
}
