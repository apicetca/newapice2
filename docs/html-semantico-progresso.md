# Conversão para HTML semântico — progresso

Acompanha a troca de `<div>` por HTML semântico, uma página por vez. Ordem e contagem vêm de [html-semantico-inventario.md](html-semantico-inventario.md).

## Como cada página é validada

- **Pergunta 1 (visual):** `node scripts/comparar-telas.js comparar <página>`. É **SIM** só com 0 pixel diferente em todas as capturas da página (3 larguras × cada papel que a abre).
- **Pergunta 2 (funções):** `node scripts/verificar-funcoes.js comparar <página>` deve terminar em `OK`, e `npm test` deve passar inteiro.
- Se a mudança tocar CSS, JS ou partial compartilhado, as duas perguntas também rodam em **todas** as páginas que usam esse arquivo, incluindo as protegidas. Qualquer diferença conta como NÃO.
- **SIM + SIM:** commit `refactor(html): <página> semântica` e registro abaixo. **NÃO:** até 2 tentativas de correção. Se continuar NÃO, `git restore`, registro do que falhou e parada para decisão.
- Os arquivos `tests/visual/base/`, `tests/funcoes/base/`, `scripts/comparar-telas.js`, `scripts/verificar-funcoes.js`, `scripts/telas.js` e os testes não são alterados para fazer algo passar.

## Base de referência

Gerada em 2026-10-25, no commit `ab2b03a` (as 6 páginas protegidas já convertidas; todas as outras no estado original, inclusive `roadmap/index.ejs`).

| Ferramenta | Telas na base | Onde |
|---|---:|---|
| Visual (`comparar-telas.js`) | **156 capturas** (52 telas × 1440/768/375) | `tests/visual/base/` |
| Funções (`verificar-funcoes.js`) | **52 telas** (roteiro em 1440 px) | `tests/funcoes/base/` |

**Controle sem nenhuma mudança no código** (comparação logo depois do base): visual **156 de 156 iguais**, funções **OK nas 52 telas**.

Como as ferramentas se protegem de ruído (sem afrouxar o critério de 0 pixel / 0 diferença):

- Esperam a página estabilizar: rede quieta **e** DOM sem mudanças por 800 ms (limite 45 s).
- Visual: animações vão direto ao estado final; no base, cada tela é capturada 2 vezes e as duas precisam bater (uma 3ª desempata); no comparar, se houver diferença, a tela é recapturada até 2 vezes e vale a menor diferença. Mudança real persiste nas 3 tentativas; ruído de renderização de texto não.
- Funções: relógio da página falso, avançado 1,5 s depois de carregar e de cada ação (timers da página disparam sempre igual); base executado 2 vezes; no comparar, até 2 repetições se houver diferença.

- Sessões: `auth-dev.json` (conta dev `arthxzz`), `auth-empresa.json` (conta de teste `teste-visual-empresa@apice.dev`, 2 vagas), `auth-admin.json` (admin do `.env`). Os três arquivos estão no `.gitignore`.
- Ids usados (descobertos no base): vaga pública 1, vaga da empresa 10, dev 5, roadmap 9, planos `dev_pro` / `empresa_basico`.
- **Fora da base:** `roadmap.ejs` (`/roadmap?job=`): a conta dev não tem nenhuma vaga em andamento em "Meu progresso", então não houve id para abrir. Essa página tem 0 `<div>` e não entra no ciclo. Também fica de fora `500.ejs`, que não dá para provocar de forma estável.
- Base e comparação dependem do banco não mudar entre as rodadas (vagas, mensagens e repositórios do GitHub da conta dev).

## Protegidas — não mexer

| Página | `<div>` no inventário | Status |
|---|---:|---|
| [empresa-vaga-form.ejs](../views/empresa-vaga-form.ejs) | 27 | concluída — validada manualmente, não mexer (commit `ab2b03a`) |
| [admin-configuracoes.ejs](../views/admin-configuracoes.ejs) | 2 | concluída — validada manualmente, não mexer (commit `ab2b03a`) |
| [empresa-vagas.ejs](../views/empresa-vagas.ejs) | 2 | concluída — validada manualmente, não mexer (commit `ab2b03a`) |
| [empresa-candidaturas.ejs](../views/empresa-candidaturas.ejs) | 1 | concluída — validada manualmente, não mexer (commit `ab2b03a`) |
| [admin-relatorios.ejs](../views/admin-relatorios.ejs) | 3 | concluída — validada manualmente, não mexer (commit `ab2b03a`) |
| [insights-mercado.ejs](../views/insights-mercado.ejs) | 8 | concluída — validada manualmente, não mexer (commit `ab2b03a`) |

