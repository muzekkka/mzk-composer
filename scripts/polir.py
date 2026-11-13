#!/usr/bin/env python3
"""Polidor de faixas do Suno (chamado por `./mzk polir`).

O Suno tende a ficar cada vez mais sibilante e estridente depois de uns 2 minutos. Este
script mede a sibilância (5–10 kHz) e o "ar" (10–16 kHz) ao longo da faixa, toma como
referência a parte boa da própria música e abaixa só o excesso, devagar e com transições
suaves. Depois um de-esser leve pega os picos curtos, e o volume vai ao padrão de streaming.

O original nunca é alterado: fica guardado em ~/Muzeka/originais-suno/<Gênero>/ (fora da
pasta da rádio, para não subir ao AzuraCast por engano) e é sempre de lá que o polimento parte:
rodar de novo não acumula tratamento.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

import numpy as np

SR = 48000
FRAME = 4096
HOP = 1024
SMOOTH_S = 3.0

# Faixas tratadas: (nome, início, fim) em Hz.
BANDS = {"sibil": (5000, 10000), "ar": (10000, 16000)}

# Intensidades: folga acima da referência antes de cortar (dB), corte máximo (dB),
# força do de-esser.
LEVELS = {
    "suave": {"margin": 1.5, "maxcut": 4.0, "deesser": 0.25},
    "medio": {"margin": 0.5, "maxcut": 6.0, "deesser": 0.4},
    "forte": {"margin": -1.0, "maxcut": 9.0, "deesser": 0.6},
}
LOUDNESS = "I=-14:TP=-1:LRA=11"


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, **kw)


def decode(path):
    r = run(["ffmpeg", "-v", "error", "-i", path, "-map", "0:a:0", "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"])
    if r.returncode != 0:
        raise SystemExit(f"Não consegui ler {path}:\n{r.stderr.decode()[-400:]}")
    return np.frombuffer(r.stdout, np.float32).reshape(-1, 2).T.copy()


def stft(x):
    win = np.hanning(FRAME).astype(np.float32)
    n = 1 + max(0, (len(x) - FRAME)) // HOP + 1
    pad = np.zeros((n - 1) * HOP + FRAME, np.float32)
    pad[: len(x)] = x
    idx = np.arange(FRAME)[None, :] + HOP * np.arange(n)[:, None]
    return np.fft.rfft(pad[idx] * win, axis=1), win, len(pad)


def istft(spec, win, length):
    frames = np.fft.irfft(spec, n=FRAME, axis=1).astype(np.float32) * win
    out = np.zeros(length, np.float32)
    norm = np.zeros(length, np.float32)
    for i, f in enumerate(frames):
        out[i * HOP : i * HOP + FRAME] += f
        norm[i * HOP : i * HOP + FRAME] += win * win
    return out / np.maximum(norm, 1e-6)


def smooth(v, seconds):
    k = max(1, int(seconds * SR / HOP))
    kernel = np.hanning(k + 2)[1:-1]
    kernel /= kernel.sum()
    padded = np.pad(v, (k, k), mode="edge")
    return np.convolve(padded, kernel, "same")[k:-k]


def band_weights(freqs):
    """Pesos suaves de cada banda (transições em cosseno para não "rasgar" o espectro)."""
    def ramp(f, a, b):
        t = np.clip((f - a) / (b - a), 0, 1)
        return 0.5 - 0.5 * np.cos(np.pi * t)

    sib = ramp(freqs, 4000, 5000) * (1 - ramp(freqs, 9000, 11000))
    ar = ramp(freqs, 9000, 11000)
    return {"sibil": sib, "ar": ar}


def analyze(spec_mono, freqs):
    """Nível de cada banda relativo ao total (dB), por quadro. As energias são suavizadas
    antes da divisão, então o resultado segue o que o ouvido percebe em alguns segundos."""
    p = np.abs(spec_mono) ** 2
    total = smooth(p.sum(axis=1), SMOOTH_S) + 1e-12
    out = {}
    for name, (a, b) in BANDS.items():
        sel = (freqs >= a) & (freqs < b)
        out[name] = 10 * np.log10(smooth(p[:, sel].sum(axis=1), SMOOTH_S) / total + 1e-12)
    loud = 10 * np.log10(total)
    active = loud > loud.max() - 25
    return out, active


def reference(level, active):
    """Referência = o ponto mais brilhante aceitável da parte boa: percentil 75 da banda entre
    10% e 50% da faixa (só trechos com som). O que passar disso é excesso."""
    n = len(level)
    sel = np.zeros(n, bool)
    sel[int(n * 0.10) : int(n * 0.50)] = True
    sel &= active
    if sel.sum() < 10:
        sel = active
    return float(np.percentile(level[sel], 75))


def report(levels, active, cuts=None, step_s=30):
    per = int(step_s * SR / HOP)
    rows = []
    for i in range(0, len(active), per):
        sl = slice(i, i + per)
        if not active[sl].any():
            continue
        t = int(round(i * HOP / SR))
        row = {"t": f"{t // 60}:{t % 60:02d}"}
        for k, v in levels.items():
            row[k] = float(np.mean(v[sl][active[sl]]))
        if cuts:
            for k, v in cuts.items():
                row[f"corte_{k}"] = float(v[sl].min())
        rows.append(row)
    return rows


def polish(src, dst, level, cover=None):
    cfg = LEVELS[level]
    x = decode(src)
    specs = []
    for ch in x:
        s, win, length = stft(ch)
        specs.append(s)
    freqs = np.fft.rfftfreq(FRAME, 1 / SR)
    mono = (specs[0] + specs[1]) / 2
    levels, active = analyze(mono, freqs)
    weights = band_weights(freqs)

    cuts = {}
    gain_db = np.zeros((mono.shape[0], len(freqs)), np.float32)
    for name, lv in levels.items():
        ref = reference(lv, active)
        excess = lv - ref - cfg["margin"]
        cut = -np.clip(excess, 0, cfg["maxcut"])
        cut = smooth(cut, 2.0)
        cuts[name] = cut
        gain_db += cut[:, None] * weights[name][None, :]
    gain = (10 ** (gain_db / 20)).astype(np.float32)
    y = np.stack([istft(s * gain, win, length)[: x.shape[1]] for s in specs])

    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, "eq.wav")
        raw = y.T.astype(np.float32).tobytes()
        r = run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "2", "-i", "-", "-c:a", "pcm_f32le", wav], input=raw)
        if r.returncode != 0:
            raise SystemExit(r.stderr.decode())
        chain = f"deesser=i={cfg['deesser']}:m=0.5:f=0.5"
        m = run(["ffmpeg", "-hide_banner", "-nostats", "-i", wav, "-af", f"{chain},loudnorm={LOUDNESS}:print_format=json", "-f", "null", "-"], text=True)
        js = json.loads(re.findall(r"\{[\s\S]*?\}", m.stderr)[-1])
        ln = (f"loudnorm={LOUDNESS}:linear=true:measured_I={js['input_i']}:measured_TP={js['input_tp']}"
              f":measured_LRA={js['input_lra']}:measured_thresh={js['input_thresh']}:offset={js['target_offset']}")
        # Mantém as etiquetas do original; a capa vira a da Muzeka (ou a do original, se
        # não houver capa configurada).
        art = ["-i", cover, "-map", "0:a", "-map", "2:v", "-c:v", "mjpeg", "-disposition:v", "attached_pic",
               "-metadata:s:v", "title=Muzeka", "-metadata:s:v", "comment=Cover (front)"] if cover else ["-map", "0:a", "-map", "1:v?", "-c:v", "copy"]
        cmd = ["ffmpeg", "-v", "error", "-y", "-i", wav, "-i", src, *art, "-map_metadata", "1",
               "-metadata", f"comment=polido MZK ({level})",
               "-af", f"{chain},{ln},aresample=44100", "-c:a", "libmp3lame", "-b:a", "320k", "-id3v2_version", "3", dst]
        r = run(cmd)
        if r.returncode != 0:
            raise SystemExit(f"ffmpeg falhou:\n{r.stderr.decode()[-600:]}")

    after_levels, after_active = analyze(np.mean([stft(c)[0] for c in decode(dst)], axis=0), freqs)
    return report(levels, active, cuts), report(after_levels, after_active)


GENRE_RE = re.compile(r"^Muzeka - (?P<genre>.+?) - (?P<title>.+)\.mp3$", re.I)


def targets(path, radio, originals):
    name = os.path.basename(path)
    m = GENRE_RE.match(name)
    if not m:
        raise SystemExit(f'Nome fora do padrão "Muzeka - Gênero - Título.mp3": {name}')
    # Faixa que já está na pasta da rádio: o gênero é a pasta onde ela mora (o nome pode
    # dizer outro, ex.: "Muzeka - R&B - …" dentro de Lounge/) e o polido fica no mesmo lugar.
    parent = os.path.dirname(path)
    if os.path.dirname(parent) == os.path.abspath(radio):
        genre = os.path.basename(parent)
    else:
        genre = m.group("genre")
    return os.path.join(originals, genre, name), os.path.join(radio, genre, name)


def main():
    ap = argparse.ArgumentParser(description="Polir faixas do Suno")
    ap.add_argument("files", nargs="+")
    ap.add_argument("--nivel", choices=list(LEVELS), default="medio")
    ap.add_argument("--radio", default=os.path.expanduser("~/Muzeka/radio"))
    ap.add_argument("--originais", default=os.path.expanduser("~/Muzeka/originais-suno"))
    ap.add_argument("--capa", default=os.path.expanduser("~/Muzeka/capa-muzeka.jpg"),
                    help="imagem da capa (padrão: ~/Muzeka/capa-muzeka.jpg; se não existir, mantém a do Suno)")
    ap.add_argument("--json", action="store_true", help="relatório em JSON")
    a = ap.parse_args()

    failures = 0
    for f in a.files:
        try:
            f = os.path.abspath(os.path.expanduser(f))
            if not os.path.isfile(f):
                raise SystemExit(f"Arquivo não encontrado: {f}")
            original, out = targets(f, a.radio, a.originais)
            os.makedirs(os.path.dirname(original), exist_ok=True)
            os.makedirs(os.path.dirname(out), exist_ok=True)
            if not os.path.exists(original):
                shutil.copy2(f, original)
            cover = a.capa if a.capa and os.path.isfile(a.capa) else None
            before, after = polish(original, out + ".tmp.mp3", a.nivel, cover)
            os.replace(out + ".tmp.mp3", out)
            if a.json:
                print(json.dumps({"file": out, "antes": before, "depois": after}, ensure_ascii=False))
                continue
            print(f"✓ {os.path.basename(out)}  (nível {a.nivel})")
            print(f"    original guardado: {original}")
            print(f"    polido:            {out}")
            print("    tempo   sibilância antes→depois   ar antes→depois   (dB relativos)")
            for b, d in zip(before, after):
                print(f"    {b['t']:>5}   {b['sibil']:6.1f} → {d['sibil']:6.1f}          {b['ar']:6.1f} → {d['ar']:6.1f}")
        except SystemExit as e:
            failures += 1
            print(f"✗ {e}", file=sys.stderr)
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
