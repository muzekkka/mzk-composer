// Projetos salvos no aparelho (IndexedDB). Cada registro: { key, project, updatedAt }.
// `key` é interno e fixo; o ID de catálogo (meta.id) pode ser editado.

const DB_NAME = 'mzk';
const STORE = 'projects';

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export const newKey = () =>
  (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

class IdbStorage {
  constructor(db) {
    this.db = db;
    this.persistent = true;
  }

  #store(mode) {
    return this.db.transaction(STORE, mode).objectStore(STORE);
  }

  all() { return req(this.#store('readonly').getAll()); }
  get(key) { return req(this.#store('readonly').get(key)); }
  put(record) { return req(this.#store('readwrite').put(record)); }
  remove(key) { return req(this.#store('readwrite').delete(key)); }
}

// Sem IndexedDB (raro: modo privado antigo): só em memória, com aviso.
class MemoryStorage {
  constructor() {
    this.map = new Map();
    this.persistent = false;
  }

  async all() { return [...this.map.values()].map((r) => structuredClone(r)); }
  async get(key) { return this.map.has(key) ? structuredClone(this.map.get(key)) : undefined; }
  async put(record) { this.map.set(record.key, structuredClone(record)); }
  async remove(key) { this.map.delete(key); }
}

export async function openStorage() {
  try {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE, { keyPath: 'key' });
    const db = await req(open);
    // Pede ao navegador para não apagar os dados por falta de espaço/uso.
    navigator.storage?.persist?.().catch(() => {});
    return new IdbStorage(db);
  } catch {
    return new MemoryStorage();
  }
}

/** Resumo para a lista de projetos, mais recentes primeiro. */
export function summarize(records) {
  return records
    .map((r) => ({ key: r.key, id: r.project.meta.id, title: r.project.meta.title, updatedAt: r.updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
