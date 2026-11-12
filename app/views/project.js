// Tela "Projeto": metadados, configurações, seções, roteiro, mixer e arquivos.

import { h, icon, isIOS, toast, TRACKS } from '../ui.js';
import {
  addSection, arrangementInsert, arrangementMove, arrangementRemove, deleteSection, duplicateSection,
  renameSection, setSectionBars, setTimeSignature,
} from '../../src/core/edit.js';
import { MAX_SECTION_BARS, TIME_SIGNATURES } from '../../src/core/project.js';
import { isValidKey, keyShortName } from '../../src/core/theory.js';

const TONICS = ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B', 'Cb', 'D#', 'G#', 'A#'];

export function createProjectView(host, { store, files, sync }) {
  const root = h('div.project');
  host.append(root);

  const field = (label, input, wide = false) => h(`div.field${wide ? '.wide' : ''}`, {}, h('label', {}, label), input);

  const text = (value, onchange, props = {}) =>
    h('input', { type: 'text', value: value ?? '', onchange: (e) => onchange(e.target.value), ...props });

  const editMeta = (fn) => store.edit((p) => fn(p.meta));
  const editSettings = (fn) => store.edit((p) => fn(p.settings));

  function metaSection() {
    const m = store.project.meta;
    return h('section', {},
      h('h2', {}, 'Obra'),
      h('div.fields', {},
        field('Título da obra', text(m.title, (v) => editMeta((x) => { x.title = v.trim() || 'Sem título'; })), true),
        field('Compositor(es) — separe por vírgula', text(m.composers.join(', '), (v) => editMeta((x) => {
          x.composers = v.split(',').map((s) => s.trim()).filter(Boolean);
        })), true),
        field('ID de catálogo', text(m.id, (v) => {
          const id = v.trim().toUpperCase();
          if (!/^MZK-\d{4,}$/.test(id)) { toast('Formato do ID: MZK-0042', { error: true }); render(); return; }
          if (store.idTaken(id)) { toast(`${id} já é usado por outro projeto deste aparelho.`, { error: true }); render(); return; }
          editMeta((x) => { x.id = id; });
        }, { autocapitalize: 'characters' })),
        field('Ano', h('input', {
          type: 'number', value: m.year, inputmode: 'numeric',
          onchange: (e) => editMeta((x) => { x.year = parseInt(e.target.value, 10) || x.year; }),
        })),
        field('Copyright (vazio = automático)', text(m.copyright, (v) => editMeta((x) => { x.copyright = v; }), {
          placeholder: `© ${m.year} ${m.composers.join(', ')}`,
        }), true),
        field('Notas (mood, uso na rádio…)', h('textarea', {
          value: m.notes ?? '', onchange: (e) => editMeta((x) => { x.notes = e.target.value; }),
        }), true),
      ));
  }

  function settingsSection() {
    const s = store.project.settings;
    const tonic = h('select', {
      onchange: (e) => {
        const key = { tonic: e.target.value, mode: s.key.mode };
        if (!isValidKey(key)) { toast(`${keyShortName(key)} não é uma tonalidade usual. Escolha a enarmônica.`, { error: true }); render(); return; }
        editSettings((x) => { x.key = key; });
      },
    }, TONICS.map((t) => h('option', { value: t, selected: t === s.key.tonic }, t)));
    const mode = h('select', {
      onchange: (e) => {
        const key = { tonic: s.key.tonic, mode: e.target.value };
        if (!isValidKey(key)) { toast(`${keyShortName(key)} não é uma tonalidade usual. Escolha a enarmônica.`, { error: true }); render(); return; }
        editSettings((x) => { x.key = key; });
      },
    }, [['major', 'Maior'], ['minor', 'Menor']].map(([v, l]) => h('option', { value: v, selected: v === s.key.mode }, l)));
    const tsSel = h('select', {
      onchange: (e) => {
        const ts = e.target.value.split('/').map(Number);
        const shrinking = ts[0] < s.timeSignature[0];
        if (shrinking && !confirm('Diminuir o compasso apaga o que passar do fim de cada compasso. Continuar?')) { render(); return; }
        store.edit((p) => setTimeSignature(p, ts));
      },
    }, TIME_SIGNATURES.map(([n, d]) => h('option', { value: `${n}/${d}`, selected: n === s.timeSignature[0] }, `${n}/${d}`)));
    return h('section', {},
      h('h2', {}, 'Música'),
      h('div.fields', {},
        field('BPM', h('input', {
          type: 'number', min: 20, max: 300, value: s.bpm, inputmode: 'numeric',
          onchange: (e) => {
            const v = Math.round(Number(e.target.value));
            if (!(v >= 20 && v <= 300)) { toast('BPM entre 20 e 300.', { error: true }); render(); return; }
            editSettings((x) => { x.bpm = v; });
          },
        })),
        field('Tonalidade', h('div.row', {}, tonic, mode)),
        field('Fórmula de compasso', tsSel),
        field('Nome da trilha Lead2', text(s.lead2Name, (v) => editSettings((x) => { x.lead2Name = v.trim() || 'Lead2'; }))),
      ));
  }

  function sectionsSection() {
    const p = store.project;
    return h('section', {},
      h('h2', {}, 'Seções'),
      ...p.sections.map((sec) => h(`div.section-row${sec.id === store.ui.sectionId ? '.current' : ''}`, {},
        h('input', { type: 'text', value: sec.name, onchange: (e) => store.edit((x) => renameSection(x, sec.id, e.target.value)) }),
        h('input', {
          type: 'number', min: 1, max: MAX_SECTION_BARS, value: sec.bars, inputmode: 'numeric', title: 'Compassos',
          onchange: (e) => {
            const bars = parseInt(e.target.value, 10);
            if (!(bars >= 1 && bars <= MAX_SECTION_BARS)) { toast(`De 1 a ${MAX_SECTION_BARS} compassos.`, { error: true }); render(); return; }
            if (bars < sec.bars && !confirm(`Encurtar "${sec.name}" apaga o que estiver depois do compasso ${bars}. Continuar?`)) { render(); return; }
            store.edit((x) => setSectionBars(x, sec.id, bars));
          },
        }),
        h('button', { onclick: () => store.setUi({ sectionId: sec.id, tab: store.ui.lastTrackTab || 'lead' }) }, 'Editar'),
        h('button', {
          title: 'Duplicar',
          onclick: () => {
            const copy = store.edit((x) => duplicateSection(x, sec.id));
            store.setUi({ sectionId: copy.id });
          },
        }, 'Duplicar'),
        h('button.danger', {
          title: 'Apagar',
          disabled: p.sections.length <= 1,
          onclick: () => {
            if (confirm(`Apagar a seção "${sec.name}" e tirá-la do roteiro?`)) store.edit((x) => deleteSection(x, sec.id));
          },
        }, icon('close')),
      )),
      h('div.row', { style: { marginTop: '10px' } },
        h('button', {
          onclick: () => {
            const s = store.edit((x) => addSection(x));
            store.setUi({ sectionId: s.id });
          },
        }, icon('plus'), ' Nova seção')),
    );
  }

  function arrangementSection() {
    const p = store.project;
    const byId = new Map(p.sections.map((s) => [s.id, s]));
    return h('section', {},
      h('h2', {}, `Roteiro (${p.arrangement.length})`),
      h('div.arr-list', {}, p.arrangement.map((id, i) => h('div.arr-chip', {},
        h('button', { title: 'Mover para a esquerda', disabled: i === 0, onclick: () => store.edit((x) => arrangementMove(x, i, -1)) }, icon('left')),
        h('span', {}, byId.get(id)?.name ?? '?'),
        h('button', { title: 'Mover para a direita', disabled: i === p.arrangement.length - 1, onclick: () => store.edit((x) => arrangementMove(x, i, 1)) }, icon('right')),
        h('button', { title: 'Tirar do roteiro', disabled: p.arrangement.length <= 1, onclick: () => store.edit((x) => arrangementRemove(x, i)) }, icon('close')),
      ))),
      h('div.muted', {}, 'Acrescentar ao fim:'),
      h('div.row', { style: { marginTop: '6px' } }, p.sections.map((s) => h('button', {
        onclick: () => store.edit((x) => arrangementInsert(x, x.arrangement.length, s.id)),
      }, `+ ${s.name}`))),
    );
  }

  function mixerSection() {
    const ui = store.ui;
    const setMix = (k, patch, what = 'ui') => store.setUi({ [k]: { ...ui[k], ...patch } }, what);
    return h('section', {},
      h('h2', {}, 'Mixer (só para ouvir — não vai para o MIDI)'),
      ...TRACKS.map((t) => h('div.mixer-row', {},
        h('span.name', { style: { '--c': t.color } }, h('i'), t.key === 'lead2' ? store.project.settings.lead2Name : t.label),
        h('input', {
          type: 'range', min: 0, max: 1, step: 0.05, value: ui.volume[t.key] ?? 0.8,
          oninput: (e) => setMix('volume', { [t.key]: Number(e.target.value) }, 'mix'),
        }),
        h(`button${ui.mute[t.key] ? '.on' : ''}`, { onclick: () => setMix('mute', { [t.key]: !ui.mute[t.key] }) }, 'M'),
        h(`button${ui.solo[t.key] ? '.on' : ''}`, { onclick: () => setMix('solo', { [t.key]: !ui.solo[t.key] }) }, 'S'),
      )));
  }

  function projectsSection() {
    const fmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    return h('section', {},
      h('h2', {}, 'Meus projetos (neste aparelho)'),
      ...store.index.map((r) => {
        const current = r.key === store.currentKey;
        return h(`div.project-row${current ? '.current' : ''}`, {},
          h('div.info', {},
            h('strong', {}, r.title),
            h('span.muted', {}, `${r.id} · ${fmt.format(r.updatedAt)}${current ? ' · aberto' : ''}`)),
          current ? null : h('button', { onclick: () => files.openKey(r.key) }, 'Abrir'),
          h('button.danger', { title: 'Apagar', onclick: () => files.deleteKey(r.key) }, icon('close')));
      }),
      h('div.row', { style: { marginTop: '10px' } },
        h('button', { onclick: files.newProject }, icon('plus'), ' Novo projeto'),
        h('button', { onclick: files.open }, 'Importar .json'),
        h('button.ghost', { onclick: files.loadExample }, 'Abrir exemplo')),
      store.persistent ? null : h('p.muted', {}, '⚠ Este navegador não permite salvar no aparelho. Salve o .json antes de fechar.'),
    );
  }

  function syncSection() {
    const st = store.ui.sync ?? { state: 'off' };
    const cfg = sync.config;
    if (!cfg) {
      const repo = h('input', { type: 'text', placeholder: 'seu-usuario/muzeka-composicoes', autocapitalize: 'off', autocomplete: 'off', spellcheck: false });
      const token = h('input', { type: 'password', placeholder: 'github_pat_…', autocomplete: 'off' });
      return h('section', {},
        h('h2', {}, 'Sincronizar com o GitHub'),
        h('p.muted', {}, 'Liga este aparelho ao repositório privado das composições: o que você faz aqui aparece no outro aparelho.'),
        h('div.fields', {},
          h('div.field.wide', {}, h('label', {}, 'Repositório privado'), repo),
          h('div.field.wide', {}, h('label', {}, 'Chave de acesso (token)'), token)),
        h('p.muted', {}, 'Ainda não tem a chave deste aparelho? Escreva o repositório acima e toque em "Criar chave". '
          + 'Na página do GitHub, em "Repository access", escolha "Only select repositories" → muzeka-composicoes, '
          + 'gere a chave, copie e cole aqui.'),
        h('div.row', { style: { marginTop: '10px' } },
          h('button', {
            onclick: () => {
              const owner = repo.value.trim().replace(/^https?:\/\/github\.com\//, '').split('/')[0];
              const params = new URLSearchParams({
                name: `MZK Composer - ${isIOS() ? 'iPhone' : 'computador'}`,
                description: 'Sincronizar composições do MZK Composer (só o repositório muzeka-composicoes).',
                expires_in: '366',
                contents: 'write',
                ...(owner ? { target_name: owner } : {}),
              });
              window.open(`https://github.com/settings/personal-access-tokens/new?${params}`, '_blank', 'noopener');
            },
          }, 'Criar chave no GitHub'),
          h('button.primary', {
            onclick: async (e) => {
              e.target.disabled = true;
              try {
                const r = await sync.connect({ repo: repo.value, token: token.value });
                if (r?.error) throw r.error;
                if (!r?.conflicts?.length) toast(`Conectado! ${r ? `${r.up} enviado(s), ${r.down} recebido(s).` : ''}`);
              } catch (err) {
                toast(err.message, { error: true });
              } finally {
                e.target.disabled = false;
                render();
              }
            },
          }, 'Conectar')));
    }
    const fmt = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' });
    const status = {
      idle: st.at ? `Sincronizado às ${fmt.format(st.at)}.` : 'Conectado.',
      syncing: 'Sincronizando…',
      error: st.message,
      offline: st.message || 'Sem internet.',
    }[st.state] ?? '';
    return h('section', {},
      h('h2', {}, 'Sincronizar com o GitHub'),
      h('p', {}, 'Conectado a ', h('strong', {}, cfg.repo)),
      h(`p.${st.state === 'error' ? 'error-text' : 'muted'}`, {}, status),
      h('p.muted', {}, 'Sincroniza sozinho 30 s depois da última edição, ao sair do app e ao abrir.'),
      h('div.row', {},
        h('button', {
          onclick: async () => {
            const r = await sync.run();
            if (r?.error) toast(r.error.message, { error: true });
            else if (r && !r.conflicts.length) toast(r.up || r.down ? `Sincronizado: ${r.up} enviado(s), ${r.down} recebido(s).` : 'Tudo sincronizado.');
          },
        }, icon('cloud'), ' Sincronizar agora'),
        h('button.danger', {
          onclick: () => {
            if (confirm('Desconectar este aparelho do GitHub? Os projetos continuam salvos aqui.')) { sync.disconnect(); render(); }
          },
        }, 'Desconectar')));
  }

  function installSection() {
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    let body;
    if (standalone) body = h('p.muted', {}, 'App instalado. Funciona sem internet; os projetos ficam salvos neste aparelho.');
    else if (!window.isSecureContext) {
      body = h('p.muted', {}, 'Este endereço não tem HTTPS, então o app não pode ser instalado nem funcionar offline aqui. '
        + 'Na etapa 4 ele ganha um endereço próprio com HTTPS.');
    } else if (isIOS()) {
      body = h('p.muted', {}, 'No Safari: toque em Compartilhar (quadrado com seta para cima) → "Adicionar à Tela de Início".');
    } else if (store.ui.installPrompt) {
      body = h('button.primary', {
        onclick: async () => {
          const ev = store.ui.installPrompt;
          ev.prompt();
          await ev.userChoice;
          store.setUi({ installPrompt: null });
        },
      }, 'Instalar app');
    } else {
      body = h('p.muted', {}, 'Chrome/Edge: use o ícone de instalar na barra de endereço. No Firefox o app funciona normalmente pelo navegador.');
    }
    return h('section', {}, h('h2', {}, 'Instalar no aparelho'), body);
  }

  function filesSection() {
    return h('section', {},
      h('h2', {}, 'Arquivos deste projeto'),
      h('div.row', {},
        h('button', { onclick: files.saveJson }, isIOS() ? 'Compartilhar .json' : 'Salvar .json'),
        isIOS() ? null : h('button.primary', { onclick: files.exportMidi }, 'Exportar .mid'),
      ),
      h('p.muted', {}, isIOS()
        ? 'No iPhone o trabalho fica salvo neste aparelho. MIDI e partitura são gerados no computador.'
        : 'Partitura PDF: ./mzk build <arquivo.json> no terminal.'),
    );
  }

  function render() {
    const y = root.scrollTop;
    root.replaceChildren(
      projectsSection(), metaSection(), settingsSection(), sectionsSection(), arrangementSection(),
      mixerSection(), filesSection(), syncSection(), installSection(),
    );
    root.scrollTop = y;
  }

  render();
  return {
    update(what) {
      if (what === 'mix') return; // arrastando volume: não recria o controle
      // Salvamento automático (index) não redesenha enquanto o usuário digita.
      const a = document.activeElement;
      if (what === 'index' && root.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
      render();
    },
    setPlayhead() {},
    destroy() { root.remove(); },
  };
}

