// `./mzk publicar`: envia ao AzuraCast as faixas novas ou polidas de ~/Muzeka/radio,
// pela API (HTTPS). Nunca apaga nada na rádio.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';

const CONFIG_DIR = process.env.MZK_CONFIG_DIR || join(homedir(), '.config', 'mzk');
export const CONFIG_FILE = join(CONFIG_DIR, 'azuracast.env');
const MANIFEST = join(CONFIG_DIR, 'publicados.json');
const AUDIO = /\.(mp3|ogg|flac|m4a|aac|wav)$/i;

/** Lê KEY='valor' (formato do assistente). */
export function readEnv(file) {
  const env = {};
  if (!existsSync(file)) return env;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)='(.*)'$/);
    if (m) env[m[1]] = m[2].replace(/'\\''/g, "'");
  }
  return env;
}

const nfc = (s) => s.normalize('NFC');

/** Arquivos de áudio em <radio>/<Gênero>/: [{ rel, full }]. */
export function localTracks(radio) {
  const out = [];
  for (const dir of readdirSync(radio).sort()) {
    const d = join(radio, dir);
    if (dir.startsWith('.') || !statSync(d).isDirectory()) continue;
    for (const f of readdirSync(d).sort()) {
      if (AUDIO.test(f) && !f.includes('.tmp.')) out.push({ rel: `${dir}/${f}`, full: join(d, f) });
    }
  }
  return out;
}

function isPolished(full) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format_tags=comment', '-of', 'csv=p=0', full], { encoding: 'utf8' });
  return (r.stdout || '').startsWith('polido MZK');
}

const sha256 = (full) => createHash('sha256').update(readFileSync(full)).digest('hex');

function durationOf(full) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', full], { encoding: 'utf8' });
  return Number(r.stdout) || 0;
}

/** Palavras do título, sem acento, prefixo "Muzeka", "(1)", extensão nem pontuação. */
export function titleWords(name) {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\.[a-z0-9]+$/, '').replace(/\(\d+\)/g, ' ').replace(/\bmuzeka\b|\bby\b/g, ' ')
    .split(/[^a-z0-9]+/).filter(Boolean);
}

const MAX_DURATION_DIFF = 2; // s
const MIN_TITLE_SCORE = 0.5;

/**
 * Acha na rádio o arquivo que corresponde a uma faixa local de nome diferente (a rádio tem
 * os nomes de quando foi enviada, ex.: "funk_-_nêga_lôra(1).mp3"): mesma pasta, título
 * parecido e duração quase igual. Devolve o caminho na rádio ou null.
 */
export function matchRemote(rel, duration, remoteFiles, taken) {
  const [dir, name] = rel.split('/');
  // O gênero (pasta e o do nome) não conta como título: senão "Lounge - Outra" casaria
  // com "lounge_-_store".
  const genre = new Set([...titleWords(dir), ...(/^Muzeka - /i.test(name) ? titleWords(name.split(' - ')[1]) : [])]);
  const words = new Set(titleWords(name).filter((x) => !genre.has(x)));
  let best = null;
  for (const f of remoteFiles) {
    if (taken.has(f.path) || !nfc(f.path).startsWith(`${nfc(dir)}/`)) continue;
    if (Math.abs((f.length ?? 0) - duration) > MAX_DURATION_DIFF) continue;
    const w = titleWords(f.path.slice(f.path.indexOf('/') + 1)).filter((x) => !genre.has(x));
    const score = w.filter((x) => words.has(x)).length / Math.max(w.length, 1);
    if (score >= MIN_TITLE_SCORE && (!best || score > best.score)) best = { score, path: f.path };
  }
  return best?.path ?? null;
}

/**
 * Plano completo:
 * - `todo`: o que enviar. Arquivo ainda não publicado nesta versão (hash diferente do último
 *   envio) e que ou não existe na rádio, ou foi polido aqui. Faixas que vieram da rádio e não
 *   foram mexidas não sobem de novo. Polida substitui o arquivo da rádio no caminho de lá.
 * - `renames`: arquivos da rádio com nome diferente do armazenamento local, para alinhar
 *   (a rádio fica com o mesmo padrão "Gênero/Muzeka - Gênero - Título.mp3").
 */
export function planAll(locals, remoteFiles, manifest, { polished = isPolished, hash = sha256, duration = durationOf } = {}) {
  const exact = new Map(remoteFiles.map((f) => [nfc(f.path), f.path]));
  const taken = new Set(locals.map((t) => exact.get(nfc(t.rel))).filter(Boolean));
  const todo = [];
  const renames = [];
  for (const t of locals) {
    const key = nfc(t.rel);
    let remotePath = exact.get(key) ?? null;
    if (!remotePath) {
      remotePath = matchRemote(t.rel, duration(t.full), remoteFiles, taken);
      if (remotePath) {
        taken.add(remotePath);
        if (!exact.has(key)) renames.push({ rel: t.rel, from: remotePath, to: t.rel });
      }
    }
    const h = hash(t.full);
    if (manifest[key] === h) continue;
    if (remotePath && !polished(t.full)) continue;
    todo.push({ ...t, hash: h, path: remotePath || t.rel, replace: !!remotePath });
  }
  return { todo, renames };
}

export const plan = (...args) => planAll(...args).todo;

/**
 * Playlists para uma faixa nova: as mesmas das outras faixas da pasta na rádio (a mais
 * comum). Na API do AzuraCast, arquivo novo chega sem playlist e não toca.
 */