Nunca editar estes `.ejs`. Elas continuam na base e entram nas perguntas 1 e 2 sempre que uma mudança tocar arquivo compartilhado com elas.

## Pendentes — na ordem do inventário

| # | Página | `<div>` | Telas (papel e rota) | Status |
|---:|---|---:|---|---|
| 1 | [vagas.ejs](../views/vagas.ejs) | 63 | visitante `/vagas`<br>dev `/vagas`<br>empresa `/vagas` | pendente |
| 2 | [progresso.ejs](../views/progresso.ejs) | 46 | dev `/meu-progresso` | pendente |
| 3 | [repositorios.ejs](../views/repositorios.ejs) | 36 | dev `/repositorios` | pendente |
| 4 | [perfil-dev.ejs](../views/perfil-dev.ejs) | 34 | dev `/perfil` | pendente |
| 5 | [minha-assinatura.ejs](../views/minha-assinatura.ejs) | 31 | dev `/minha-assinatura`<br>empresa `/minha-assinatura` | pendente |
| 6 | [perfil-empresa.ejs](../views/perfil-empresa.ejs) | 30 | empresa `/empresa/perfil` | pendente |
| 7 | [vaga-publica.ejs](../views/vaga-publica.ejs) | 28 | visitante `/vagas/{vaga}`<br>dev `/vagas/{vaga}`<br>empresa `/vagas/{vaga}` | pendente |
| 8 | [perfil-dev-empresa.ejs](../views/perfil-dev-empresa.ejs) | 23 | empresa `/empresa/dev/{dev}` | pendente |
| 9 | [roadmap/detalhe.ejs](../views/roadmap/detalhe.ejs) | 16 | dev `/trilha/{roadmap}` | pendente |
| 10 | [empresa-mensagens.ejs](../views/empresa-mensagens.ejs) | 14 | empresa `/empresa/mensagens` | pendente |
| 11 | [mensagens.ejs](../views/mensagens.ejs) | 14 | dev `/mensagens` | pendente |
| 12 | [assinar.ejs](../views/assinar.ejs) | 13 | dev `/planos/{planoDev}/assinar`<br>empresa `/planos/{planoEmpresa}/assinar` | pendente |
| 13 | [planos.ejs](../views/planos.ejs) | 12 | dev `/planos`<br>empresa `/planos` | pendente |
| 14 | [redefinir-senha.ejs](../views/redefinir-senha.ejs) | 10 | visitante `/redefinir-senha` | pendente |
| 15 | [cadastro.ejs](../views/cadastro.ejs) | 9 | visitante `/cadastro` | pendente |
| 16 | [esqueci-senha.ejs](../views/esqueci-senha.ejs) | 9 | visitante `/esqueci-senha` | pendente |
| 17 | [index.ejs](../views/index.ejs) | 9 | visitante `/` | pendente |
| 18 | [mentor.ejs](../views/mentor.ejs) | 9 | dev `/mentor` | pendente (revisada antes nesta conversa sem troca proposta; passa pelo ciclo de novo) |
| 19 | [roadmap/index.ejs](../views/roadmap/index.ejs) | 9 | dev `/trilha` | pendente |
| 20 | [roadmap/novo.ejs](../views/roadmap/novo.ejs) | 9 | dev `/trilha/novo` | pendente |
| 21 | [assinatura-resultado.ejs](../views/assinatura-resultado.ejs) | 8 | dev `/assinatura/retorno`<br>empresa `/assinatura/retorno` | pendente (revisada antes nesta conversa sem troca proposta; passa pelo ciclo de novo) |
| 22 | [dashboard.ejs](../views/dashboard.ejs) | 8 | dev `/dashboard` | pendente (revisada antes nesta conversa sem troca proposta; passa pelo ciclo de novo) |
| 23 | [login.ejs](../views/login.ejs) | 7 | visitante `/login` | pendente (revisada antes nesta conversa sem troca proposta; passa pelo ciclo de novo) |
| 24 | [sobre.ejs](../views/sobre.ejs) | 7 | visitante `/sobre` | pendente (revisada antes nesta conversa sem troca proposta; passa pelo ciclo de novo) |
| 25 | [para-empresas.ejs](../views/para-empresas.ejs) | 4 | visitante `/para-empresas` | pendente (revisada antes nesta conversa sem troca proposta; passa pelo ciclo de novo) |
| 26 | [para-devs.ejs](../views/para-devs.ejs) | 3 | visitante `/para-devs` | pendente (revisada antes nesta conversa sem troca proposta; passa pelo ciclo de novo) |
| 27 | [empresa-matchs.ejs](../views/empresa-matchs.ejs) | 1 | empresa `/empresa/matchs` | pendente (revisada antes nesta conversa sem troca proposta; passa pelo ciclo de novo) |

