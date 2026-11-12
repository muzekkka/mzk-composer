// Leitor MIDI mínimo e independente do gerador, usado só nos testes.

export function readMidi(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let p = 0;
  const str = (n) => String.fromCharCode(...b.slice(p, (p += n)));
  const u32 = () => ((b[p++] << 24) | (b[p++] << 16) | (b[p++] << 8) | b[p++]) >>> 0;
  const u16 = () => (b[p++] << 8) | b[p++];
  const vlq = () => { let v = 0, c; do { c = b[p++]; v = (v << 7) | (c & 0x7f); } while (c & 0x80); return v; };

  if (str(4) !== 'MThd') throw new Error('sem MThd');
  if (u32() !== 6) throw new Error('header len');
  const format = u16(), ntracks = u16(), ppq = u16();
  const tracks = [];
  for (let t = 0; t < ntracks; t++) {
    if (str(4) !== 'MTrk') throw new Error(`trilha ${t} sem MTrk`);
    const end = u32() + p;
    const events = [];
    let tick = 0, status = 0;
    while (p < end) {
      tick += vlq();
      let s = b[p];
      if (s & 0x80) p++; else s = status;
      if (s === 0xff) {
        const type = b[p++], len = vlq();
        const data = b.slice(p, (p += len));
        events.push({ tick, meta: type, data, text: new TextDecoder().decode(data) });
      } else {
        status = s;
        const type = s & 0xf0, channel = s & 0x0f;
        const a = b[p++], c = type === 0xc0 || type === 0xd0 ? undefined : b[p++];
        events.push({ tick, type, channel, a, b: c });
      }
    }
    if (p !== end) throw new Error(`trilha ${t}: tamanho inconsistente`);
    tracks.push(events);
  }
  if (p !== b.length) throw new Error('bytes sobrando no fim do arquivo');
  return { format, ppq, tracks };
}

export const trackName = (events) => events.find((e) => e.meta === 0x03)?.text;
export const notes = (events) => {
  const open = new Map(), out = [];
  for (const e of events) {
    const key = `${e.channel}:${e.a}`;
    if (e.type === 0x90 && e.b > 0) open.set(key, e);
    else if (e.type === 0x80 || (e.type === 0x90 && e.b === 0)) {
      const on = open.get(key);
      if (!on) throw new Error(`note-off sem note-on: ${key} @${e.tick}`);
      open.delete(key);
      out.push({ tick: on.tick, dur: e.tick - on.tick, pitch: e.a, channel: e.channel, vel: on.b });
    }
  }
  if (open.size) throw new Error(`notas sem note-off: ${[...open.keys()]}`);
  return out;
};
