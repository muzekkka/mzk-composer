// MZK Composer — timbres do mp3 (SuperCollider).
//
// Os arquivos compilados (sc/defs/*.scsyndef) já vêm no repositório; o `./mzk render`
// só precisa do scsynth. Para recompilar depois de mudar este arquivo:
//   sclang sc/synthdefs.scd
//
// Convenção: todo timbre recebe `out` (bus de mixagem), `rev`/`revAmt` (envio para o
// reverb) e `dly`/`dlyAmt` (envio para o delay). Notas têm `freq`, `dur` (s) e `amp`.

(
var dir = PathName(thisProcess.nowExecutingPath).pathOnly +/+ "defs";
var outs = { |sig|
	Out.ar(\out.kr(0), sig);
	Out.ar(\rev.kr(0), sig * \revAmt.kr(0));
	Out.ar(\dly.kr(0), sig * \dlyAmt.kr(0));
};
var defs = List[];

// ---------------- bateria (anos 80, sintetizada) ----------------

defs.add(SynthDef(\mzk_kick, { |amp = 0.8, pan = 0|
	var penv = EnvGen.ar(Env([190, 55, 44], [0.035, 0.3], [-5, -2]));
	var aenv = EnvGen.ar(Env.perc(0.001, 0.5, curve: -5), doneAction: 2);
	var body = SinOsc.ar(penv, 0.5pi) * aenv;
	var click = HPF.ar(WhiteNoise.ar, 1800) * EnvGen.ar(Env.perc(0.0005, 0.01)) * 0.35;
	var sig = ((body + click) * 1.6).tanh * amp;
	outs.(Pan2.ar(sig, pan));
}));

defs.add(SynthDef(\mzk_snare, { |amp = 0.5, pan = 0, decay = 0.22|
	var tone = SinOsc.ar(EnvGen.ar(Env([320, 180], [0.04], -3))) * EnvGen.ar(Env.perc(0.001, 0.13)) * 0.7;
	var nenv = EnvGen.ar(Env.perc(0.001, decay, curve: -4), doneAction: 2);
	var noise = (BPF.ar(WhiteNoise.ar, 3800, 0.9) * 1.4 + HPF.ar(WhiteNoise.ar, 1200) * 0.5) * nenv;
	var sig = ((tone + noise) * 1.3).tanh * amp;
	outs.(Pan2.ar(sig, pan));
}));

defs.add(SynthDef(\mzk_clap, { |amp = 0.5, pan = 0|
	var env = EnvGen.ar(Env([0, 1, 0.15, 1, 0.15, 1, 0], [0.001, 0.009, 0.001, 0.009, 0.001, 0.2], -4), doneAction: 2);
	var sig = BPF.ar(WhiteNoise.ar, 1300, 0.7) * env * 2.2;
	sig = (sig + (HPF.ar(WhiteNoise.ar, 4000) * env * 0.3)) * amp;
	outs.(Pan2.ar(sig, pan));
}));

// Chimbal/prato: ruído + grupo "metálico" de quadradas (estilo 808).
defs.add(SynthDef(\mzk_metal, { |amp = 0.2, pan = 0, decay = 0.06, cutoff = 8000|
	var env = EnvGen.ar(Env.perc(0.001, decay, curve: -6), doneAction: 2);
	var metal = Mix(Pulse.ar([205.3, 304.4, 369.6, 522.7, 540, 800] * 1.2)) / 6;
	var sig = HPF.ar(BPF.ar(metal, 10000, 1) * 2.5 + (WhiteNoise.ar * 0.5), cutoff) * env * amp;
	outs.(Pan2.ar(sig, pan));
}));

defs.add(SynthDef(\mzk_tom, { |amp = 0.5, pan = 0, freq = 120|
	var penv = EnvGen.ar(Env([freq * 1.6, freq], [0.06], -3));
	var env = EnvGen.ar(Env.perc(0.002, 0.45, curve: -4), doneAction: 2);
	var sig = SinOsc.ar(penv) + (LPF.ar(WhiteNoise.ar, 2000) * EnvGen.ar(Env.perc(0.001, 0.03)) * 0.4);
	outs.(Pan2.ar((sig * 1.4).tanh * env * amp, pan));
}));

// ---------------- instrumentos ----------------

// Baixo synthwave: serras com filtro que "fecha" + subgrave em senoide.
defs.add(SynthDef(\mzk_bass, { |freq = 55, dur = 0.5, amp = 0.35, pan = 0|
	var hold = (dur - 0.09).max(0.01);
	var env = EnvGen.ar(Env([0, 1, 0.85, 0.85, 0], [0.003, 0.08, hold, 0.07], -2), doneAction: 2);
	var cut = EnvGen.ar(Env([freq * 14, freq * 3.5], [0.18], -4)).clip(80, 7000);
	var saws = Mix(Saw.ar(freq * [0.997, 1.003])) * 0.5;
	var sig = RLPF.ar(saws, cut, 0.55) * 0.8 + (SinOsc.ar(freq) * 0.7);
	sig = (sig * 1.3).tanh * env * amp;
	outs.(Pan2.ar(sig, pan));
}));

// Lead: três serras desafinadas, vibrato que entra devagar, filtro com brilho no ataque.
defs.add(SynthDef(\mzk_lead, { |freq = 440, dur = 0.5, amp = 0.2, pan = 0|
	var hold = (dur - 0.03).max(0.01);
	var env = EnvGen.ar(Env([0, 1, 0.9, 0.9, 0], [0.008, 0.02, hold, 0.18], -2), doneAction: 2);
	var vib = SinOsc.kr(5.3, 0, EnvGen.kr(Env([0, 0, 0.005], [0.22, 0.35])));
	var f = freq * (1 + vib);
	var oscs = Saw.ar(f * [0.994, 1, 1.006]);
	var cut = EnvGen.kr(Env([1500, 5200, 3000], [0.015, 0.35], -3));
	var sig = RLPF.ar(Splay.ar(oscs, 0.6), cut, 0.7) * env * amp;
	outs.(Balance2.ar(sig[0], sig[1], pan));
}));

// Lead 2: pulso com largura variando (soa como metal/sintetizador "brass").
defs.add(SynthDef(\mzk_brass, { |freq = 440, dur = 0.5, amp = 0.18, pan = 0|
	var hold = (dur - 0.05).max(0.01);
	var env = EnvGen.ar(Env([0, 1, 0.8, 0.8, 0], [0.03, 0.1, hold, 0.2], -2), doneAction: 2);
	var pwm = SinOsc.kr([0.6, 0.73]).range(0.25, 0.5);
	var cut = EnvGen.kr(Env([700, 3800, 2200], [0.06, 0.4], -2));
	var sig = RLPF.ar(Pulse.ar(freq * [0.998, 1.002], pwm), cut, 0.8) * env * amp;
	outs.(Balance2.ar(sig[0], sig[1], pan));
}));

// Pad estilo Juno: serras + pulso desafinados, filtro respirando e chorus estéreo.
defs.add(SynthDef(\mzk_pad, { |freq = 220, dur = 2, amp = 0.07, pan = 0|
	var hold = (dur - 0.35).max(0.05);
	var env = EnvGen.ar(Env([0, 1, 0.85, 0.85, 0], [0.35, 0.3, hold, 0.9], [2, -2, 0, -3]), doneAction: 2);
	var oscs = Mix(Saw.ar(freq * [0.993, 1.0, 1.007])) * 0.4 + (Pulse.ar(freq * 0.5, 0.4) * 0.25);
	var cut = SinOsc.kr(0.17).range(1300, 2600);
	var dry = RLPF.ar(oscs, cut, 0.9);
	var chorus = [
		DelayC.ar(dry, 0.03, SinOsc.kr(0.31, 0).range(0.008, 0.018)),
		DelayC.ar(dry, 0.03, SinOsc.kr(0.37, 1.5).range(0.008, 0.018)),
	];
	var sig = (chorus + (dry * 0.6)) * env * amp;
	outs.(Balance2.ar(sig[0], sig[1], pan));
}));

// Pluck do arpejo: ataque curto, filtro descendo rápido.
defs.add(SynthDef(\mzk_pluck, { |freq = 440, dur = 0.12, amp = 0.08, pan = 0|
	var env = EnvGen.ar(Env.perc(0.002, (dur * 1.6).clip(0.08, 0.5), curve: -4), doneAction: 2);
	var cut = EnvGen.kr(Env([freq * 10, freq * 2], [0.12], -4)).clip(200, 9000);
	var sig = RLPF.ar(Saw.ar(freq) * 0.6 + (Pulse.ar(freq * 2.001, 0.3) * 0.25), cut, 0.5) * env * amp;
	outs.(Pan2.ar(sig, pan));
}));

// ---------------- efeitos e master ----------------

defs.add(SynthDef(\mzk_reverb, { |in = 0, out = 0, room = 0.85, damp = 0.45|
	var sig = HPF.ar(In.ar(in, 2), 220);
	sig = FreeVerb2.ar(sig[0], sig[1], 1, room, damp);
	Out.ar(out, sig);
}));

// Delay pingue-pongue com feedback filtrado.
defs.add(SynthDef(\mzk_delay, { |in = 0, out = 0, time = 0.375, feedback = 0.4|
	var sig = In.ar(in, 2);
	var fb = LocalIn.ar(2);
	var wet = DelayC.ar(LPF.ar(HPF.ar(sig.sum * 0.5 + fb.reverse, 300), 3500), 2, time);
	LocalOut.ar(wet * feedback);
	Out.ar(out, wet);
}));

defs.add(SynthDef(\mzk_master, { |in = 0, out = 0, drive = 1.1|
	var sig = HPF.ar(In.ar(in, 2), 28);
	sig = Compander.ar(sig, sig, 0.35, 1, 0.55, 0.01, 0.25);
	sig = (sig * drive).tanh;
	Out.ar(out, Limiter.ar(sig, 0.95, 0.01));
}));

File.mkdir(dir);
defs.do { |d| d.writeDefFile(dir) };
("MZK: % timbres gravados em %".format(defs.size, dir)).postln;
0.exit;
)
