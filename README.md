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
- `app/sync.js` — sincronização com o repositório privado (API do GitHub)
- `app/` — interface (HTML/CSS/JS puro, sem build)
- `index.html` — entrada do app
- `manifest.webmanifest`, `sw.js` — instalação e funcionamento offline
- `mzk` — linha de comando (`build`, `serve`)
- `scripts/configurar-github.sh` — assistente de configuração (GitHub, iPhone)
- `examples/` — projeto de exemplo
- `test/` — testes (`node --test`)