### Sem `<div>` — nada a converter

Ficam fora do ciclo porque não têm nenhuma `<div>`: `404`, `500`, `admin-dashboard`, `admin-empresas`, `admin-matchs`, `admin-usuarios`, `admin-vagas`, `empresa-dashboard`, `empresa-desenvolvedores`, `roadmap`, `partials/header`, `partials/header-dev`, `partials/header-company`, `partials/header-admin`.
`admin-dashboard` estava na lista das 9 revisadas, mas também não tem `<div>`.

### Partials (conferidos em 2026-10-25)

`views/partials/` tem 4 arquivos, e são os únicos `.ejs` incluídos por `include()` em todo o projeto (não há partial de footer nem outro fragmento). Nenhum tem `<div>`, nem no markup nem em JS, então nenhum entra na lista de pendentes.

| Partial | `<div>` | Incluído por |
|---|---:|---|
| `partials/header.ejs` (visitante) | 0 | index, insights-mercado, para-devs, para-empresas, sobre, vaga-publica, vagas |
| `partials/header-dev.ejs` | 0 | 18 páginas: assinar, assinatura-resultado, dashboard, insights-mercado, mensagens, mentor, minha-assinatura, perfil-dev, planos, progresso, repositorios, roadmap, roadmap/detalhe, roadmap/index, roadmap/novo, sobre, vaga-publica, vagas |
| `partials/header-company.ejs` | 0 | 17 páginas: assinar, assinatura-resultado, empresa-candidaturas, empresa-dashboard, empresa-desenvolvedores, empresa-matchs, empresa-mensagens, empresa-vaga-form, empresa-vagas, insights-mercado, minha-assinatura, perfil-dev-empresa, perfil-empresa, planos, sobre, vaga-publica, vagas |
| `partials/header-admin.ejs` | 0 | as 7 páginas de admin |

Se algum partial for alterado durante o ciclo, as perguntas 1 e 2 rodam em todas as páginas que o incluem (tabela acima), inclusive as protegidas.

## Conferência manual no fim

Estas páginas seguem o ciclo normalmente. A lista serve só para a conferência manual depois de todas as conversões.

**O roteiro não teve efeito no base (faltou dado ou token)**, então a pergunta 2 não exercitou essas interações:

- `empresa-mensagens`: a empresa de teste não tem conversas, então abrir conversa, digitar e enviar ficaram "ausente"/"invisível".
- `redefinir-senha`: sem token na URL os campos ficam desabilitados, então preencher e enviar não tiveram efeito.
- `empresa-matchs`: a empresa de teste não tem match, então "aceitar" ficou ausente.

**Páginas com animações próprias** (o base visual leva toda animação ao estado final e não registra transições, então o movimento em si não foi comparado). As **27 pendentes** têm animação própria: cada uma carrega um CSS de página com pelo menos `fadeUp`.

