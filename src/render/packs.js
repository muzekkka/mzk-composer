// Pacotes de som do mp3 ("Som do MP3"). Cada pacote diz qual timbre (SynthDef em
// sc/synthdefs.scd) toca cada trilha, com volume, pan e envios de efeito, e qual
// levada os acordes usam. Nada disso entra no .mid nem no PDF.

/** Levadas dos acordes. `pad` = acorde sustentado; `arp` = arpejo em semicolcheias. */
export const LEVADAS = {
  pad: { name: 'Pad (acorde sustentado)', pad: true, arp: false },
  arp: { name: 'Arpejo', pad: false, arp: true },
  padArp: { name: 'Pad + arpejo', pad: true, arp: true },
};

export const PACKS = {
  synthwave: {
    name: 'Synthwave',
    levada: 'padArp',
    delaySteps: 3, // colcheia pontuada
    delayFeedback: 0.38,
    reverbRoom: 0.88,
    tracks: {
      lead: { synth: 'mzk_lead', amp: 0.5, pan: 0, rev: 0.22, dly: 0.22 },
      lead2: { synth: 'mzk_brass', amp: 0.4, pan: 0.2, rev: 0.3, dly: 0.12 },
      bass: { synth: 'mzk_bass', amp: 0.28, pan: 0 },
      pad: { synth: 'mzk_pad', amp: 0.12, pan: 0, rev: 0.35 },
      arp: { synth: 'mzk_pluck', amp: 0.28, pan: 0, rev: 0.18, dly: 0.3, octave: 12, spread: 0.35 },
    },
    drums: {
      kick: { synth: 'mzk_kick', amp: 0.85 },
      snare: { synth: 'mzk_snare', amp: 0.5, rev: 0.5, params: { decay: 0.24 } },
      clap: { synth: 'mzk_clap', amp: 0.45, pan: 0.05, rev: 0.4 },
      hhClosed: { synth: 'mzk_metal', amp: 0.16, pan: 0.2, params: { decay: 0.05 } },
      hhOpen: { synth: 'mzk_metal', amp: 0.14, pan: 0.2, params: { decay: 0.32 } },
      tomLow: { synth: 'mzk_tom', amp: 0.5, pan: -0.3, rev: 0.3, params: { freq: 95 } },
      tomHigh: { synth: 'mzk_tom', amp: 0.45, pan: 0.3, rev: 0.3, params: { freq: 140 } },
      crash: { synth: 'mzk_metal', amp: 0.18, pan: -0.15, rev: 0.2, params: { decay: 1.8, cutoff: 5000 } },
    },
  },
};

export const DEFAULT_PACK = 'synthwave';
