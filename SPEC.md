# MZK Composer — Especificação v1

Caderno de rascunhos musicais da rádio indoor **Muzeka**. Captura ideias rápidas
(iPhone e Linux) e gera um `.mid` limpo + partitura PDF (lead sheet) para registro
autoral e para o pipeline SuperCollider → Suno.

Decisões fechadas na sabatina de 2026-11-12.

## 1. Modelo musical

- **Seções** nomeadas (Intro, A, B, Refrão…), cada uma com 1–32 compassos.
  Um **roteiro** (até 64 entradas) define a ordem: `Intro, A, A, B, A`.
- **Grid** fixo em 1/16 reto. Sem quiálteras, swing ou anacruse (v2).
- **Fórmula de compasso** fixa por projeto: `2/4`, `3/4` ou `4/4`.
- **BPM** fixo por projeto.
- **Tonalidade** maior ou menor, fixa por projeto. Define armadura, grafia das notas
  na partitura e o travamento de escala na entrada.

## 2. Trilhas

| # | Trilha | Nome MIDI | Canal | Entrada | Faixa |
|---|--------|-----------|-------|---------|-------|
| 1 | Lead | `Lead` | 1 | piano-roll monofônico | C4–C6 |
| 2 | Acordes | `Chords` | 2 | cifra por tempo | voicing C3–C5 |
| 3 | Baixo | `Bass` | 3 | piano-roll monofônico + "gerar do acorde" | E1–G3 |
| 4 | Lead 2 | nome livre (padrão `Lead2`) | 4 | igual ao Lead | C4–C6 |
| 5 | Bateria | `Drums` | **10** (GM) | step sequencer | — |

- Velocity fixa 100 nas trilhas melódicas.
- Bateria: 8 peças GM — Bumbo 36, Caixa 38, Palma 39, Chimbal fechado 42,
  Chimbal aberto 46, Tom grave 45, Tom agudo 50, Prato 49. Cada step: off /
  normal (vel 90) / acento (vel 120).

### Acordes

- Um acorde pode começar em **qualquer tempo** do compasso (1 por compasso por
  padrão, dividindo até 1 por tempo). Tempos antes do primeiro acorde da seção
  ficam em silêncio.
- O acorde soa até o próximo acorde, até um **N.C.** ou até o fim da seção
  (nunca atravessa para a seção seguinte).
- **Texto canônico no padrão popular brasileiro**: `C`, `Am`, `C7M`, `Am7(9)`,
  `Bm7(b5)`, `G7(b9)`, `C°`, `F#m7(11)`, `C/E`, `Gsus4`, `G7sus4`, `C6(9)`,
  `E7(#9)`, `C+`, `Cm7M`, `C(9)`, `C5`, `N.C.`
  - Tensões entre parênteses, separadas por `/`: `C7(9/13)`.
  - `C°` = diminuto com sétima (tétrade). Tríade diminuta = `Cm(b5)`.
  - Entrada aceita também notação americana/jazz (`Cmaj7`, `Am9`, `Bm7b5`,
    `Cdim7`, `CΔ7`, `A-7`, `Bø`, `Cadd9`, `C6/9`) e normaliza para o canônico.
  - Convenção brasileira: `C9` (sem sétima) = `C(9)` (nona adicionada). Com
    sétima maior implícita (`Cmaj9`) vira `C7M(9)`; `Am9` (americano: m7+9) é
    interpretado como `Am(9)` — para m7 com nona escreva `Am7(9)`.
  - `C7+` (grafia brasileira antiga) = `C7M`. Aumentado é `C+` ou `C7(#5)`.
- **Voicing automático** (trilha Chords): posição fechada na região C3–C5,
  condução de vozes mínima dentro da seção (cada seção recomeça do zero, então
  soa igual toda vez que aparece). O primeiro acorde da seção tem a fundamental
  embaixo. Acordes com 5+ notas omitem a 5ª justa; com 6+ omitem também a
  fundamental. O baixo da cifra invertida (`/E`) **não** entra em Chords — é
  papel da trilha Bass.
- Notas sustentadas (pad), sem ritmo de comping.

## 3. Metadados

`id` (`MZK-0042`, permanente, único), título, compositor(es), ano, linha de
copyright (automática `© 2026 Nome` se vazia), notas livres.