| Página | Animações próprias (`@keyframes`) | Declarações próprias (animação / transição) | Origem |
|---|---|---:|---|
| vagas | fadeUp, pulse | 7 / 14 | `dev.css`, `vagas.css` |
| progresso | fadeUp, spin, pulse | 7 / 14 | `dev.css`, `progresso.css` |
| repositorios | fadeUp, skel-shimmer, backdrop-in, modal-in, sheet-in, spin | 7 / 17 | `dev.css`, `repositorios.css`, `<style>`/`style=""` |
| perfil-dev | fadeUp, shimmer, pulseDot, savedPop, spin | 8 / 15 | `dev.css`, `perfil.css` |
| minha-assinatura | spin, fadeUp, shimmer, pulseDot, savedPop, sub-spin | 14 / 33 | `empresa-dashboard.css`, `dev.css`, `perfil.css`, `assinatura.css` |
| perfil-empresa | fadeUp, shimmer, pulseDot, savedPop, spin | 8 / 15 | `dev.css`, `perfil.css` |
| vaga-publica | spin, fadeUp | 4 / 5 | `vaga-publica.css` |
| perfil-dev-empresa | fadeUp | 2 / 11 | `dev.css`, `<style>`/`style=""` |
| roadmap/detalhe | fadeUp, rmSpin | 3 / 11 | `dev.css`, `trilha.css` |
| empresa-mensagens | spin, fadeUp, bubbleIn | 6 / 25 | `empresa-dashboard.css`, `mensagens.css` |
| mensagens | spin, fadeUp, bubbleIn | 6 / 25 | `empresa-dashboard.css`, `mensagens.css` |
| assinar | spin, fadeUp, shimmer, pulseDot, savedPop, sub-spin | 14 / 33 | `empresa-dashboard.css`, `dev.css`, `perfil.css`, `assinatura.css` |
| planos | spin, fadeUp, shimmer, pulseDot, savedPop, sub-spin | 14 / 34 | `empresa-dashboard.css`, `dev.css`, `perfil.css`, `assinatura.css`, `<style>`/`style=""` |
| redefinir-senha | fadeUp, pulse-dot | 5 / 12 | `auth.css` |
| cadastro | fadeUp, pulse-dot | 5 / 12 | `auth.css` |
| esqueci-senha | fadeUp, pulse-dot | 5 / 12 | `auth.css` |
| index | fadeIn, fadeUp, logos-scroll | 3 / 14 | `landing.css` |
| mentor | fadeUp, bubbleIn | 2 / 10 | `mensagens.css` |
| roadmap/index | fadeUp, rmSpin | 3 / 11 | `dev.css`, `trilha.css` |
| roadmap/novo | fadeUp, rmSpin | 3 / 11 | `dev.css`, `trilha.css` |
| assinatura-resultado | spin, fadeUp, shimmer, pulseDot, savedPop, sub-spin | 14 / 33 | `empresa-dashboard.css`, `dev.css`, `perfil.css`, `assinatura.css` |
| dashboard | fadeUp, spin | 6 / 10 | `dev.css`, `dashboard.css` |
| login | fadeUp, pulse-dot | 5 / 12 | `auth.css` |
| sobre | fadeUp, revealIn | 4 / 10 | `dev.css`, `sobre.css`, `reveal.css` |
| para-empresas | fadeUp, revealIn | 4 / 10 | `dev.css`, `para-devs.css`, `reveal.css` |
| para-devs | fadeUp, revealIn | 4 / 10 | `dev.css`, `para-devs.css`, `reveal.css` |
| empresa-matchs | fadeUp, spin | 7 / 15 | `dev.css`, `empresa-matchs.css` |

> **Observação — animações e transições globais**, presentes em todas as páginas e não listadas acima: `fieldErrorIn` (mensagem de erro de campo, em `design-system.css`) e 25 transições do header/menu em `header.css`. `empresa-theme.css`, carregado pelo header de empresa, não tem nenhuma.

Contagem feita no CSS que a própria página carrega (sem `design-system.css`, `header.css` e o CSS dos partials), nos `<style>` e nos `style=""`, ignorando comentários e valores `none`. Em `minha-assinatura`, `assinar`, `planos` e `assinatura-resultado` o CSS muda conforme o tipo de conta (`dev.css` ou `empresa-dashboard.css`); a contagem soma os dois.

## Registro do ciclo

Uma entrada por página, na ordem em que for processada: resultado das perguntas 1 e 2, commit, `<div>` trocadas, `<div>` mantidas com o motivo e, se falhar, o que falhou.

_Nenhuma página processada ainda._

## Roteiro de cada página (`verificar-funcoes.js`)

Cada roteiro roda igual na base e na comparação, em 1440 px, logado com o papel indicado. Elementos são encontrados por id, classe, `name`, atributo, `role` ou texto, nunca pela tag. Toda requisição que não seja GET é bloqueada: fica registrada (método, caminho, corpo) e recebe `{"success":true,"id":1}`. Em cada 📸 o script registra URL, texto visível, valores dos campos, elementos abertos/pressionados/selecionados, foco, e ao final as requisições bloqueadas, diálogos (`alert`/`confirm`) e erros de JS.

