// Utilitários de interface: criação de elementos, ícones, toast, folha inferior.

/** h('button.primary', { onclick }, 'Texto', filho...) */
export function h(tag, props = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const ICONS = {
  play: '<path d="M7 4.5v15l13-7.5z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  undo: '<path d="M8 7V3L2 9l6 6v-4h7a4 4 0 0 1 0 8h-3v3h3a7 7 0 0 0 0-14z"/>',
  redo: '<path d="M16 7V3l6 6-6 6v-4H9a4 4 0 0 0 0 8h3v3H9A7 7 0 0 1 9 7z"/>',
  loop: '<path d="M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z"/>',
  song: '<path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h10v2H4z"/>',
  metro: '<path d="M10 2h4l5 20H5zm1.5 2-1 4h3l-1-4zm-2 8-1.8 8h10.6L15.5 12z"/>',
  plus: '<path d="M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z"/>',
  minus: '<path d="M4 11h16v2H4z"/>',
  lock: '<path d="M7 10V7a5 5 0 0 1 10 0v3h1a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1zm2 0h6V7a3 3 0 0 0-6 0z"/>',
  up: '<path d="M12 6l-7 7h14z"/>',
  left: '<path d="M8 12l7-7v14z"/>',
  right: '<path d="M16 12l-7 7V5z"/>',
  cloud: '<path d="M19 18H6.5a4.5 4.5 0 0 1-.7-8.95A6 6 0 0 1 17.4 8.1 5 5 0 0 1 19 18z"/>',
  close: '<path d="M6 4.6 12 10.6l6-6L19.4 6l-6 6 6 6-1.4 1.4-6-6-6 6L4.6 18l6-6-6-6z"/>',
};

export function icon(name) {
  const span = document.createElement('span');
  span.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
  return span.firstChild;
}

let toastTimer = null;
export function toast(message, { error = false, ms = 2600 } = {}) {
  document.querySelector('.toast')?.remove();
  const el = h(`div.toast${error ? '.error' : ''}`, { role: 'status' }, message);
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), error ? ms * 2 : ms);
}

/** Abre uma folha inferior. `build(close)` devolve o conteúdo. */
export function openSheet(build) {
  const backdrop = h('div.sheet-backdrop');
  const sheet = h('div.sheet', { role: 'dialog' });
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  backdrop.addEventListener('pointerdown', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey);
  sheet.append(build(close));
  backdrop.append(sheet);
  document.body.append(backdrop);
  return close;
}

export const isIOS = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const TRACKS = [
  { key: 'lead', label: 'Lead', color: 'var(--lead)' },
  { key: 'lead2', label: 'Lead2', color: 'var(--lead2)' },
  { key: 'chords', label: 'Acordes', color: 'var(--chords)' },
  { key: 'bass', label: 'Baixo', color: 'var(--bass)' },
  { key: 'drums', label: 'Bateria', color: 'var(--drums)' },
];

export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
