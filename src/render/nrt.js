// Partitura de áudio → arquivo de comandos OSC para o scsynth renderizar sem tempo
// real (`scsynth -N`). Só roda no Node (usa Buffer).

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Barramentos internos (estéreo) e grupos do servidor.
export const BUS = { master: 16, reverb: 18, delay: 20 };
const GROUP_SOURCES = 1;
const GROUP_FX = 2;
const ADD_TO_HEAD = 0;
const ADD_TO_TAIL = 1;
const ADD_AFTER = 3;

function oscString(s) {
  const raw = Buffer.from(`${s}\0`, 'utf8');
  return Buffer.concat([raw, Buffer.alloc((4 - (raw.length % 4)) % 4)]);
}

class Int { constructor(v) { this.v = v; } }
export const int = (v) => new Int(v);

/** Mensagem OSC: números viram float32, salvo `int(n)`; Buffer vira blob. */
export function oscMessage(address, args) {
  let tags = ',';
  const parts = [];
  for (const a of args) {
    if (a instanceof Int) {
      tags += 'i';
      const b = Buffer.alloc(4); b.writeInt32BE(a.v); parts.push(b);
    } else if (typeof a === 'number') {
      tags += 'f';
      const b = Buffer.alloc(4); b.writeFloatBE(a); parts.push(b);
    } else if (typeof a === 'string') {
      tags += 's';
      parts.push(oscString(a));
    } else if (Buffer.isBuffer(a)) {
      tags += 'b';
      const len = Buffer.alloc(4); len.writeInt32BE(a.length);
      parts.push(len, a, Buffer.alloc((4 - (a.length % 4)) % 4));
    } else {
      throw new Error(`Argumento OSC não suportado: ${a}`);
    }
  }
  return Buffer.concat([oscString(address), oscString(tags), ...parts]);
}

export function oscBundle(timeSec, messages) {
  const tt = Buffer.alloc(8);
  const secs = Math.floor(timeSec);
  tt.writeUInt32BE(secs, 0);
  tt.writeUInt32BE(Math.min(0xffffffff, Math.round((timeSec - secs) * 2 ** 32)), 4);
  const elems = messages.flatMap((m) => {
    const len = Buffer.alloc(4); len.writeInt32BE(m.length);
    return [len, m];
  });
  return Buffer.concat([oscString('#bundle'), tt, ...elems]);
}

/** Arquivo de partitura NRT: sequência de [tamanho int32][bundle]. */
export function nrtFile(bundles) {
  return Buffer.concat(bundles.flatMap((b) => {
    const len = Buffer.alloc(4); len.writeInt32BE(b.length);
    return [len, b];
  }));
}

export function loadSynthDefs(dir) {
  return readdirSync(dir).filter((f) => f.endsWith('.scsyndef')).sort().map((f) => readFileSync(join(dir, f)));
}

const flatParams = (params) => Object.entries(params).flatMap(([k, v]) => [k, Number(v)]);

/** Monta o arquivo NRT completo a partir de `buildRenderScore()`. */
export function buildNrt(score, synthDefs) {
  const { pack } = score;
  const setup = [
    ...synthDefs.map((d) => oscMessage('/d_recv', [d])),
    oscMessage('/g_new', [int(GROUP_SOURCES), int(ADD_TO_HEAD), int(0)]),
    oscMessage('/g_new', [int(GROUP_FX), int(ADD_AFTER), int(GROUP_SOURCES)]),
    oscMessage('/s_new', ['mzk_delay', int(1000), int(ADD_TO_TAIL), int(GROUP_FX),
      'in', BUS.delay, 'out', BUS.master, 'time', pack.delaySteps * score.stepSec, 'feedback', pack.delayFeedback]),
    oscMessage('/s_new', ['mzk_reverb', int(1001), int(ADD_TO_TAIL), int(GROUP_FX),
      'in', BUS.reverb, 'out', BUS.master, 'room', pack.reverbRoom]),
    oscMessage('/s_new', ['mzk_master', int(1002), int(ADD_TO_TAIL), int(GROUP_FX), 'in', BUS.master, 'out', 0]),
  ];
  const bundles = [oscBundle(0, setup)];

  // Agrupa eventos no mesmo instante num bundle só.
  let i = 0;
  const { events } = score;
  while (i < events.length) {
    const t = events[i].time;
    const msgs = [];
    while (i < events.length && events[i].time === t) {
      const e = events[i++];
      msgs.push(oscMessage('/s_new', [e.synth, int(-1), int(ADD_TO_HEAD), int(GROUP_SOURCES),
        ...flatParams(e.params),
        'out', BUS.master, 'rev', BUS.reverb, 'revAmt', e.rev, 'dly', BUS.delay, 'dlyAmt', e.dly]));
    }
    bundles.push(oscBundle(t, msgs));
  }
  // Marca o fim da renderização.
  bundles.push(oscBundle(score.duration, [oscMessage('/c_set', [int(0), 0])]));
  return nrtFile(bundles);
}
