# MZK Composer

Caderno de rascunhos musicais da Muzeka. Projeto `.json` → `.mid` (Format 1) +
partitura PDF (lead sheet via LilyPond). Especificação completa em [SPEC.md](SPEC.md).

## Requisitos (Linux)

- Node.js 20+
- LilyPond 2.24 (`sudo apt install lilypond`) para o PDF

## Usar o app

```sh
./mzk serve
```

Abra o endereço mostrado (`http://localhost:8080`) no navegador. O endereço
"no iPhone (mesmo Wi-Fi)" funciona no Safari do iPhone enquanto o computador
estiver ligado na mesma rede — mas sem HTTPS o iPhone não instala nem funciona
offline (isso chega na etapa 4, com o endereço no GitHub Pages).

- **Partes** (faixa abaixo do Play): toque numa parte para editá-la; toque de
  novo na parte atual para renomear, mudar o nº de compassos, duplicar ou apagar;
  **+** cria uma parte nova. A ordem de execução fica no Roteiro (aba Projeto).
- **Lead / Lead2 / Baixo**: toque numa célula cria nota; arraste para alongar;
  arraste uma nota para mover; toque numa nota apaga. Dois dedos rolam a grade.
- **Acordes**: toque num tempo e escolha a cifra (tonalidade, montagem ou texto).
- **Bateria**: toque alterna normal → acento → apaga; arraste pinta a linha.
- **Projeto**: título, compositor, ID, BPM, tom, compasso, seções, roteiro,
  mixer, abrir/salvar `.json`, exportar `.mid` (desktop).
- **Meus projetos** (aba Projeto): todos os projetos ficam salvos automaticamente
  no aparelho; abra, crie, importe `.json` ou apague por ali.
- **Offline / instalar**: com HTTPS (ou em `localhost`) o app funciona sem
  internet e pode ser instalado (iPhone: Compartilhar → Adicionar à Tela de Início).
- Atalhos no desktop: espaço (tocar/parar), Ctrl+Z / Ctrl+Shift+Z, 1–6 (abas),
  ← → (seção anterior/próxima).

## GitHub, iPhone e sincronização (configuração única)

```sh
./scripts/configurar-github.sh
```

Assistente passo a passo: instala o `gh`, entra na sua conta, publica o app no
GitHub Pages (HTTPS), cria o repositório **privado** `muzeka-composicoes`
(clonado em `~/Muzeka/composicoes`), gera a chave de acesso e conecta o
computador e o iPhone. Rode de novo quando a chave vencer (1 ano) ou para ligar
outro aparelho — ele pula o que já está pronto.

Depois disso, cada projeto vira `projects/MZK-0042.json` no repositório privado
(cada envio é uma versão datada). Se o mesmo projeto for editado nos dois
aparelhos, a versão do aparelho que sincronizar por último fica valendo e a outra
é guardada em `projects/conflitos/`.

## Gerar MIDI e partitura

```sh
./mzk build examples/MZK-0001_exemplo.json   # a partir de um arquivo
./mzk build MZK-0042                          # procura em ~/Muzeka/composicoes/projects
./mzk build --all --dir ~/outra/pasta
./mzk build MZK-0042 --registrar              # + commit e envio dos arquivos gerados
```

Antes de gerar, o `build` busca as versões novas do GitHub (`--no-pull` desliga).
Saída em `exports/`: `MZK-0042_titulo_92bpm_Am.mid`, `.ly` e `.pdf`.

## MP3 para o Suno (amostra)

Instale uma vez o motor de som (pede a senha do Linux):

```sh
./scripts/instalar-som.sh
```

Depois:

```sh
./mzk render MZK-0042        # gera exports/MZK-0042_titulo_92bpm_Am.mp3
./mzk render --all
./mzk render MZK-0042 --wav  # também um .wav sem compressão
```

