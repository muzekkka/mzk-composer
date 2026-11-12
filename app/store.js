// Estado do app: projeto atual (com desfazer/refazer), lista de projetos salvos no
// aparelho (IndexedDB) e preferências de interface.

import { newProject, nextCatalogId, validateProject } from '../src/core/project.js';
import { newKey, openStorage, summarize } from './storage.js';

const HISTORY_LIMIT = 200;
const SAVE_DELAY = 400;
const UI_KEY = 'mzk.ui';
const CURRENT_KEY = 'mzk.current';
const LEGACY_PROJECT_KEY = 'mzk.project'; // versão anterior (etapa 2): um projeto só

// Preferências que valem a pena lembrar entre sessões neste aparelho.
const PERSISTED_UI = ['tab', 'noteLength', 'scaleLock', 'zoom', 'loopSection', 'metronome', 'volume', 'bassPreset'];

function lsGet(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function lsSet(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* indisponível: segue em memória */ }
}

function assertProject(p) {
  const errors = validateProject(p);
  if (errors.length) throw new Error(`Projeto inválido:\n- ${errors.slice(0, 6).join('\n- ')}`);
}

export async function createStore() {
  const storage = await openStorage();

  // Migra o projeto único da versão anterior para a lista.
  const legacy = lsGet(LEGACY_PROJECT_KEY);
  if (legacy && validateProject(legacy).length === 0) {
    const key = newKey();
    await storage.put({ key, project: legacy, updatedAt: Date.now() });
    lsSet(CURRENT_KEY, key);
  }
  lsSet(LEGACY_PROJECT_KEY, null);

  let index = summarize(await storage.all());
  let currentKey = lsGet(CURRENT_KEY);
  let project = null;
  if (currentKey) project = (await storage.get(currentKey))?.project ?? null;
  if (!project && index.length) {
    currentKey = index[0].key;
    project = (await storage.get(currentKey)).project;
  }
  if (!project) {
    currentKey = newKey();
    project = newProject({ id: 'MZK-0001' });
    await storage.put({ key: currentKey, project, updatedAt: Date.now() });
    index = summarize(await storage.all());
  }
  lsSet(CURRENT_KEY, currentKey);

  const saveListeners = new Set();
  const undoStack = [];
  const redoStack = [];
  const listeners = new Set();

  const ui = {
    tab: 'lead',
    sectionId: project.sections[0].id,
    noteLength: 2,
    scaleLock: true,
    zoom: 1,
    selectedBar: null,
    clipboard: null,
    loopSection: true,
    metronome: false,
    playing: false,
    mute: {},
    solo: {},
    volume: { lead: 0.8, lead2: 0.7, chords: 0.6, bass: 0.9, drums: 0.8 },
    bassPreset: 'quarters',
    ...Object.fromEntries(Object.entries(lsGet(UI_KEY) || {}).filter(([k]) => PERSISTED_UI.includes(k))),
  };

  const notify = (what) => {
    if (!project.sections.some((s) => s.id === ui.sectionId)) ui.sectionId = project.sections[0].id;
    for (const fn of listeners) fn(what);
  };

  // ---------- salvamento automático ----------
  let saveTimer = null;
  let dirty = false;
  async function flush() {
    clearTimeout(saveTimer);
    if (!dirty) return;
    dirty = false;
    const prev = await storage.get(currentKey);
    await storage.put({ ...prev, key: currentKey, project, updatedAt: Date.now() });
    index = summarize(await storage.all());
    notify('index');
    for (const fn of saveListeners) fn();
  }
  const scheduleSave = () => {
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, SAVE_DELAY);
  };
  // Ao sair/minimizar (iPhone), grava na hora.
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  window.addEventListener('pagehide', () => flush());

  const emit = (what) => {
    notify(what);
    if (what === 'project') scheduleSave();
    lsSet(UI_KEY, Object.fromEntries(PERSISTED_UI.map((k) => [k, ui[k]])));
  };

  function load(key, p) {
    currentKey = key;
    project = p;
    undoStack.length = 0;
    redoStack.length = 0;
    ui.sectionId = project.sections[0].id;
    ui.selectedBar = null;
    lsSet(CURRENT_KEY, key);
  }

  return {
    get project() { return project; },
    get currentKey() { return currentKey; },
    /** Lista de projetos do aparelho: [{ key, id, title, updatedAt }]. */
    get index() { return index; },
    get persistent() { return storage.persistent; },
    ui,
    get canUndo() { return undoStack.length > 0; },
    get canRedo() { return redoStack.length > 0; },

    /**
     * Aplica `fn(rascunho)`. Se lançar erro, nada muda. `merge: true` junta com a
     * última entrada do histórico (usado durante arrastos).
     */
    edit(fn, { merge = false } = {}) {
      const draft = structuredClone(project);
      const result = fn(draft);
      if (!merge || !undoStack.length) {
        undoStack.push(project);
        if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
      }
      redoStack.length = 0;
      project = draft;
      emit('project');
      return result;
    },

    undo() {
      if (!undoStack.length) return;
      redoStack.push(project);
      project = undoStack.pop();
      emit('project');
    },

    redo() {
      if (!redoStack.length) return;
      undoStack.push(project);
      project = redoStack.pop();
      emit('project');
    },

    /** Próximo ID de catálogo livre neste aparelho. */
    nextId() {
      return nextCatalogId([...index.map((r) => r.id), project.meta.id]);
    },

    /** Outro projeto do aparelho já usa este ID? */
    idTaken(id) {
      return index.some((r) => r.id === id && r.key !== currentKey);
    },

    async openProject(key) {
      await flush();
      const rec = await storage.get(key);
      if (!rec) throw new Error('Projeto não encontrado neste aparelho.');
      load(key, rec.project);
      notify('project');
    },

    /** Cria um projeto novo no aparelho e abre. */
    async createProject(p) {
      assertProject(p);
      await flush();
      const key = newKey();
      await storage.put({ key, project: p, updatedAt: Date.now() });
      index = summarize(await storage.all());
      load(key, p);
      notify('project');
    },

    /** Importa um .json: se o ID já existe neste aparelho, substitui aquele projeto. */
    async importProject(p, { replaceKey = null } = {}) {
      assertProject(p);
      if (!replaceKey) return this.createProject(p);
      await flush();
      const prev = await storage.get(replaceKey);
      await storage.put({ ...prev, key: replaceKey, project: p, updatedAt: Date.now() });
      index = summarize(await storage.all());
      load(replaceKey, p);
      notify('project');
    },

    async deleteProject(key) {
      await flush();
      const removed = await storage.get(key);
      await storage.remove(key);
      if (removed) this.onDelete?.(removed);
      index = summarize(await storage.all());
      if (key === currentKey) {
        if (index.length) {
          const rec = await storage.get(index[0].key);
          load(rec.key, rec.project);
        } else {
          const fresh = newProject({ id: 'MZK-0001', composers: project.meta.composers });
          const k = newKey();
          await storage.put({ key: k, project: fresh, updatedAt: Date.now() });
          index = summarize(await storage.all());
          load(k, fresh);
        }
        notify('project');
      } else {
        notify('index');
      }
    },

    flush,

    /** Avisado após cada salvamento no aparelho (a sincronização agenda o envio). */
    onSave(fn) {
      saveListeners.add(fn);
      return () => saveListeners.delete(fn);
    },

    /** Há edição ainda não gravada no aparelho? */
    get hasPendingSave() { return dirty; },

    // ---------- acesso para a sincronização ----------
    allRecords: () => storage.all(),

    /**
     * Identidade interna fixa do projeto (meta.uid), que sobrevive à troca do ID
     * de catálogo. Criada na primeira sincronização; não conta como edição.
     */
    async ensureUid(key) {
      const rec = await storage.get(key);
      if (rec.project.meta.uid) return rec.project.meta.uid;
      const uid = key;
      rec.project.meta.uid = uid;
      await storage.put(rec);
      if (key === currentKey) project.meta.uid = uid;
      return uid;
    },

    /** Atualiza só os metadados de sincronização (não toca no conteúdo). */
    async markSynced(key, sync) {
      const rec = await storage.get(key);
      if (!rec) return;
      await storage.put({ ...rec, sync });
    },

    /**
     * Substitui o conteúdo de um projeto pela versão da nuvem. Se for o projeto
     * aberto com edição ainda não gravada, não substitui (devolve false).
     */
    async applyRemote(key, remoteProject, sync) {
      if (key === currentKey && dirty) return false;
      const rec = await storage.get(key);
      const updatedAt = Date.now();
      await storage.put({ ...(rec || {}), key, project: remoteProject, updatedAt, sync: { ...sync, syncedAt: updatedAt } });
      index = summarize(await storage.all());
      if (key === currentKey) {
        const section = ui.sectionId;
        load(key, remoteProject);
        if (remoteProject.sections.some((s) => s.id === section)) ui.sectionId = section;
        notify('project');
      } else {
        notify('index');
      }
      return true;
    },

    /** Cria um projeto vindo da nuvem (sem abrir). */
    async addRemote(remoteProject, sync) {
      const key = newKey();
      const updatedAt = Date.now();
      await storage.put({ key, project: remoteProject, updatedAt, sync: { ...sync, syncedAt: updatedAt } });
      index = summarize(await storage.all());
      notify('index');
      return key;
    },

    /** Remove um projeto apagado em outro aparelho. */
    async removeRemoteDeleted(key) {
      if (key === currentKey) return false; // não some com o que está aberto
      await storage.remove(key);
      index = summarize(await storage.all());
      notify('index');
      return true;
    },

    /** `what` = 'ui' (redesenha) ou 'mix' (só áudio, ex.: arrastar volume). */
    setUi(patch, what = 'ui') {
      Object.assign(ui, patch);
      emit(what);
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