export function playlistsFor(path, remoteFiles) {
  const dir = path.slice(0, path.indexOf('/') + 1);
  const count = new Map();
  for (const f of remoteFiles) {
    if (!f.path.startsWith(dir) || !f.playlists?.length) continue;
    const key = f.playlists.map((p) => p.id).sort((a, b) => a - b).join(',');
    count.set(key, (count.get(key) || 0) + 1);
  }
  const best = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? best[0].split(',').map(Number) : [];
}

async function api(cfg, method, path, body) {
  const res = await fetch(`${cfg.url}/api${path}`, {
    method,
    headers: { 'X-API-Key': cfg.key, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 300);
    try { msg = JSON.parse(text).message || msg; } catch { /* texto puro */ }
    throw new Error(`AzuraCast respondeu ${res.status}: ${msg}`);
  }
  return text ? JSON.parse(text) : null;
}

export async function publicar(args) {
  const opts = { yes: args.includes('--sim'), preview: args.includes('--previa'), only: null };
  const i = args.indexOf('--so');
  if (i >= 0) opts.only = nfc(args[i + 1] || '').toLowerCase();
  const radio = process.env.MZK_RADIO || join(homedir(), 'Muzeka', 'radio');
  const env = readEnv(CONFIG_FILE);
  if (!env.AZURACAST_API_KEY) {
    throw new Error('AzuraCast ainda não configurado. Rode uma vez: ./scripts/configurar-azuracast.sh');
  }
  const cfg = { url: env.AZURACAST_URL.replace(/\/$/, ''), station: env.AZURACAST_STATION || '1', key: env.AZURACAST_API_KEY };

  process.stdout.write('Lendo a lista de arquivos da rádio… ');
  const files = await api(cfg, 'GET', `/station/${cfg.station}/files`);
  const remoteFiles = files.filter((f) => f.path).map((f) => ({ path: f.path, length: f.length, playlists: f.playlists }));
  console.log(`${remoteFiles.length} arquivos.`);

  const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
  const pick = (t) => !opts.only || nfc(t.rel).toLowerCase().includes(opts.only);
  const all = planAll(localTracks(radio), remoteFiles, manifest);
  const todo = all.todo.filter(pick);
  const renames = all.renames.filter(pick);
  if (!todo.length && !renames.length) {
    console.log('Nada a fazer: a rádio já está igual a ~/Muzeka/radio.');
    return 0;
  }
  const replaced = todo.filter((t) => t.replace);
  const added = todo.filter((t) => !t.replace);
  if (replaced.length) {
    console.log(`\nSubstituir na rádio (versão polida, mesmo lugar) — ${replaced.length}:`);
    for (const t of replaced) console.log(`  ↻ ${t.rel}`);
  }
  if (added.length) {
    console.log(`\nNovas na rádio — ${added.length}:`);
    for (const t of added) console.log(`  + ${t.path}`);
  }
  if (renames.length) {
    console.log(`\nRenomear na rádio, para ficar igual ao computador — ${renames.length}:`);
    for (const r of renames) console.log(`  ✎ ${r.from}\n      → ${r.to}`);
  }
  console.log('\nNada será apagado na rádio.');
  if (opts.preview) return 0;
  if (!opts.yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const what = [todo.length && `enviar ${todo.length} faixa(s)`, renames.length && `renomear ${renames.length}`].filter(Boolean).join(' e ');
    const answer = (await rl.question(`\nConfirma ${what}? [s/N] `)).trim().toLowerCase();
    rl.close();
    if (answer !== 's' && answer !== 'sim') {
      console.log('Nada foi feito.');
      return 0;
    }
  }

  mkdirSync(dirname(MANIFEST), { recursive: true });
  let ok = 0;
  for (const [i, t] of todo.entries()) {
    process.stdout.write(`[${i + 1}/${todo.length}] ${t.rel} … `);
    try {
      const file = readFileSync(t.full).toString('base64');
      // A rede às vezes tropeça num envio grande: tenta até 3 vezes.
      for (let attempt = 1; ; attempt++) {
        try {
          await api(cfg, 'POST', `/station/${cfg.station}/files`, { path: t.path, file });
          break;
        } catch (e) {
          if (attempt >= 3 || !/fetch failed|ECONNRESET|socket/i.test(`${e.message} ${e.cause?.code ?? ''}`)) throw e;
          process.stdout.write('(tentando de novo) ');
          await new Promise((r) => setTimeout(r, 3000 * attempt));
        }
      }
      if (!t.replace) {
        const ids = playlistsFor(t.path, remoteFiles);
        if (ids.length) {
          await api(cfg, 'PUT', `/station/${cfg.station}/files/batch`, { do: 'playlist', files: [t.path], dirs: [], playlists: ids, currentDirectory: '' });
          process.stdout.write('(na playlist) ');
        } else {
          process.stdout.write('(sem playlist: escolha no painel) ');
        }
      }
      manifest[nfc(t.rel)] = t.hash;
      writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
      ok++;
      console.log('ok');
    } catch (e) {
      console.log(`falhou\n    ${e.message}`);
    }
  }
  if (todo.length) console.log(`\n${ok} de ${todo.length} enviada(s).`);

  // Renomeia depois de enviar (o envio usa o nome que o arquivo tinha na rádio).
  let renamed = 0;
  for (const r of renames) {
    try {
      await api(cfg, 'PUT', `/station/${cfg.station}/files/rename`, { file: r.from, newPath: r.to });
      renamed++;
    } catch (e) {
      console.log(`  não renomeou ${r.from}: ${e.message}`);
    }
  }
  if (renames.length) console.log(`${renamed} de ${renames.length} renomeada(s).`);
  return ok === todo.length && renamed === renames.length ? 0 : 1;
}
