// Sincronização com um repositório privado do GitHub (API "contents").
// Cada projeto vira projects/MZK-0042.json; cada envio vira um commit (versão datada).
//
// Regras:
// - Só mudou aqui → envia. Só mudou lá → baixa.
// - Mudou nos dois (conflito) → a versão deste aparelho fica valendo e a outra é
//   guardada em projects/conflitos/ (nada se perde; o git também guarda o histórico).
// - Apagado aqui → apaga lá. Apagado lá e sem mudança aqui → some daqui.

import { validateProject } from '../src/core/project.js';
import { isIOS, toast } from './ui.js';

const CONFIG_KEY = 'mzk.sync';
const TOMBSTONES_KEY = 'mzk.sync.deleted';
const DEFAULT_API = 'https://api.github.com';
const DIR = 'projects';
const DEBOUNCE_MS = 30_000;

export class SyncError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function lsGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function lsSet(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* sem armazenamento */ }
}

export const loadConfig = () => lsGet(CONFIG_KEY, null);

function b64encode(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export const projectText = (p) => `${JSON.stringify(p, null, 2)}\n`;
export const pathFor = (p) => `${DIR}/${p.meta.id}.json`;
const device = () => (isIOS() ? 'iPhone' : 'computador');

/** Projeto recém-criado e nunca editado (pode dar lugar à versão da nuvem). */
export function isBlank(p) {
  return p.meta.title === 'Sem título'
    && p.sections.every((s) => !s.lead.length && !s.lead2.length && !s.chords.length && !s.bass.length && !s.drums.length);
}

/** Cliente mínimo da API do GitHub. */
export class GitHub {
  constructor({ repo, token, api = DEFAULT_API }) {
    this.repo = repo;
    this.token = token;
    this.api = api;
  }

  async #req(method, path, body) {
    let res;
    try {
      res = await fetch(`${this.api}/repos/${this.repo}${path ? `/${path}` : ''}`, {
        method,
        cache: 'no-store',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new SyncError('Sem conexão com o GitHub.', 0);
    }
    if (res.ok) return res.status === 204 ? null : res.json();
    if (res.status === 404 && method === 'GET' && path) return null;
    const detail = await res.json().catch(() => ({}));
    const msg = {
      401: 'Chave de acesso inválida ou expirada. Gere uma nova e cole aqui.',
      403: 'Sem permissão. A chave precisa de "Contents: Read and write" neste repositório.',
      404: 'Repositório não encontrado (confira o nome e se a chave tem acesso a ele).',
      409: 'Conflito de versão.',
      422: 'Conflito de versão.',
    }[res.status] ?? `Erro do GitHub (${res.status}): ${detail.message ?? ''}`;
    throw new SyncError(msg, res.status);
  }

  info() { return this.#req('GET', ''); }

  async list(dir) {
    const items = await this.#req('GET', `contents/${dir}`);
    return Array.isArray(items) ? items : [];
  }

  async get(path) {
    const f = await this.#req('GET', `contents/${path}`);
    return f && { sha: f.sha, text: b64decode(f.content) };
  }

  async put(path, text, sha, message) {
    const res = await this.#req('PUT', `contents/${path}`, { message, content: b64encode(text), ...(sha ? { sha } : {}) });
    return res.content.sha;
  }

  async remove(path, sha, message) {
    await this.#req('DELETE', `contents/${path}`, { message, sha });
  }
}

function stamp() {
  return new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
}

/**
 * Liga a sincronização ao store. Status em store.ui.sync:
 * { state: 'off'|'idle'|'syncing'|'error'|'offline', at, message }
 */
export function createSync(store) {
  let timer = null;
  let running = null;
  let again = false;

  const setStatus = (patch) => store.setUi({ sync: { ...store.ui.sync, ...patch } });
  const client = () => {
    const cfg = loadConfig();
    return cfg && new GitHub(cfg);
  };

  store.onDelete = (rec) => {
    if (!rec.sync) return;
    lsSet(TOMBSTONES_KEY, [...lsGet(TOMBSTONES_KEY, []), { path: rec.sync.path, sha: rec.sync.sha, id: rec.project.meta.id }]);
    schedule(2000);
  };
  store.onSave(() => schedule());

  function schedule(ms = DEBOUNCE_MS) {
    if (!loadConfig()) return;
    clearTimeout(timer);
    timer = setTimeout(() => run(), ms);
  }

  async function saveConflictCopy(gh, id, remoteText) {
    const path = `${DIR}/conflitos/${id}_${stamp()}_outro-aparelho.json`;
    await gh.put(path, remoteText, null, `${id}: cópia de conflito`);
    return path;
  }

  async function pass(gh) {
    const report = { up: 0, down: 0, conflicts: [] };
    await store.flush();

    // 1. Apagados neste aparelho → apagar na nuvem.
    const tombs = lsGet(TOMBSTONES_KEY, []);
    const left = [];
    for (const t of tombs) {
      try {
        await gh.remove(t.path, t.sha, `${t.id}: apagado (${device()})`);
      } catch (e) {
        if (e.status === 0) left.push(t); // sem conexão: tenta depois
        // 404/409/422: já não existe ou mudou lá — deixa como está
      }
    }
    lsSet(TOMBSTONES_KEY, left.length ? left : null);

    // 2. O que existe na nuvem.
    const remote = new Map((await gh.list(DIR))
      .filter((f) => f.type === 'file' && f.name.endsWith('.json'))
      .map((f) => [f.path, f.sha]));

    const download = async (path) => {
      const f = await gh.get(path);
      const p = JSON.parse(f.text);
      if (validateProject(p).length) throw new SyncError(`Arquivo inválido na nuvem: ${path}`, -1);
      return { project: p, sha: f.sha, text: f.text };
    };

    // Arquivos da nuvem que nenhum projeto daqui conhece (novos ou renomeados lá).
    const records = await store.allRecords();
    for (const rec of records) rec.project.meta.uid = await store.ensureUid(rec.key);
    const known = new Set(records.flatMap((r) => [pathFor(r.project), r.sync?.path].filter(Boolean)));
    const incoming = new Map();
    for (const path of remote.keys()) if (!known.has(path)) incoming.set(path, await download(path));
    const movedByUid = new Map([...incoming].filter(([, r]) => r.project.meta.uid).map(([path, r]) => [r.project.meta.uid, path]));

    const push = async (rec, path, sha) => {
      const id = rec.project.meta.id;
      const newSha = await gh.put(path, projectText(rec.project), sha, `${id}: edição (${device()})`);
      remote.set(path, newSha);
      await store.markSynced(rec.key, { path, sha: newSha, syncedAt: rec.updatedAt });
      report.up++;
    };

    // 3. Projetos deste aparelho.
    for (const rec of records) {
      const path = pathFor(rec.project);
      const dirty = !rec.sync || rec.updatedAt > rec.sync.syncedAt;
      const remoteSha = remote.get(path);

      if (rec.sync && rec.sync.path !== path) {
        // ID de catálogo mudou: novo arquivo, apaga o antigo.
        if (remoteSha) {
          const other = await gh.get(path);
          if (other.text !== projectText(rec.project)) report.conflicts.push(await saveConflictCopy(gh, rec.project.meta.id, other.text));
        }
        await push(rec, path, remoteSha);
        const oldSha = remote.get(rec.sync.path);
        if (oldSha) {
          await gh.remove(rec.sync.path, oldSha, `${rec.project.meta.id}: renomeado`).catch(() => {});
          remote.delete(rec.sync.path);
        }
        continue;
      }

      if (!rec.sync) {
        if (!remoteSha) { await push(rec, path, null); continue; }
        const r = await download(path);
        if (r.text === projectText(rec.project)) {
          await store.markSynced(rec.key, { path, sha: r.sha, syncedAt: rec.updatedAt });
        } else if (isBlank(rec.project)) {
          if (await store.applyRemote(rec.key, r.project, { path, sha: r.sha })) report.down++;
        } else {
          report.conflicts.push(await saveConflictCopy(gh, rec.project.meta.id, r.text));
          await push(rec, path, r.sha);
        }
        continue;
      }

      if (!remoteSha) {
        // O outro aparelho trocou o ID de catálogo: mesmo projeto, arquivo novo.
        const moved = movedByUid.get(rec.project.meta.uid);
        if (moved && !dirty) {
          const r = incoming.get(moved);
          incoming.delete(moved);
          if (await store.applyRemote(rec.key, r.project, { path: moved, sha: r.sha })) report.down++;
          continue;
        }
        // Apagado no outro aparelho.
        if (dirty) await push(rec, path, null);
        else await store.removeRemoteDeleted(rec.key);
        continue;
      }
      if (remoteSha === rec.sync.sha) {
        if (dirty) await push(rec, path, remoteSha);
        continue;
      }
      // Mudou na nuvem.
      const r = await download(path);
      if (!dirty) {
        if (await store.applyRemote(rec.key, r.project, { path, sha: r.sha })) report.down++;
      } else if (r.text === projectText(rec.project)) {
        await store.markSynced(rec.key, { path, sha: r.sha, syncedAt: rec.updatedAt });
      } else {
        report.conflicts.push(await saveConflictCopy(gh, rec.project.meta.id, r.text));
        await push(rec, path, r.sha);
      }
    }

    // 4. Projetos que só existem na nuvem.
    for (const [path, r] of incoming) {
      await store.addRemote(r.project, { path, sha: r.sha });
      report.down++;
    }
    return report;
  }

  async function run() {
    const gh = client();
    if (!gh) { setStatus({ state: 'off', message: '' }); return null; }
    if (running) { again = true; return running; }
    clearTimeout(timer);
    if (!navigator.onLine) { setStatus({ state: 'offline', message: 'Sem internet — sincroniza quando voltar.' }); return null; }
    setStatus({ state: 'syncing', message: '' });
    running = (async () => {
      try {
        const report = await pass(gh);
        setStatus({ state: 'idle', at: Date.now(), message: '' });
        if (report.conflicts.length) {
          toast(`Conflito: este projeto foi editado nos dois aparelhos. Ficou valendo a versão deste; a outra foi guardada em ${report.conflicts.join(', ')}.`, { error: true, ms: 6000 });
        }
        return report;
      } catch (e) {
        setStatus({ state: e.status === 0 ? 'offline' : 'error', message: e.message });
        return { error: e };
      } finally {
        running = null;
        if (again) { again = false; schedule(1000); }
      }
    })();
    return running;
  }

  /** Testa e salva a configuração. Lança SyncError com mensagem em português. */
  async function connect({ repo, token, api }) {
    const clean = String(repo).trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
    if (!/^[\w.-]+\/[\w.-]+$/.test(clean)) throw new SyncError('Escreva o repositório como usuario/nome (ex.: leo/muzeka-composicoes).');
    if (!String(token).trim()) throw new SyncError('Cole a chave de acesso.');
    const gh = new GitHub({ repo: clean, token: token.trim(), api });
    const info = await gh.info();
    if (!info.private) throw new SyncError('Esse repositório é público: suas músicas ficariam visíveis para todos. Use um repositório privado.');
    lsSet(CONFIG_KEY, { repo: clean, token: token.trim(), ...(api ? { api } : {}) });
    return run();
  }

  function disconnect() {
    lsSet(CONFIG_KEY, null);
    lsSet(TOMBSTONES_KEY, null);
    clearTimeout(timer);
    setStatus({ state: 'off', message: '' });
  }

  // Gatilhos: ao abrir, ao voltar a internet, ao minimizar/sair.
  store.ui.sync = { state: loadConfig() ? 'idle' : 'off', at: null, message: '' };
  window.addEventListener('online', () => schedule(1000));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) run();
    else schedule(1500);
  });
  schedule(1500);

  return { run, connect, disconnect, schedule, get config() { return loadConfig(); } };
}