**Passos sem efeito na base** (o elemento não existe com os dados atuais; ficam registrados como "ausente"/"invisível" e a comparação exige que continuem assim):

- `redefinir-senha`: sem token na URL os campos ficam desabilitados, então preencher e enviar não têm efeito.
- `vaga-publica` (visitante e empresa): o botão `#btn-apply` só aparece para dev.
- `empresa-matchs`: a empresa de teste não tem match para aceitar.
- `empresa-mensagens`: a empresa de teste não tem conversas, então abrir conversa e enviar mensagem não têm efeito.
- `empresa-candidaturas`: a vaga não tem candidaturas, então não há "Gerar resumo com IA".

### index (visitante)

1. 📸 registra estado "inicial"

### login (visitante)

1. 📸 registra estado "inicial"
2. clica em `#tab-empresa`
3. 📸 registra estado "aba empresa"
4. clica em `#tab-dev`
5. clica em `#btn`
6. 📸 registra estado "envio vazio (validação)"
7. preenche `#email` com "verificacao@exemplo.com"
8. preenche `#password` com "senha-de-teste-123"
9. clica em `#toggle-pass`
10. 📸 registra estado "senha visível"
11. clica em `#btn`
12. 📸 registra estado "após enviar"

### cadastro (visitante)

1. 📸 registra estado "inicial"
2. clica em `#tab-empresa`
3. 📸 registra estado "aba empresa"
4. clica em `#tab-dev`
5. clica em `#btn`
6. 📸 registra estado "envio vazio (validação)"
7. preenche `#email` com "verificacao@exemplo.com"
8. preenche `#password` com "SenhaTeste123"
9. preenche `#confirm` com "SenhaTeste123"
10. preenche `#dev-nome` com "Teste"
11. escolhe a opção nº 1 de `#dev-nivel`
12. clica em `#toggle-pass-p`
13. 📸 registra estado "preenchido"
14. clica em `#btn`
15. 📸 registra estado "após enviar"

### esqueci-senha (visitante)

1. 📸 registra estado "inicial"
2. clica em `#btn`
3. 📸 registra estado "envio vazio (validação)"
4. preenche `#email` com "verificacao@exemplo.com"
5. clica em `#btn`
6. 📸 registra estado "após enviar"

### redefinir-senha (visitante)

1. 📸 registra estado "inicial"
2. preenche `#password` com "SenhaNova123"
3. preenche `#confirm` com "SenhaNova123"
4. clica em `#toggle-pass-p`
5. 📸 registra estado "preenchido"
6. clica em `#btn`
7. 📸 registra estado "após enviar"

### vagas (visitante, dev, empresa)

1. 📸 registra estado "inicial"
2. preenche `#q` com "front"
3. 📸 registra estado "busca 'front'"
4. limpa `#q`
5. clica em `.filter-chip[data-filter='nivel'][data-val='junior']`
6. 📸 registra estado "filtro júnior"
7. clica em `.filter-chip[data-filter='nivel'][data-val='todos']`
8. clica em `.filter-chip[data-filter='area'][data-val='backend']`
9. 📸 registra estado "filtro backend"
10. clica em `.filter-chip[data-filter='area'][data-val='todas']`
11. escolhe a opção nº 1 de `#sort-select`
12. 📸 registra estado "ordenado A→Z"

### vaga-publica (visitante, dev, empresa)

1. 📸 registra estado "inicial"
2. clica em `#btn-apply`
3. 📸 registra estado "após candidatar"

### insights-mercado (visitante, dev, empresa)

1. 📸 registra estado "inicial"

### para-devs (visitante)

1. 📸 registra estado "inicial"
2. clica em `.pd-faq__item`
3. 📸 registra estado "primeira pergunta aberta"

### para-empresas (visitante)

1. 📸 registra estado "inicial"
2. clica em `.pd-faq__item`
3. 📸 registra estado "primeira pergunta aberta"

### sobre (visitante)

1. 📸 registra estado "inicial"

### 404 (visitante)

1. 📸 registra estado "inicial"

### dashboard (dev)

