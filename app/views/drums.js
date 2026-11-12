// Step sequencer de bateria: toque alterna off → normal → acento; arrastar "pinta".

import { GridCanvas } from '../grid.js';
import {
  alpha, colors, drawColumns, drawCorner, drawHeaderBg, drawPlayhead, drawRuler, roundRect,
} from './gridcommon.js';
import { cycleDrum, findSection, setDrum } from '../../src/core/edit.js';
import { sectionLength, stepsPerBar, DRUM_PIECES } from '../../src/core/project.js';

export const DRUM_ROWS = ['crash', 'hhOpen', 'hhClosed', 'tomHigh', 'tomLow', 'clap', 'snare', 'kick'];
const BASE_STEP_W = 34;
let scrollMemory = null;

export function createDrums(host, { store, audio }) {
  let playStep = null;
  let paint = null;

  const section = () => findSection(store.project, store.ui.sectionId);
  const ts = () => store.project.settings.timeSignature;

  function draw(g, v) {
    const c = colors();
    const sec = section();
    g.fillStyle = c.bg;
    g.fillRect(0, 0, v.width, v.height);
    drawColumns(g, v, { ts: ts(), selectedBar: store.ui.selectedBar });

    const state = new Map(sec.drums.map((d) => [`${d.piece}:${d.pos}`, d.accent ? 'accent' : 'normal']));
    for (let r = v.firstRow; r < v.lastRow; r++) {
      const piece = DRUM_ROWS[r];
      const y = v.y(r);
      g.strokeStyle = alpha(c.line, 0.6);
      g.beginPath();
      g.moveTo(v.headerW, Math.round(y + v.rowH) - 0.5);
      g.lineTo(v.width, Math.round(y + v.rowH) - 0.5);
      g.stroke();
      for (let s = v.firstStep; s < v.lastStep; s++) {
        const x = v.x(s);
        const st = state.get(`${piece}:${s}`);
        const pad = 4;
        roundRect(g, x + pad, y + pad, v.stepW - pad * 2, v.rowH - pad * 2, 6);
        if (!st) {
          g.fillStyle = s % 4 === 0 ? alpha(c['line-strong'], 0.35) : alpha(c.line, 0.4);
          g.fill();
        } else {
          g.fillStyle = st === 'accent' ? c.drums : alpha(c.drums, 0.55);
          g.fill();
          if (st === 'accent') {
            g.fillStyle = 'rgba(0,0,0,0.45)';
            g.beginPath();
            g.arc(x + v.stepW / 2, y + v.rowH / 2, 3.5, 0, Math.PI * 2);
            g.fill();
          }
        }
      }
    }
    drawPlayhead(g, v, playStep);
    drawHeaderBg(g, v);
    g.textBaseline = 'middle';
    g.font = '500 13px system-ui, sans-serif';
    for (let r = v.firstRow; r < v.lastRow; r++) {
      g.fillStyle = c.text;
      g.fillText(DRUM_PIECES[DRUM_ROWS[r]].label, 8, v.y(r) + v.rowH / 2);
    }
    drawRuler(g, v, { section: sec, ts: ts(), selectedBar: store.ui.selectedBar });
    drawCorner(g, v, sec.name);
  }

  function onDown(cell) {
    const piece = DRUM_ROWS[cell.row];
    let result;
    store.edit((p) => { result = cycleDrum(findSection(p, store.ui.sectionId), piece, cell.step); });
    paint = { piece, state: result };
    if (result) audio.previewDrum(piece, result === 'accent');
  }

  function onMove(cell) {
    if (!paint) return;
    const piece = DRUM_ROWS[cell.row];
    if (piece !== paint.piece) return; // pinta só na mesma linha
    store.edit((p) => setDrum(findSection(p, store.ui.sectionId), piece, cell.step, paint.state), { merge: true });
  }

  function onUp() {
    paint = null;
  }

  function onRulerTap(step) {
    const bar = Math.floor(step / stepsPerBar(ts()));
    store.setUi({ selectedBar: store.ui.selectedBar === bar ? null : bar });
  }

  function onHeaderTap(row) {
    audio.unlock();
    audio.previewDrum(DRUM_ROWS[row]);
  }

  const grid = new GridCanvas(host, {
    headerW: 118, rulerH: 40, rowH: 46, stepW: BASE_STEP_W * store.ui.zoom,
    rows: DRUM_ROWS.length, steps: sectionLength(section(), ts()),
    draw, onDown, onMove, onUp, onRulerTap, onHeaderTap,
  });
  if (scrollMemory) grid.scrollTo(scrollMemory.x, scrollMemory.y);

  return {
    update() {
      grid.set({ steps: sectionLength(section(), ts()), stepW: BASE_STEP_W * store.ui.zoom });
    },
    setPlayhead(step) {
      playStep = step;
      if (step !== null) grid.ensureStepVisible(step);
      grid.redraw();
    },
    destroy() {
      scrollMemory = { x: grid.scrollX, y: grid.scrollY };
      grid.destroy();
    },
  };
}
