// Motor de áudio "feio e funcional": síntese Web Audio sem samples + agendador.

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.12; // s
const START_DELAY = 0.06; // s
const TRACK_KEYS = ['lead', 'lead2', 'chords', 'bass', 'drums', 'metro'];

const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.mix = { volume: {}, mute: {}, solo: {} };
    this.session = null;
    this.onEnded = null;
  }

  /** Cria/retoma o AudioContext. Precisa ser chamado dentro de um gesto do usuário (iOS). */
  unlock() {
    // Faz o som sair mesmo com a chave de silencioso ligada (Safari 16.4+).
    try {
      if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback';
    } catch { /* sem suporte */ }
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx({ latencyHint: 'interactive' });
      this.master = this.ctx.createDynamicsCompressor();
      this.master.threshold.value = -10;
      this.master.ratio.value = 4;
      this.master.connect(this.ctx.destination);
      this.noise = this.#noiseBuffer();
      this.previewBus = this.#makeBus();
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    this.#silentAudioElement();
    // Buffer silencioso: no iOS, garante que o contexto "acorde" neste gesto.
    const src = this.ctx.createBufferSource();
    src.buffer = this.ctx.createBuffer(1, 1, 22050);
    src.connect(this.ctx.destination);
    src.start(0);
  }

  /**
   * iPhone: tocar um <audio> (silencioso, em loop) dentro de um gesto põe a sessão de
   * áudio no modo "mídia", então o Web Audio soa mesmo com o silencioso ligado e em
   * iOS sem navigator.audioSession (antes do 17). Só no iOS; tenta de novo até pegar.
   */
  #silentAudioElement() {
    if (this.silentEl?.playing) return;
    const ios = /iP(hone|ad|od)/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!ios) return;
    if (!this.silentEl) {
      // WAV mono 8 kHz, 8 bits, 0,5 s de silêncio (valor 128).
      const n = 4000;
      const b = new Uint8Array(44 + n);
      const v = new DataView(b.buffer);
      const str = (o, s) => [...s].forEach((c, i) => { b[o + i] = c.charCodeAt(0); });
      str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVEfmt ');
      v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, 8000, true); v.setUint32(28, 8000, true);
      v.setUint16(32, 1, true); v.setUint16(34, 8, true);
      str(36, 'data'); v.setUint32(40, n, true); b.fill(128, 44);
      const el = document.createElement('audio');
      el.src = URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
      el.loop = true;
      el.setAttribute('playsinline', '');
      el.setAttribute('x-webkit-airplay', 'deny');
      el.preload = 'auto';
      this.silentEl = { el, playing: false };
      el.addEventListener('pause', () => { this.silentEl.playing = false; });
    }
    const s = this.silentEl;
    const p = s.el.play();
    if (p) p.then(() => { s.playing = true; }).catch(() => {});
  }

  get ready() {
    return !!this.ctx;
  }

  #noiseBuffer() {
    const len = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  #makeBus() {
    const bus = {};
    for (const k of TRACK_KEYS) {
      bus[k] = this.ctx.createGain();
      bus[k].connect(this.master);
    }
    this.#applyMix(bus);
    return bus;
  }

  #applyMix(bus) {
    const anySolo = Object.values(this.mix.solo).some(Boolean);
    for (const k of TRACK_KEYS) {
      if (k === 'metro') { bus[k].gain.value = 0.5; continue; }
      const audible = !this.mix.mute[k] && (!anySolo || this.mix.solo[k]);
      bus[k].gain.value = audible ? (this.mix.volume[k] ?? 0.8) : 0;
    }
  }

  setMix(mix) {
    this.mix = structuredClone(mix);
    if (!this.ctx) return;
    this.#applyMix(this.previewBus);
    if (this.session) this.#applyMix(this.session.bus);
  }

  // ---------- vozes ----------

  #env(gain, t, dur, { a = 0.005, peak, sus, rel }) {
    const g = gain.gain;
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(peak, t + a);
    g.setTargetAtTime(sus, t + a, 0.08);
    g.setTargetAtTime(0, t + Math.max(dur, a), rel / 4);
    return t + Math.max(dur, a) + rel * 1.5;
  }

  #osc(type, freq, t, end, dest, detune = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    o.connect(dest);
    o.start(t);
    o.stop(end);
    return o;
  }

  #filter(type, freq, q, dest) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    f.connect(dest);
    return f;
  }

  #noiseSrc(t, end, dest) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.connect(dest);
    s.start(t, Math.random() * 0.5);
    s.stop(end);
  }

  /** Toca uma nota melódica (lead/lead2/chords/bass). dur em segundos. */
  note(bus, track, pitch, t, dur, vel = 100) {
    const v = vel / 127;
    const out = this.ctx.createGain();
    out.connect(bus[track]);
    const f = mtof(pitch);
    let end;
    switch (track) {
      case 'lead': {
        end = this.#env(out, t, dur, { peak: 0.22 * v, sus: 0.16 * v, rel: 0.08 });
        const lp = this.#filter('lowpass', Math.min(2600, f * 6), 1.5, out);
        this.#osc('sawtooth', f, t, end, lp);
        break;
      }
      case 'lead2': {
        end = this.#env(out, t, dur, { a: 0.02, peak: 0.16 * v, sus: 0.12 * v, rel: 0.1 });
        const lp = this.#filter('lowpass', Math.min(2200, f * 5), 0.7, out);
        this.#osc('square', f, t, end, lp);
        break;
      }
      case 'chords': {
        end = this.#env(out, t, dur, { a: 0.06, peak: 0.09 * v, sus: 0.07 * v, rel: 0.25 });
        this.#osc('triangle', f, t, end, out, -4);
        this.#osc('triangle', f, t, end, out, 4);
        break;
      }
      case 'bass': {
        // Baixo com "soco": corpo (senoide) + quadrada com filtro que abre no
        // ataque e fecha rápido + estalo curto de pegada no início da nota.
        end = this.#env(out, t, dur, { a: 0.003, peak: 0.5 * v, sus: 0.34 * v, rel: 0.05 });
        const body = this.ctx.createGain();
        body.gain.value = 1.0;
        body.connect(out);
        this.#osc('sine', f, t, end, body);
        if (f / 2 >= 35) { // sub-oitava (só quando ainda é audível)
          const sub = this.ctx.createGain();
          sub.gain.value = 0.35;
          sub.connect(out);
          this.#osc('sine', f / 2, t, end, sub);
        }

        const punch = this.ctx.createGain();
        punch.gain.value = 0.4;
        punch.connect(out);
        const lp = this.#filter('lowpass', 0, 5, punch);
        lp.frequency.setValueAtTime(Math.min(f * 16, 3200), t);
        lp.frequency.setTargetAtTime(Math.max(f * 2, 150), t + 0.005, 0.06);
        this.#osc('square', f, t, end, lp);

        const knock = this.ctx.createGain();
        knock.connect(out);
        knock.gain.setValueAtTime(0.15, t);
        knock.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
        const k = this.#osc('sine', f * 4, t, t + 0.035, knock);
        k.frequency.setValueAtTime(f * 4, t);
        k.frequency.exponentialRampToValueAtTime(f, t + 0.025);
        break;
      }
      default:
        return;
    }
  }

  /** Toca uma peça de bateria. */
  drum(bus, piece, t, vel = 90) {
    const v = vel / 127;
    const out = this.ctx.createGain();
    out.connect(bus.drums);
    const g = out.gain;
    const hit = (peak, decay) => {
      g.setValueAtTime(peak * v, t);
      g.exponentialRampToValueAtTime(0.001, t + decay);
      return t + decay + 0.02;
    };
    const pitchDrop = (from, to, time, end, type = 'sine') => {
      const o = this.#osc(type, from, t, end, out);
      o.frequency.setValueAtTime(from, t);
      o.frequency.exponentialRampToValueAtTime(to, t + time);
    };
    switch (piece) {
      case 'kick': { const end = hit(1.0, 0.35); pitchDrop(150, 45, 0.12, end); break; }
      case 'tomLow': { const end = hit(0.6, 0.3); pitchDrop(160, 90, 0.2, end); break; }
      case 'tomHigh': { const end = hit(0.55, 0.25); pitchDrop(260, 150, 0.18, end); break; }
      case 'snare': {
        const end = hit(0.55, 0.18);
        this.#noiseSrc(t, end, this.#filter('bandpass', 1800, 0.8, out));
        pitchDrop(220, 160, 0.05, end, 'triangle');
        break;
      }
      case 'clap': {
        g.setValueAtTime(0, t);
        for (const dt of [0, 0.012, 0.024]) {
          g.setValueAtTime(0.6 * v, t + dt);
          g.exponentialRampToValueAtTime(0.05, t + dt + 0.011);
        }
        g.setValueAtTime(0.5 * v, t + 0.036);
        g.exponentialRampToValueAtTime(0.001, t + 0.2);
        this.#noiseSrc(t, t + 0.22, this.#filter('bandpass', 1200, 1.2, out));
        break;
      }
      case 'hhClosed': { const end = hit(0.3, 0.05); this.#noiseSrc(t, end, this.#filter('highpass', 7000, 0.7, out)); break; }
      case 'hhOpen': { const end = hit(0.25, 0.32); this.#noiseSrc(t, end, this.#filter('highpass', 6500, 0.7, out)); break; }
      case 'crash': { const end = hit(0.28, 1.3); this.#noiseSrc(t, end, this.#filter('highpass', 4500, 0.5, out)); break; }
      default:
    }
  }

  #click(bus, t, strong) {
    const out = this.ctx.createGain();
    out.connect(bus.metro);
    out.gain.setValueAtTime(strong ? 0.5 : 0.3, t);
    out.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    this.#osc('sine', strong ? 1600 : 1000, t, t + 0.05, out);
  }

  // ---------- prévia (edição) ----------

  preview(track, pitch, dur = 0.25) {
    if (!this.ctx) return;
    this.note(this.previewBus, track, pitch, this.ctx.currentTime + 0.01, dur);
  }

  previewChord(pitches, dur = 0.7) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.01;
    for (const p of pitches) this.note(this.previewBus, 'chords', p, t, dur);
  }

  previewDrum(piece, accent = false) {
    if (!this.ctx) return;
    this.drum(this.previewBus, piece, this.ctx.currentTime + 0.01, accent ? 120 : 90);
  }

  // ---------- reprodução ----------

  /**
   * timeline: { length, notes } de buildTimeline. opts: { bpm, loop, beatsPerBar, metronome }.
   */
  play(timeline, opts) {
    this.unlock();
    this.stop();
    const bus = this.#makeBus();
    this.session = {
      bus,
      opts: { ...opts },
      byStep: indexByStep(timeline),
      length: timeline.length,
      step: 0,
      time: this.ctx.currentTime + START_DELAY,
      marks: [],
      endTime: null,
    };
    this.timer = setInterval(() => this.#tick(), LOOKAHEAD_MS);
    this.#tick();
  }

  /** Atualiza a música durante a reprodução (edições ao vivo, BPM, metrônomo). */
  update(timeline, opts) {
    if (!this.session) return;
    this.session.byStep = indexByStep(timeline);
    this.session.length = timeline.length;
    Object.assign(this.session.opts, opts);
    if (this.session.step >= this.session.length) this.session.step = 0;
  }

  stop() {
    clearInterval(this.timer);
    if (!this.session) return;
    const { bus } = this.session;
    const t = this.ctx.currentTime;
    for (const k of TRACK_KEYS) {
      bus[k].gain.cancelScheduledValues(t);
      bus[k].gain.setTargetAtTime(0, t, 0.015);
    }
    setTimeout(() => Object.values(bus).forEach((g) => g.disconnect()), 300);
    this.session = null;
  }

  get playing() {
    return !!this.session;
  }

  /** Step atual (fracionário) para o cursor de reprodução, ou null. */
  get position() {
    const s = this.session;
    if (!s) return null;
    const now = this.ctx.currentTime;
    let mark = null;
    for (const m of s.marks) if (m.time <= now) mark = m;
    if (!mark) return null;
    return mark.step + Math.min(1, (now - mark.time) / mark.dur);
  }

  #tick() {
    const s = this.session;
    if (!s) return;
    const horizon = this.ctx.currentTime + SCHEDULE_AHEAD;
    while (s.time < horizon) {
      if (s.step >= s.length) {
        if (s.opts.loop && s.length > 0) s.step = 0;
        else {
          if (!s.endTime) s.endTime = s.time + 0.3;
          if (this.ctx.currentTime >= s.endTime) {
            this.stop();
            this.onEnded?.();
          }
          return;
        }
      }
      const stepDur = 60 / s.opts.bpm / 4;
      const step = s.step;
      if (s.opts.metronome && step % 4 === 0) {
        this.#click(s.bus, s.time, step % (s.opts.beatsPerBar * 4) === 0);
      }
      for (const n of s.byStep.get(step) || []) {
        if (n.track === 'drums') this.drum(s.bus, n.drum, s.time, n.vel);
        else this.note(s.bus, n.track, n.pitch, s.time, n.dur * stepDur * 0.98, n.vel);
      }
      s.marks.push({ time: s.time, step, dur: stepDur });
      if (s.marks.length > 64) s.marks.shift();
      s.time += stepDur;
      s.step++;
    }
  }
}

function indexByStep(timeline) {
  const map = new Map();
  for (const n of timeline.notes) {
    if (!map.has(n.step)) map.set(n.step, []);
    map.get(n.step).push(n);
  }
  return map;
}
