// Desenho compartilhado pelas grades (piano-roll e bateria).

import { cssVar } from '../ui.js';
import { chordSpans, stepsPerBar } from '../../src/core/project.js';

let palette = null;
export function colors() {
  if (!palette) {
    palette = Object.fromEntries(
      ['bg', 'panel', 'panel-2', 'line', 'line-strong', 'text', 'muted', 'accent', 'lead', 'lead2', 'chords', 'bass', 'drums']
        .map((k) => [k, cssVar(`--${k}`)]),
    );
  }
  return palette;
}

export function alpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Linhas verticais (step/tempo/compasso) e destaque do compasso selecionado. */
export function drawColumns(g, v, { ts, selectedBar }) {
  const c = colors();
  const bar = stepsPerBar(ts);
  const top = v.rulerH;
  if (selectedBar !== null && selectedBar !== undefined) {
    const x0 = Math.max(v.headerW, v.x(selectedBar * bar));
    const x1 = v.x((selectedBar + 1) * bar);
    if (x1 > x0) {
      g.fillStyle = alpha(c.accent, 0.08);
      g.fillRect(x0, top, x1 - x0, v.height - top);
    }
  }
  for (let s = v.firstStep; s <= v.lastStep; s++) {
    const x = Math.round(v.x(s)) + 0.5;
    if (x < v.headerW) continue;
    g.strokeStyle = s % bar === 0 ? c['line-strong'] : s % 4 === 0 ? c.line : alpha(c.line, 0.45);
    g.lineWidth = s % bar === 0 ? 1.5 : 1;
    g.beginPath();
    g.moveTo(x, top);
    g.lineTo(x, v.height);
    g.stroke();
  }
}

/** Régua: números de compasso + cifras da seção. */
export function drawRuler(g, v, { section, ts, selectedBar }) {
  const c = colors();
  const bar = stepsPerBar(ts);
  g.fillStyle = c.panel;
  g.fillRect(0, 0, v.width, v.rulerH);
  g.textBaseline = 'middle';
  for (let b = 0; b * bar < v.lastStep + bar; b++) {
    const x = v.x(b * bar);
    if (x + bar * v.stepW < v.headerW || x > v.width) continue;
    if (b === selectedBar) {
      g.fillStyle = alpha(c.accent, 0.25);
      g.fillRect(Math.max(v.headerW, x), 0, bar * v.stepW, v.rulerH);
    }
    g.fillStyle = b === selectedBar ? c.accent : c.muted;
    g.font = '600 12px system-ui, sans-serif';
    if (x + 4 >= v.headerW) g.fillText(String(b + 1), x + 4, v.rulerH * 0.3);
  }
  let spans = [];
  try { spans = chordSpans(section, ts); } catch { /* cifra inválida não quebra o desenho */ }
  g.font = '700 13px system-ui, sans-serif';
  for (const s of spans) {
    const x = v.x(s.pos);
    if (x + 60 < v.headerW || x > v.width) continue;
    g.fillStyle = s.chord.nc ? c.muted : c.chords;
    if (x + 4 >= v.headerW) g.fillText(s.symbol, x + 4, v.rulerH * 0.72);
  }
  g.strokeStyle = c.line;
  g.beginPath();
  g.moveTo(0, v.rulerH - 0.5);
  g.lineTo(v.width, v.rulerH - 0.5);
  g.stroke();
}

export function drawHeaderBg(g, v) {
  const c = colors();
  g.fillStyle = c.panel;
  g.fillRect(0, v.rulerH, v.headerW, v.height - v.rulerH);
  g.strokeStyle = c.line;
  g.beginPath();
  g.moveTo(v.headerW - 0.5, 0);
  g.lineTo(v.headerW - 0.5, v.height);
  g.stroke();
}

export function drawCorner(g, v, text) {
  const c = colors();
  g.fillStyle = c.panel;
  g.fillRect(0, 0, v.headerW, v.rulerH);
  g.fillStyle = c.text;
  g.font = '600 12px system-ui, sans-serif';
  g.textBaseline = 'middle';
  const label = text.length > 10 ? `${text.slice(0, 9)}…` : text;
  g.fillText(label, 8, v.rulerH / 2);
}

export function drawPlayhead(g, v, step) {
  if (step === null || step === undefined) return;
  const x = v.x(step);
  if (x < v.headerW || x > v.width) return;
  g.strokeStyle = colors().accent;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(x, 0);
  g.lineTo(x, v.height);
  g.stroke();
}

export function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r);
  else g.rect(x, y, w, h);
}