Nome de arquivo: `MZK-0042_titulo-da-obra_92bpm_Am.{json,mid,ly,pdf}`.

## 4. Formato do projeto (`.json`)

Posições e durações em **steps de 1/16** (inteiros), relativas ao início da seção.

```json
{
  "schema": 1,
  "meta": { "id": "MZK-0042", "title": "…", "composers": ["…"], "year": 2026,
            "copyright": "", "notes": "" },
  "settings": { "bpm": 92, "key": { "tonic": "A", "mode": "minor" },
                "timeSignature": [4, 4], "lead2Name": "Lead2" },
  "sections": [
    { "id": "a", "name": "A", "bars": 4,
      "lead":   [{ "pos": 0, "dur": 4, "pitch": 76 }],
      "lead2":  [],
      "chords": [{ "pos": 0, "symbol": "Am7" }, { "pos": 8, "symbol": "N.C." }],
      "bass":   [{ "pos": 0, "dur": 16, "pitch": 45 }],
      "drums":  [{ "pos": 0, "piece": "kick", "accent": false }] }
  ],
  "arrangement": ["a", "a"]
}
```

`meta.uid` (opcional) é uma identidade interna fixa criada na primeira
sincronização; permite seguir o projeto quando o ID de catálogo muda.

Peças de bateria: `kick`, `snare`, `clap`, `hhClosed`, `hhOpen`, `tomLow`,
`tomHigh`, `crash`. `pitch` = número MIDI (60 = C4).

## 5. MIDI exportado

- SMF **Format 1**, PPQ 480 (1 step = 120 ticks). Roteiro expandido numa
  timeline linear.
- Trilha 0 (condutor): Track Name = título, Copyright (0x02), Text
  `composer:…`, `id:…`, `year:…`, Tempo, Time Signature, Key Signature e um
  Marker por ocorrência de seção (`[A]`, `[Refrão]`).
- Trilhas 1–5 na ordem Lead, Chords, Bass, Lead2, Drums — sempre presentes,
  mesmo vazias. Cada uma com Track Name e Program Change (exceto Drums).
- Chords leva um Text `chord:Am7/G` no início de cada acorde (`chord:N.C.`
  inclusive).

## 6. Partitura (lead sheet)

- Gerada **JSON → LilyPond** (não via `midi2ly`), renderizada pelo LilyPond 2.24.
- Cabeçalho: título, compositor(es), copyright, ID, ♩ = BPM.
- Melodia (Lead) com cifras acima, exatamente no texto canônico.
- Lead2 vira segunda pauta só se tiver notas.
- Marcas de ensaio com o nome da seção; seções repetidas em sequência viram
  barras de repetição (com "3x" etc. quando > 2); retorno posterior é escrito de
  novo. Quebra de linha no início de cada seção e a cada 4 compassos.

## 7. Comando de build (Linux)

```
./mzk build MZK-0042            # procura no diretório de projetos
./mzk build caminho/arquivo.json
./mzk build --all
./mzk build MZK-0042 --registrar   # também faz commit dos exports (repo git)
```

Gera `.mid`, `.ly` e `.pdf` em `exports/` (irmã da pasta `projects/`).
Diretório de projetos: `--dir`, variável `MZK_DIR`, ou
`~/Muzeka/composicoes/projects`.

## 8. App (etapas 2–4)

- PWA em JavaScript puro (ES modules, sem build, sem dependências), interface em
  português, código/JSON/MIDI em inglês.
- Celular: uma trilha por tela, abas embaixo (Lead · Lead2 · Acordes · Baixo ·
  Bateria); barra fixa com Play/Stop, loop, seção atual, BPM. Tela "Projeto"
  para metadados e roteiro. Desktop: mesmo layout maior + atalhos de teclado.
- Desfazer/refazer, duplicar seção, copiar/colar compasso, mute/solo, loop da
  seção, metrônomo.
- Áudio Web Audio: desbloqueio no primeiro toque, `navigator.audioSession.type =
  "playback"` (toca com o iPhone no silencioso), agendamento antecipado. Com a
  tela bloqueada o som para (limite do iOS).