O mp3 é uma **amostra intermediária** para enviar ao Suno: timbres do pacote de som
(por enquanto **Synthwave**), levada automática nos acordes, humanização leve,
volume no padrão de streaming (−14 LUFS) e etiquetas (título, autor, ©). Nada disso
muda o `.mid` nem o PDF de registro. Os timbres ficam em `sc/synthdefs.scd`
(SuperCollider); os compilados em `sc/defs/` já vêm prontos — para recompilar:
`sclang sc/synthdefs.scd` (na pasta do projeto).

## Polir faixas do Suno

```sh
./mzk polir "~/Downloads/Muzeka - Synthwave - From Now On.mp3"
./mzk polir ~/Muzeka/radio/Lounge/*.mp3 --suave
```

Trata a faixa baixada do Suno: mede a sibilância (5–10 kHz) e o "ar" (10–16 kHz) ao
longo da música, usa a parte boa da própria faixa como referência e abaixa só o
excesso (o agudo que o Suno vai piorando depois de uns 2 minutos); um de-esser leve
pega os picos e o volume vai a −14 LUFS. Níveis: `--suave`, `--medio` (padrão),
`--forte`. A capa do Suno é trocada pela da Muzeka (`~/Muzeka/capa-muzeka.jpg`; outra com
`--capa imagem.jpg`). O nome precisa seguir `Muzeka - Gênero - Título.mp3`.

- Resultado: `~/Muzeka/radio/<Gênero>/` (a pasta espelho do AzuraCast).
- Original: `~/Muzeka/originais-suno/<Gênero>/`, nunca alterado. Rodar de novo parte
  sempre do original (não acumula tratamento).
- Precisa de `python3` com `numpy` e `ffmpeg` (já vêm no Ubuntu Studio).

## Polir faixas do Suno

```sh
./mzk polir ~/Downloads/"Muzeka - Synthwave - From Now On.mp3"
./mzk polir --suave arquivo.mp3      # ou --forte
```

Mede a sibilância (5–10 kHz) e o "ar" (10–16 kHz) ao longo da faixa, usa a parte boa da
própria música como referência e abaixa só o excesso (o Suno costuma ficar mais estridente
depois de uns 2 minutos). Depois aplica um de-esser leve e o volume de streaming (−14 LUFS).
O nome precisa seguir `Muzeka - Gênero - Título.mp3`. Saída em `~/Muzeka/radio/<Gênero>/`;
o original fica intacto em `~/Muzeka/originais-suno/<Gênero>/`, e rodar de novo sempre parte
dele. Precisa de `python3` com `numpy` e `ffmpeg`.

## Testes

```sh
npm test
```

## Estrutura

- `src/core/` — núcleo sem dependências, roda no navegador e no Node:
  - `theory.js` — tonalidades, armaduras, grafia das notas
  - `chords.js` — cifras (parser BR/americano/jazz → canônico BR)
  - `voicing.js` — voicing automático com condução de vozes
  - `project.js` — formato do projeto, validação, roteiro
  - `midi.js` — gerador SMF Format 1
  - `lilypond.js` — gerador de lead sheet
  - `timeline.js` — timeline de notas (reprodução e MIDI)
  - `edit.js` — operações de edição (notas, acordes, seções, roteiro, baixo automático)
- `src/render/` — mp3: pacotes de som (`packs.js`), partitura de áudio (`score.js`),
  arquivo para o SuperCollider (`nrt.js`)
- `sc/` — timbres no SuperCollider (`synthdefs.scd`) e compilados (`defs/`)
- `app/sync.js` — sincronização com o repositório privado (API do GitHub)
- `app/` — interface (HTML/CSS/JS puro, sem build)
- `index.html` — entrada do app
- `manifest.webmanifest`, `sw.js` — instalação e funcionamento offline
- `mzk` — linha de comando (`build`, `render`, `polir`, `serve`)
- `scripts/configurar-github.sh` — assistente de configuração (GitHub, iPhone)
- `scripts/polir.py` — polidor de faixas do Suno (`./mzk polir`)
- `scripts/polir.py` — polidor das faixas do Suno (`./mzk polir`)
- `scripts/instalar-som.sh` — instala SuperCollider e ffmpeg para o `render`
- `examples/` — projeto de exemplo
- `test/` — testes (`node --test`)
