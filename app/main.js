// MZK Composer — app principal: barra superior, ferramentas da trilha, telas, abas, reprodução.

import { createStore } from './store.js';
import { createSync } from './sync.js';
import { AudioEngine } from './audio.js';
import { h, icon, isIOS, openSheet, toast, TRACKS } from './ui.js';
import { createPianoRoll } from './views/pianoroll.js';
import { createDrums } from './views/drums.js';
import { createChords } from './views/chords.js';
import { createProjectView } from './views/project.js';
import {
  addSection, BASS_PRESETS, clearBar, copyBar, deleteSection, duplicateSection, findSection, generateBass, pasteBar,
  renameSection, setSectionBars,
} from '../src/core/edit.js';
import {
  expandArrangement, fileBaseName, MAX_SECTION_BARS, newProject, sectionLength, stepsPerBar, validateProject,
} from '../src/core/project.js';
import { buildTimeline, occurrencesFor } from '../src/core/timeline.js';
import { buildMidi } from '../src/core/midi.js';

const store = await createStore();
const sync = createSync(store);
const audio = new AudioEngine();
const app = document.getElementById('app');

const NOTE_LENGTHS = [[1, '1/16'], [2, '1/8'], [4, '1/4'], [8, '1/2'], [16, '1']];
const MELODIC = new Set(['lead', 'lead2', 'bass']);
const TAB_KEYS = ['lead', 'lead2', 'chords', 'bass', 'drums', 'project'];

// ---------- desbloqueio do áudio (iOS exige gesto do usuário) ----------
for (const ev of ['pointerdown', 'touchend', 'keydown']) {
  window.addEventListener(ev, () => audio.unlock(), { capture: true, passive: true });
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden && audio.playing) stop();
});

// ---------- esqueleto ----------
const topbar = h('header.topbar');
const sectionStrip = h('div.sections');
const toolbar = h('div.toolbar');
const viewHost = h('main.view');
const tabs = h('nav.tabs');
app.append(topbar, sectionStrip, toolbar, viewHost, tabs);

let view = null;
let viewTab = null;

function mountView() {
  const tab = store.ui.tab;
  if (view && viewTab === tab) return;
  view?.destroy();
  viewHost.replaceChildren();
  viewTab = tab;
  const deps = { store, audio, files, sync };
  if (MELODIC.has(tab)) {
    const gridHost = h('div.grid-host');
    viewHost.append(gridHost);
    if (matchMedia('(pointer: coarse)').matches) viewHost.append(h('div.hint', {}, '1 dedo edita · 2 dedos rolam'));
    view = createPianoRoll(gridHost, { ...deps, track: tab });
  } else if (tab === 'drums') {
    const gridHost = h('div.grid-host');
    viewHost.append(gridHost);
    view = createDrums(gridHost, deps);
  } else if (tab === 'chords') {
    view = createChords(viewHost, deps);
  } else {
    view = createProjectView(viewHost, deps);
  }
}

// ---------- barra superior ----------
function renderTopbar() {
  const { project, ui } = store;
  topbar.replaceChildren(...[
    h(`button.play${ui.playing ? '.on' : ''}`, { title: 'Tocar / parar (espaço)', onclick: togglePlay }, icon(ui.playing ? 'stop' : 'play')),
    h(`button${ui.loopSection ? '' : '.on'}`, {
      title: ui.loopSection ? 'Tocando a seção em loop — toque para tocar a música inteira' : 'Tocando a música inteira — toque para loop da seção',
      onclick: () => store.setUi({ loopSection: !ui.loopSection }),
    }, icon(ui.loopSection ? 'loop' : 'song'), h('span.lbl', {}, ui.loopSection ? ' Seção' : ' Música')),
    h('span.bpm', {}, `♩=${project.settings.bpm}`),
    h(`button${ui.metronome ? '.on' : ''}`, { title: 'Metrônomo', onclick: () => store.setUi({ metronome: !ui.metronome }) }, icon('metro')),
    h('span.spacer'),
    syncIndicator(),
    h('button', { title: 'Desfazer (Ctrl+Z)', disabled: !store.canUndo, onclick: () => store.undo() }, icon('undo')),
    h('button', { title: 'Refazer (Ctrl+Shift+Z)', disabled: !store.canRedo, onclick: () => store.redo() }, icon('redo')),
  ].filter(Boolean));
}