1. 📸 registra estado "inicial"
2. clica em `.task-btn[data-etapa-id]`
3. 📸 registra estado "após marcar etapa"

### progresso (dev)

1. 📸 registra estado "inicial"
2. clica em `.status-tab[data-filter='concluido']`
3. 📸 registra estado "aba concluídos"
4. clica em `.status-tab[data-filter='todos']`
5. 📸 registra estado "aba todos"

### repositorios (dev)

1. 📸 registra estado "inicial"
2. clica em `#btn-open-add`
3. 📸 registra estado "modal adicionar aberto"
4. preenche `#modal-search` com "a"
5. 📸 registra estado "busca no modal"
6. clica em `#btn-close-add`
7. clica em `.js-edit`
8. 📸 registra estado "modal editar aberto"
9. clica em `#btn-cancel-edit`
10. clica em `.js-toggle-visibility`
11. 📸 registra estado "após alternar visibilidade"

### roadmap (dev)

1. 📸 registra estado "inicial"
2. clica em `.btn-status`
3. 📸 registra estado "após mudar status"

### mensagens (dev)

1. 📸 registra estado "inicial"
2. clica em `.msg-filter-tab[data-f='nao-lidas']`
3. 📸 registra estado "filtro não lidas"
4. clica em `.msg-filter-tab[data-f='todas']`
5. clica em `.msg-conv-item`
6. 📸 registra estado "conversa aberta"
7. preenche `#msgInput` com "Mensagem de verificação"
8. clica em `#msgSendBtn`
9. 📸 registra estado "após enviar"
10. clica em `#btnNewConv`
11. preenche `#jobSearchInput` com "dev"
12. 📸 registra estado "modal nova conversa"

### mentor (dev)

1. 📸 registra estado "inicial"
2. preenche `#mentorInput` com "Pergunta de verificação"
3. clica em `#mentorSendBtn`
4. 📸 registra estado "após enviar"

### perfil-dev (dev)

1. 📸 registra estado "inicial"
2. preenche `#f-sobre` com "Verificação"
3. 📸 registra estado "campo alterado"
4. clica em `#btn-save`
5. 📸 registra estado "após salvar"
6. clica em `#btn-add-skill`
7. 📸 registra estado "adicionar skill sem escolher"

### roadmap/index (dev)

1. 📸 registra estado "inicial"

### roadmap/novo (dev)

1. 📸 registra estado "inicial"
2. clica em `[name='tipo']` (2ª ocorrência)
3. 📸 registra estado "tipo vaga"
4. escolhe a opção nº 1 de `#rmVagaId`
5. clica em `[name='horasSemana']` (3ª ocorrência)
6. clica em `.rm-submit`
7. 📸 registra estado "após enviar"

### roadmap/detalhe (dev)

1. 📸 registra estado "inicial"
2. clica em `.rm-step-toggle`
3. 📸 registra estado "etapa expandida"
4. preenche `[name='repoUrl']` com "https://github.com/exemplo/repo"
5. foca `[name='repoUrl']` e tecla Enter
6. 📸 registra estado "após enviar projeto"

### empresa-dashboard (empresa)

1. 📸 registra estado "inicial"
2. clica em `.filter-chip[data-f='ativas']`
3. 📸 registra estado "filtro ativas"
4. clica em `.filter-chip[data-f='todas']`
5. clica em `.btn-delete-vaga`
6. 📸 registra estado "modal excluir aberto"
7. clica em `#btn-confirm-delete`
8. 📸 registra estado "após excluir"

### empresa-vagas (empresa)

1. 📸 registra estado "inicial"
2. clica em `.filter-chip[data-f='ativas']`
3. 📸 registra estado "filtro ativas"
4. clica em `.filter-chip[data-f='todas']`
5. preenche `#q-vagas` com "zzz"
6. 📸 registra estado "busca sem resultado"
7. limpa `#q-vagas`
8. clica em `.btn-toggle-on, .btn-toggle-off`
9. 📸 registra estado "após alternar status"
10. clica em `.btn-delete-vaga`
11. 📸 registra estado "modal excluir aberto"
12. clica em `#btn-confirm-delete`
13. 📸 registra estado "após excluir"

### empresa-desenvolvedores (empresa)

1. 📸 registra estado "inicial"
2. preenche `#dev-search` com "a"
3. 📸 registra estado "busca 'a'"
4. limpa `#dev-search`
5. clica em `.filter-chip[data-f='junior']`
6. 📸 registra estado "filtro júnior"