- Timbres: Lead serra filtrada, Lead2 quadrada, Acordes pad triangular, Baixo
  senoide+triângulo, bateria com ruído filtrado/senoides.
- Salvamento local imediato (IndexedDB). Sincronização com repositório privado
  GitHub `muzeka-composicoes` (token fine-grained restrito, 1 ano): 30 s após a
  última edição, ao sair do app e por botão. Conflito → guarda as duas versões.
- App hospedado no GitHub Pages (repositório público `mzk-composer`, só código).
- Exportar só aparece no desktop.

## 9. MP3 para o Suno (etapa 5)

Decidido na sabatina de 2026-11-13. O mp3 é uma **amostra intermediária**: deixa
claras melodia, harmonia e groove; o Suno (plano Pro, envio manual, curadoria do
autor) transforma no estilo do prompt. Caminho pensado para música eletrônica/beats.

- `./mzk render <ID|arquivo> [--all] [--wav]` → `exports/<base>.mp3`: estéreo,
  320 kbps, 44,1 kHz, roteiro inteiro + 2 s de cauda, −14 LUFS / −1 dBTP, ID3 com
  título, compositor(es), ano, © e ID. Sem abrir programa nenhum.
- Motor: SuperCollider sem tempo real (`scsynth -N`). Synths, bateria sintetizada ou
  samples gratuitos de licença comercial livre, e instrumentos gravados (Rhodes,
  piano) quando o pacote pedir. Mixagem automática (reverb, delay, compressão,
  limitador) + `ffmpeg loudnorm`.
- **Pacotes de som**: Synthwave (primeiro), depois Lo-Fi, Lounge/Afro House e Neutro
  (qualquer outro gênero). Cada pacote define timbre, volume, pan e efeitos por
  trilha e uma levada padrão dos acordes (`pad`, `arp`, `padArp`…).
- Humanização leve e determinística (mesmo projeto → mesmo mp3).
- Escolhas no campo opcional `render` do projeto
  (`{ "pack": "synthwave", "levada": "padArp", "humanize": true, "style": "…" }`),
  editadas na parte "Som do MP3" da tela Projeto e sincronizadas. O som dentro do
  app continua o rascunho. **`.mid` e PDF ignoram `render`.**
- `.suno.txt` (estilo + instrumental + BPM + tom) e um arquivo de dados da obra para
  a futura skill de prompts.

Ordem: (1) motor + Synthwave + `./mzk render`; (2) "Som do MP3" no app +
`.suno.txt`; (3) pacotes Lo-Fi, Lounge e Neutro.

### Polir (`./mzk polir`)

Pós-tratamento das faixas baixadas do Suno, decidido em 2026-11-13. Correção lenta por
análise (STFT): mede 5–10 kHz e 10–16 kHz relativos ao total (energia suavizada em 3 s),
referência = percentil 75 da parte boa (10–50% da faixa), corta só o excesso (folga e corte
máximo por nível), com transições em cosseno; depois `deesser` e `loudnorm` (−14 LUFS,
−1 dBTP), mp3 320 kbps com capa e etiquetas do original. Original guardado em
`~/Muzeka/originais-suno/<Gênero>/`; resultado em `~/Muzeka/radio/<Gênero>/`.

### Polir (`./mzk polir`)

Trata a faixa baixada do Suno sem abrir programa: correção lenta da sibilância (5–10 kHz) e do
"ar" (10–16 kHz) contra a referência da parte boa da própria faixa (percentil 75 entre 10% e
50% da duração), de-esser leve, −14 LUFS / −1 dBTP, mp3 320 kbps com capa e etiquetas.
Níveis `--suave`, `--medio` (padrão), `--forte`. Saída em `~/Muzeka/radio/<Gênero>/`, original
guardado em `~/Muzeka/originais-suno/<Gênero>/` e sempre usado como fonte.

## 10. Ordem de construção

1. Núcleo + testes + `./mzk build`.
2. Editores e áudio.
3. PWA offline.
4. Sincronização GitHub + publicação (passo a passo guiado).
5. MP3 para o Suno (seção 9).

## 11. Fora da v1

Step-entry por teclado, modos, anacruse, quiálteras/swing, grade completa no PDF,
visão empilhada no desktop.