const SYNC_LABEL = {
  idle: 'Sincronizado — toque para sincronizar agora',
  syncing: 'Sincronizando…',
  error: 'Erro na sincronização — toque para tentar de novo',
  offline: 'Sem internet — sincroniza quando voltar',
};

function syncIndicator() {
  const st = store.ui.sync ?? { state: 'off' };
  if (st.state === 'off') return null;
  return h(`button.sync.${st.state}`, {
    title: st.message || SYNC_LABEL[st.state],
    onclick: async () => {
      const r = await sync.run();
      if (r?.error) toast(r.error.message, { error: true });
      else if (r && !r.conflicts.length) toast(r.up || r.down ? `Sincronizado: ${r.up} enviado(s), ${r.down} recebido(s).` : 'Tudo sincronizado.');
    },
  }, icon('cloud'));
}

// ---------- faixa de partes (seções) ----------
function renderSections() {
  const { project, ui } = store;
  sectionStrip.hidden = ui.tab === 'project';
  if (sectionStrip.hidden) return;
  sectionStrip.replaceChildren(
    h('span.label', {}, 'Partes'),
    ...project.sections.map((s) => {
      const current = s.id === ui.sectionId;
      return h(`button.part${current ? '.on' : ''}`, {
        title: current ? 'Opções desta parte' : `Ir para ${s.name}`,
        onclick: () => (current ? openSectionOptions(s.id) : store.setUi({ sectionId: s.id, selectedBar: null })),
      }, s.name, h('small', {}, `${s.bars}`));
    }),
    h('button.part.add', {
      title: 'Nova parte',
      onclick: () => {
        const s = store.edit((p) => addSection(p));
        store.setUi({ sectionId: s.id, selectedBar: null });
        toast(`Parte ${s.name} criada (4 compassos) e colocada no fim do roteiro.`);
      },
    }, icon('plus')),
  );
  sectionStrip.querySelector('.part.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function openSectionOptions(id) {
  openSheet((close) => {
    const sec = findSection(store.project, id);
    const name = h('input', { type: 'text', value: sec.name });
    const bars = h('input', { type: 'number', min: 1, max: MAX_SECTION_BARS, value: sec.bars, inputmode: 'numeric' });
    const save = () => {
      const n = parseInt(bars.value, 10);
      if (!(n >= 1 && n <= MAX_SECTION_BARS)) { toast(`De 1 a ${MAX_SECTION_BARS} compassos.`, { error: true }); return; }
      if (n < sec.bars && !confirm(`Encurtar "${sec.name}" apaga o que estiver depois do compasso ${n}. Continuar?`)) return;
      store.edit((p) => {
        renameSection(p, id, name.value);
        setSectionBars(p, id, n);
      });
      close();
    };
    return h('div', {},
      h('h3', {}, `Parte ${sec.name}`),
      h('div.fields', {},
        h('div.field', {}, h('label', {}, 'Nome'), name),
        h('div.field', {}, h('label', {}, 'Compassos'), bars)),
      h('p.muted', {}, 'A ordem em que as partes tocam fica no Roteiro, na aba Projeto.'),
      h('div.sheet-actions', {},
        h('button', {
          onclick: () => {
            const copy = store.edit((p) => duplicateSection(p, id));
            store.setUi({ sectionId: copy.id });
            toast(`Cópia criada: ${copy.name}`);
            close();
          },
        }, 'Duplicar'),
        h('button.danger', {
          disabled: store.project.sections.length <= 1,
          onclick: () => {
            if (!confirm(`Apagar a parte "${sec.name}" e tirá-la do roteiro?`)) return;
            store.edit((p) => deleteSection(p, id));
            close();
          },
        }, 'Apagar'),
        h('span.spacer'),
        h('button', { onclick: close }, 'Cancelar'),
        h('button.primary', { onclick: save }, 'OK')));
  });
}

// ---------- ferramentas da trilha ----------
function barTools(track) {
  const { ui } = store;
  if (ui.selectedBar === null) return [h('span.label', {}, 'Toque no número do compasso para copiar/colar')];
  const b = ui.selectedBar;
  const ts = store.project.settings.timeSignature;
  return [
    h('span.label', {}, `Compasso ${b + 1}:`),
    h('button', {
      onclick: () => {
        store.setUi({ clipboard: copyBar(findSection(store.project, ui.sectionId), track, b, ts) });
        toast(`Compasso ${b + 1} copiado.`);
      },
    }, 'Copiar'),
    h('button', {
      disabled: !ui.clipboard || ui.clipboard.track !== track,
      onclick: () => store.edit((p) => pasteBar(findSection(p, ui.sectionId), b, ui.clipboard, ts)),
    }, 'Colar'),
    h('button.danger', { onclick: () => store.edit((p) => clearBar(findSection(p, ui.sectionId), track, b, ts)) }, 'Limpar'),
  ];
}

function muteSolo(track) {
  const { ui } = store;
  return h('div.group', {},
    h(`button${ui.mute[track] ? '.on' : ''}`, { title: 'Mudo', onclick: () => store.setUi({ mute: { ...ui.mute, [track]: !ui.mute[track] } }) }, 'M'),
    h(`button${ui.solo[track] ? '.on' : ''}`, { title: 'Solo', onclick: () => store.setUi({ solo: { ...ui.solo, [track]: !ui.solo[track] } }) }, 'S'));
}

function zoomTools() {
  const z = store.ui.zoom;
  return h('div.group', {},
    h('button', { title: 'Afastar', disabled: z <= 0.5, onclick: () => store.setUi({ zoom: Math.max(0.5, +(z - 0.25).toFixed(2)) }) }, icon('minus')),
    h('button', { title: 'Aproximar', disabled: z >= 2, onclick: () => store.setUi({ zoom: Math.min(2, +(z + 0.25).toFixed(2)) }) }, icon('plus')));
}

function openBassGenerator() {
  openSheet((close) => h('div', {},
    h('h3', {}, 'Gerar baixo a partir dos acordes'),
    h('p.muted', {}, 'Substitui o baixo desta seção (dá para desfazer). Usa o baixo da cifra invertida quando houver (C/E → Mi).'),
    h('div.chip-grid', {}, Object.entries(BASS_PRESETS).map(([k, label]) => h(`button${store.ui.bassPreset === k ? '.on' : ''}`, {
      onclick: () => {
        const sec = findSection(store.project, store.ui.sectionId);
        if (!sec.chords.length) { toast('Esta seção ainda não tem acordes.', { error: true }); return; }
        store.edit((p) => generateBass(findSection(p, store.ui.sectionId), p.settings.timeSignature, k));
        store.setUi({ bassPreset: k });
        close();
      },
    }, label))),
    h('div.sheet-actions', {}, h('span.spacer'), h('button', { onclick: close }, 'Fechar'))));
}

function renderToolbar() {
  const { ui } = store;
  const tab = ui.tab;
  toolbar.hidden = tab === 'project';
  if (tab === 'project') return;
  const parts = [];
  if (MELODIC.has(tab)) {
    parts.push(
      h('div.group', {}, NOTE_LENGTHS.map(([steps, label]) => h(`button${ui.noteLength === steps ? '.on' : ''}`, {
        title: 'Duração das notas novas', onclick: () => store.setUi({ noteLength: steps }),
      }, label))),
      h(`button${ui.scaleLock ? '.on' : ''}`, { title: 'Mostrar só as notas da escala', onclick: () => store.setUi({ scaleLock: !ui.scaleLock }) }, icon('lock'), ' Escala'),
      zoomTools(),
    );
    if (tab === 'bass') parts.push(h('button', { onclick: openBassGenerator }, 'Gerar do acorde'));
  } else if (tab === 'drums') {
    parts.push(zoomTools(), h('span.label', {}, 'Toque: normal → acento → apaga'));
  } else if (tab === 'chords') {
    parts.push(h('span.label', {}, 'Toque num tempo para escolher a cifra'));
  }
  parts.push(muteSolo(tab), h('span.sep'), ...barTools(tab));
  toolbar.replaceChildren(...parts);
}

// ---------- abas ----------
function renderTabs() {
  const labels = { project: 'Projeto' };
  tabs.replaceChildren(...TAB_KEYS.map((k) => {
    const t = TRACKS.find((x) => x.key === k);
    const label = k === 'lead2' ? store.project.settings.lead2Name : t?.label ?? labels[k];
    return h(`button${store.ui.tab === k ? '.active' : ''}`, {
      style: { '--c': t?.color ?? 'var(--muted)' },
      onclick: () => setTab(k),
    }, h('span.dot'), h('span.name', {}, label));
  }));
}

function setTab(tab) {
  store.setUi({ tab, ...(tab !== 'project' ? { lastTrackTab: tab } : {}) });
}

// ---------- reprodução ----------
function currentTimeline() {
  const p = store.project;
  return buildTimeline(p, occurrencesFor(p, store.ui.loopSection ? store.ui.sectionId : null));
}

function playOpts() {
  const p = store.project;
  return { bpm: p.settings.bpm, loop: store.ui.loopSection, beatsPerBar: p.settings.timeSignature[0], metronome: store.ui.metronome };
}

function play() {
  audio.unlock();
  audio.setMix(store.ui);
  audio.onEnded = () => { store.setUi({ playing: false }); view?.setPlayhead(null); };
  audio.play(currentTimeline(), playOpts());
  store.setUi({ playing: true });
  requestAnimationFrame(followPlayhead);
}

function stop() {
  audio.stop();
  store.setUi({ playing: false });
  view?.setPlayhead(null);
}

function togglePlay() {
  if (audio.playing) stop();
  else play();
}

function followPlayhead() {
  if (!audio.playing) return;
  const pos = audio.position;
  if (pos !== null) {
    let local = pos;
    if (!store.ui.loopSection) {
      const p = store.project;
      const ts = p.settings.timeSignature;
      const occ = expandArrangement(p).find((o) => pos >= o.start && pos < o.start + sectionLength(o.section, ts));
      if (occ) {
        if (occ.section.id !== store.ui.sectionId) store.setUi({ sectionId: occ.section.id, selectedBar: null });
        local = pos - occ.start;
      }
    }
    view?.setPlayhead(local);
  }
  requestAnimationFrame(followPlayhead);
}

// Edições, troca de seção, BPM e metrônomo valem na hora, sem parar a música.
function syncPlayback(what) {
  audio.setMix(store.ui);
  if (!audio.playing || what === 'mix') return;
  audio.update(currentTimeline(), playOpts());
}

// ---------- arquivos ----------
function download(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function shareOrDownload(blob, name, type) {
  const file = new File([blob], name, { type });
  if (isIOS() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  download(blob, name);
}

async function readJsonFile() {
  const input = h('input', { type: 'file', accept: '.json,application/json' });
  const file = await new Promise((resolve) => {
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.click();
  });
  if (!file) return null;
  try {
    return JSON.parse(await file.text());
  } catch {
    throw new Error('Arquivo não é um JSON válido.');
  }
}

const fail = (e) => toast(e.message, { error: true });

const files = {
  async newProject() {
    try {
      await store.createProject(newProject({ id: store.nextId(), composers: store.project.meta.composers }));
      store.setUi({ tab: 'project' });
      toast(`Projeto ${store.project.meta.id} criado. Preencha título e tonalidade.`);
    } catch (e) { fail(e); }
  },
  async open() {
    try {
      const p = await readJsonFile();
      if (!p) return;
      const same = store.index.find((r) => r.id === p?.meta?.id);
      if (same && !confirm(`Já existe ${same.id} "${same.title}" neste aparelho.\nSubstituir pelo arquivo?`)) return;
      await store.importProject(p, { replaceKey: same?.key ?? null });
      toast(`Aberto: ${store.project.meta.title}`);
    } catch (e) { fail(e); }
  },
  async openKey(key) {
    try {
      if (audio.playing) stop();
      await store.openProject(key);
    } catch (e) { fail(e); }
  },
  async deleteKey(key) {
    const rec = store.index.find((r) => r.key === key);
    if (!rec || !confirm(`Apagar ${rec.id} "${rec.title}" deste aparelho?\nIsso não pode ser desfeito (salve o .json antes, se quiser guardar).`)) return;
    try {
      if (key === store.currentKey && audio.playing) stop();
      await store.deleteProject(key);
      toast('Projeto apagado.');
    } catch (e) { fail(e); }
  },
  saveJson() {
    const p = store.project;
    const blob = new Blob([`${JSON.stringify(p, null, 2)}\n`], { type: 'application/json' });
    shareOrDownload(blob, `${fileBaseName(p)}.json`, 'application/json');
  },
  exportMidi() {
    const p = store.project;
    const errors = validateProject(p);
    if (errors.length) { toast(`Corrija antes de exportar:\n- ${errors.slice(0, 4).join('\n- ')}`, { error: true }); return; }
    download(new Blob([buildMidi(p)], { type: 'audio/midi' }), `${fileBaseName(p)}.mid`);
  },
  async loadExample() {
    try {
      const res = await fetch('examples/MZK-0001_exemplo.json');
      const p = await res.json();
      p.meta.id = store.nextId(); // nunca colide com uma obra sua
      await store.createProject(p);
      toast(`Exemplo aberto como ${p.meta.id}.`);
    } catch (e) {
      toast(`Não foi possível abrir o exemplo: ${e.message}`, { error: true });
    }
  },
};

// ---------- teclado (desktop) ----------
window.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
  if (document.querySelector('.sheet-backdrop')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  else if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); store.undo(); }
  else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); store.redo(); }
  else if (!mod && /^[1-6]$/.test(e.key)) setTab(TAB_KEYS[Number(e.key) - 1]);
  else if (!mod && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    const secs = store.project.sections;
    const i = secs.findIndex((s) => s.id === store.ui.sectionId);
    const j = Math.max(0, Math.min(secs.length - 1, i + (e.key === 'ArrowLeft' ? -1 : 1)));
    store.setUi({ sectionId: secs[j].id, selectedBar: null });
  }
});

// ---------- ciclo de atualização ----------
function renderAll(what) {
  // Compasso selecionado fora da seção (após encurtar/trocar de seção) volta a nada.
  const sec = findSection(store.project, store.ui.sectionId);
  const bars = sectionLength(sec, store.project.settings.timeSignature) / stepsPerBar(store.project.settings.timeSignature);
  if (store.ui.selectedBar !== null && store.ui.selectedBar >= bars) store.ui.selectedBar = null;
  if (what === 'index') { // só a lista de projetos mudou (salvamento)
    view?.update(what);
    return;
  }
  if (what !== 'mix') {
    renderTopbar();
    renderSections();
    renderToolbar();
    renderTabs();
    mountView();
  }
  view?.update(what);
  syncPlayback(what);
}

store.subscribe(renderAll);
renderAll('init');

// ---------- app instalável / offline ----------
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker:', e));
}
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  store.setUi({ installPrompt: e });
});
window.addEventListener('appinstalled', () => store.setUi({ installPrompt: null }));