### empresa-matchs (empresa)

1. 📸 registra estado "inicial"
2. clica em `.filter-chip[data-f='alta']`
3. 📸 registra estado "filtro alta compatibilidade"
4. clica em `.filter-chip[data-f='todos']`
5. escolhe a opção nº 1 de `#match-sort-select`
6. 📸 registra estado "ordenado por menor compatibilidade"
7. clica em `.match-btn--accept`
8. 📸 registra estado "após aceitar"

### empresa-mensagens (empresa)

1. 📸 registra estado "inicial"
2. clica em `.msg-filter-tab[data-f='nao-lidas']`
3. 📸 registra estado "filtro não lidas"
4. clica em `.msg-filter-tab[data-f='todas']`
5. clica em `.msg-conv-item`
6. 📸 registra estado "conversa aberta"
7. preenche `#msgInput` com "Mensagem de verificação"
8. clica em `#msgSendBtn`
9. 📸 registra estado "após enviar"

### perfil-dev-empresa (empresa)

1. 📸 registra estado "inicial"
2. clica em `#tab-projetos`
3. 📸 registra estado "aba projetos"
4. clica em `#tab-resumo`
5. clica em `#btn-contact`
6. 📸 registra estado "após contatar"

### empresa-vaga-form (empresa)

1. 📸 registra estado "inicial"
2. preenche `#f-title` com "Vaga de verificação"
3. escolhe a opção nº 1 de `#f-level`
4. preenche `#search-required` com "Ja"
5. 📸 registra estado "dropdown de skills"
6. foca `#dropdown-required [data-id]` e tecla Enter
7. preenche `#search-desired` com "Do"
8. clica em `#dropdown-desired [data-id]`
9. preenche `#tag-input` com "startup"
10. foca `#tag-input` e tecla Enter
11. clica em `#chips-tags .chip-remove`
12. 📸 registra estado "skills e tags escolhidas"
13. clica em `#btn-publish`
14. 📸 registra estado "após publicar"

### empresa-candidaturas (empresa)

1. 📸 registra estado "inicial"
2. clica em `.js-gerar-resumo`
3. 📸 registra estado "após gerar resumo"

### perfil-empresa (empresa)

1. 📸 registra estado "inicial"
2. preenche `#f-cidade` com "Cidade de verificação"
3. clica em `#btn-save`
4. 📸 registra estado "após salvar"

### planos (dev, empresa)

1. 📸 registra estado "inicial"

### assinar (dev, empresa)

1. 📸 registra estado "inicial"

### assinatura-resultado (dev, empresa)

1. 📸 registra estado "inicial"

### minha-assinatura (dev, empresa)

1. 📸 registra estado "inicial"

### admin-dashboard (admin)

1. 📸 registra estado "inicial"

### admin-usuarios (admin)

1. 📸 registra estado "inicial"
2. clica em `.filter-chip[data-f='suspensos']`
3. 📸 registra estado "filtro suspensos"
4. clica em `.filter-chip[data-f='todos']`
5. clica em `[onclick^='toggleStatus']`
6. 📸 registra estado "após alternar status"

### admin-empresas (admin)

1. 📸 registra estado "inicial"
2. clica em `.filter-chip[data-f='suspensas']`
3. 📸 registra estado "filtro suspensas"
4. clica em `.filter-chip[data-f='todas']`
5. clica em `[onclick^='toggleStatus']`
6. 📸 registra estado "após alternar status"

### admin-vagas (admin)

1. 📸 registra estado "inicial"
2. clica em `.filter-chip[data-f='pausadas']`
3. 📸 registra estado "filtro pausadas"
4. clica em `.filter-chip[data-f='todas']`
5. clica em `[onclick^='toggleStatus']`
6. 📸 registra estado "após alternar status"

### admin-matchs (admin)

1. 📸 registra estado "inicial"

### admin-relatorios (admin)

1. 📸 registra estado "inicial"

### admin-configuracoes (admin)

1. 📸 registra estado "inicial"
2. clica em `.btn-resources`
3. 📸 registra estado "painel de recursos aberto"
4. preenche `#f-name` com "Skill de verificação"
5. clica em `#btn-save`
6. 📸 registra estado "após salvar skill"
