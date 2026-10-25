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
| 1 | [vagas.ejs](../views/vagas.ejs) | 63 | visitante `/vagas`<br>dev `/vagas`<br>empresa `/vagas` | concluída — ver registro |
| 2 | [progresso.ejs](../views/progresso.ejs) | 46 | dev `/meu-progresso` | concluída — ver registro |
| 3 | [repositorios.ejs](../views/repositorios.ejs) | 36 | dev `/repositorios` | concluída — ver registro |
| 4 | [perfil-dev.ejs](../views/perfil-dev.ejs) | 34 | dev `/perfil` | concluída — ver registro |
| 5 | [minha-assinatura.ejs](../views/minha-assinatura.ejs) | 31 | dev `/minha-assinatura`<br>empresa `/minha-assinatura` | concluída — ver registro |
| 6 | [perfil-empresa.ejs](../views/perfil-empresa.ejs) | 30 | empresa `/empresa/perfil` | concluída — ver registro |
| 7 | [vaga-publica.ejs](../views/vaga-publica.ejs) | 28 | visitante `/vagas/{vaga}`<br>dev `/vagas/{vaga}`<br>empresa `/vagas/{vaga}` | concluída — ver registro |
| 8 | [perfil-dev-empresa.ejs](../views/perfil-dev-empresa.ejs) | 23 | empresa `/empresa/dev/{dev}` | concluída — ver registro |
| 9 | [roadmap/detalhe.ejs](../views/roadmap/detalhe.ejs) | 16 | dev `/trilha/{roadmap}` | concluída — ver registro |
| 10 | [empresa-mensagens.ejs](../views/empresa-mensagens.ejs) | 14 | empresa `/empresa/mensagens` | concluída — ver registro |
| 11 | [mensagens.ejs](../views/mensagens.ejs) | 14 | dev `/mensagens` | concluída — ver registro |
| 12 | [assinar.ejs](../views/assinar.ejs) | 13 | dev `/planos/{planoDev}/assinar`<br>empresa `/planos/{planoEmpresa}/assinar` | concluída — ver registro |
| 13 | [planos.ejs](../views/planos.ejs) | 12 | dev `/planos`<br>empresa `/planos` | concluída sem troca — ver registro |
| 14 | [redefinir-senha.ejs](../views/redefinir-senha.ejs) | 10 | visitante `/redefinir-senha` | concluída — ver registro |
| 15 | [cadastro.ejs](../views/cadastro.ejs) | 9 | visitante `/cadastro` | concluída — ver registro |
| 16 | [esqueci-senha.ejs](../views/esqueci-senha.ejs) | 9 | visitante `/esqueci-senha` | concluída — ver registro |
| 17 | [index.ejs](../views/index.ejs) | 9 | visitante `/` | concluída sem troca — ver registro |
| 18 | [mentor.ejs](../views/mentor.ejs) | 9 | dev `/mentor` | concluída — ver registro |
| 19 | [roadmap/index.ejs](../views/roadmap/index.ejs) | 9 | dev `/trilha` | concluída — ver registro |
| 20 | [roadmap/novo.ejs](../views/roadmap/novo.ejs) | 9 | dev `/trilha/novo` | concluída sem troca — ver registro |
| 21 | [assinatura-resultado.ejs](../views/assinatura-resultado.ejs) | 8 | dev `/assinatura/retorno`<br>empresa `/assinatura/retorno` | concluída sem troca — ver registro |
| 22 | [dashboard.ejs](../views/dashboard.ejs) | 8 | dev `/dashboard` | concluída sem troca — ver registro |
| 23 | [login.ejs](../views/login.ejs) | 7 | visitante `/login` | concluída sem troca — ver registro |
| 24 | [sobre.ejs](../views/sobre.ejs) | 7 | visitante `/sobre` | concluída sem troca — ver registro |
| 25 | [para-empresas.ejs](../views/para-empresas.ejs) | 4 | visitante `/para-empresas` | concluída sem troca — ver registro |
| 26 | [para-devs.ejs](../views/para-devs.ejs) | 3 | visitante `/para-devs` | concluída sem troca — ver registro |
| 27 | [empresa-matchs.ejs](../views/empresa-matchs.ejs) | 1 | empresa `/empresa/matchs` | concluída sem troca — ver registro |

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

**Conversões que o base não cobre** (o conteúdo convertido é gerado pelo JS só quando há dados, e as contas de teste não têm esses dados):

- `progresso`: o card de roadmap (`.card-top` → `<header>`, `.card-stats` → `<ul>`) só aparece com roadmap em andamento; a conta dev não tem nenhum.
- `repositorios`: os modais (`.modal-head` → `<header>`, `.modal-foot` → `<footer>`) ficam fechados nas capturas — o roteiro de funções abre os dois; o estado vazio (`.repos-empty` → `<section>`) só aparece sem repositórios.
- `minha-assinatura`: o cartão "Assinatura atual" (`.sub-current-head` → `<header>`) e os painéis "Trocar cartão"/"Trocar de plano" (`.sub-panel` → `<section>`) só aparecem com assinatura paga ativa; a conta dev tem plano liberado pela equipe e a empresa não tem assinatura.
- `perfil-dev-empresa`: a lista de roadmaps do candidato (`#roadmap-list` → `<ul>`) só aparece se ele tiver roadmap; o candidato usado no base (id 5) não tem nenhum.
- `empresa-mensagens`: as mensagens (`.msg-bubble-row` → `<article>`) e o painel do candidato (`.msg-info-block` → `<section>`) só aparecem com conversa aberta; a empresa de teste não tem conversas.
- `mensagens`: as capturas visuais mostram a página sem conversa aberta, então o visual das mensagens (`<article>`) e do painel da empresa (`<section>`) não é comparado — a pergunta 2 exercitou os dois com uma conversa real.
- `mentor`: o histórico da conta dev está vazio, então as mensagens do histórico (`<article>`) não aparecem nas capturas; a mensagem enviada pelo roteiro de funções foi comparada.

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

### 1. vagas — concluída

- **Pergunta 1 (visual):** SIM. `comparar vagas`: 9 de 9 capturas iguais (visitante, dev e empresa × 1440/768/375), todas na 1ª captura.
- **Pergunta 2 (funções):** SIM. `verificar-funcoes comparar vagas`: OK nas 3 telas; `npm test`: 668 passaram.
- **Arquivos:** `views/vagas.ejs`, `public/css/vagas.css` (usado só por esta página, então B e C só nela).
- **Trocadas (13):**
  - `.hero-stats` → `<ul>`; as 3 `.hstat` → `<li>`; os 2 `.hstat-sep` → `<li aria-hidden="true">` (lista de estatísticas; o separador vira item decorativo para o `<ul>` só ter `<li>`).
  - os 2 `.filter-group` (Nível, Área) → `<fieldset>`, como em `empresa-vagas`.
  - `.job-card-top` → `<header>` no card do servidor e no gerado pelo JS (título, empresa e nível do card).
  - os 2 `.skills-row` do JS → `<ul>`, com cada `.skill-tag`/`.skills-more` como `<li>` (antes `<span>`); o `aria-label` que já existia passa a ser válido.
  - `.job-card-footer` do JS → `<footer>` (botão da vaga e compartilhar).
  - CSS: `.hero-stats` e `.skills-row` ganharam `margin:0;padding:0;list-style:none`; `.filter-group` ganhou `margin:0;padding:0;border:0;min-inline-size:auto`.
- **Mantidas (50) e motivo:**
  - `.jobs-grid` (2) e `.job-card` do servidor e do `createElement`: o teste QA-033 exige `<div class="job-card" role="listitem">`; um `<ul>` exigiria `<li>` nos cards.
  - `.filter-bar` (`role="search"`): `<search>` está fora da lista; `<form>` faria Enter no campo de busca recarregar a página.
  - `.hstat-val`/`.hstat-lbl` (6): par valor/rótulo dentro de cada item; `<dl>` está fora da lista.
  - skeletons de carregamento (3 `.skeleton-card` + 12 `.skel`) e `.hero-eyebrow`: decorativos, com `aria-hidden`.
  - layout sem significado próprio: `.login-banner-inner`, `.banner-text`, `.filter-inner`, `.search-wrap`, `.filter-sep` (2), `.results-row`, `.job-card-accent` (2), `.job-card-body` (2), `.job-icon-wrap`, `.job-meta` (2), `.job-company` (2).
  - `.skill-block` (2) e `.skill-block-label` (2): o rótulo não é heading, então `<section>` não se aplica.
  - estados vazio/erro do JS: `.empty-state` (2) e `.empty-icon` (2).

### 2. progresso — concluída

- **Pergunta 1 (visual):** SIM. `comparar progresso`: 3 de 3 capturas iguais (dev × 1440/768/375).
- **Pergunta 2 (funções):** SIM. `verificar-funcoes comparar progresso`: OK; `npm test`: 668 passaram.
- **Arquivos:** `views/progresso.ejs`, `public/css/progresso.css` (usado só por esta página).
- **Cobertura:** a conta dev não tem roadmap em andamento, então o card gerado pelo JS (`.card-top`, `.card-stats`) não aparece no base; está na conferência manual.
- **Trocadas (11):**
  - `.summary-bar` → `<ul>` e os 4 `.summary-card` → `<li>` (já tinham `role="list"`/`"listitem"`, mantidos).
  - `.gp-header` → `<header>` (título e percentual da barra global).
  - `.section-header` → `<header>` (`<h1>` "Meus roadmaps" e o link).
  - `.status-tabs` (`role="group"`) → `<fieldset>`.
  - no card do JS: `.card-top` → `<header>`; `.card-stats` → `<ul>`, com os `.card-stat` como `<li>` (antes `<span>`).
  - CSS: `.summary-bar` ganhou `margin-top:0;padding:0;list-style:none` (mantém o `margin-bottom` da classe); `.status-tabs` ganhou `margin-top:0;margin-inline:0;padding:0;border:0;min-inline-size:auto`; `.card-stats` ganhou `margin:0;padding:0;list-style:none`.
- **Mantidas (35) e motivo:**
  - `#roadmap-list` e `#roadmap-empty`: o teste QA-033 exige as duas como `<div>`.
  - `.gp-track` e `.card-track` (`role="progressbar"`): o teste QA-038 exige `<div>`; `.gp-fill`/`.card-fill` são o preenchimento visual delas.
  - `.global-progress` (`role="region"`): não tem título visível (só `aria-label`), então `<section>` não se aplica; o `role` já dá o landmark.
  - `.loading-screen`, `#content`, `.spinner` (2): estados de carregamento/conteúdo e ícone decorativo.
  - `.summary-icon`/`.summary-val`/`.summary-lbl` (12): ícone, valor e rótulo de cada indicador; `<dl>` está fora da lista.
  - `.gp-legend` (`aria-hidden`): legenda decorativa.
  - no card do JS: `.roadmap-card-inner`, `.card-stripe`, `.card-content`, `.card-info`, `.card-title` (não é heading), `.card-company`, `.card-badges`, `.card-progress`, `.card-prog-header`: layout interno do card.
  - estados do JS: `.empty-icon` e os 2 invólucros com `style` da mensagem de erro de carregamento.

### 3. repositorios — concluída

- **Pergunta 1 (visual):** SIM. `comparar repositorios`: 3 de 3 capturas iguais (dev × 1440/768/375).
- **Pergunta 2 (funções):** SIM. `verificar-funcoes comparar repositorios`: OK (o roteiro abre os dois modais); `npm test`: 668 passaram.
- **Arquivos:** só `views/repositorios.ejs`. Nenhum CSS mudou: `.modal-foot > div` (do inventário) continua valendo porque a `<div>` interna do rodapé foi mantida.
- **Cobertura:** os modais ficam fechados nas capturas e o estado vazio só aparece sem repositórios; ambos estão na conferência manual.
- **Trocadas (7):**
  - `.repos-page-header` → `<header>`; a `<div>` interna (`<h1>` + 2 `<p>`) → `<hgroup>`.
  - `.repos-empty` → `<section>` (tem `<h2>`).
  - os 2 `.modal-head` → `<header>` (título do modal + fechar).
  - `.modal-foot` do modal de edição → `<footer>`.
- **Mantidas (29) e motivo:**
  - `.repos-grid` e o `.repo-card` gerado pelo JS: `dev.css` já tem `.repos-grid > li { display: contents }`, pensado para `<li>` envolvendo o card; trocar o card por `<li>` faria ele perder a caixa, e envolvê-lo mudaria o aninhamento.
  - `#modal-error`: o teste QA-019 exige `<div>`.
  - `#modal-add`/`#modal-edit` (`role="dialog"`) e `.modal` (2): `<dialog>` está fora da lista e mudaria o comportamento de abrir/fechar.
  - `#state-loading`, `#state-empty`, `#state-repos`, `#modal-loading`: estados que o JS mostra/esconde.
  - `.repos-skeleton` + 4 `.repo-skel`, `.repos-empty-icon`: decorativos.
  - `.modal-search-wrap`, `.modal-body`, `.edit-field` (2, um campo cada — `<fieldset>` não se aplica), `<div>` interna do `.modal-foot` (o CSS `.modal-foot > div` depende dela).
  - `#toast` (`role="status"`): `<output>` está fora da lista.
  - no JS: `.repo-icon`, `.repo-info`, `.repo-meta`, `.repo-actions`, `.modal-repo-icon`, `.modal-repo-info`, `.modal-repo-meta`: layout interno dos itens.

### 4. perfil-dev — concluída

- **Pergunta 1 (visual):** SIM. Como `perfil.css` mudou, rodou em todas as páginas que o usam: perfil-dev (3), perfil-empresa (3), minha-assinatura (6), assinar (6), planos (6), assinatura-resultado (6) — 30 de 30 capturas iguais.
- **Pergunta 2 (funções):** SIM nas mesmas 6 páginas (10 telas OK); `npm test`: 668 passaram. Nenhuma página protegida usa `perfil.css`.
- **Arquivos:** `views/perfil-dev.ejs`, `public/css/perfil.css` (compartilhado; mudança só aditiva nas classes `.profile-chips` e `.profile-stats`).
- **Trocadas (7 `<div>`, mais 3 `<span>` → `<li>`):**
  - `.profile-meta` → `<header>` (nome `<h1>`, e-mail e badges do hero).
  - `#hero-chips` (`.profile-chips`) → `<ul>`; os 3 badges que o JS gera nele → `<li class="chip …">` (antes `<span>`). O badge de plano em `#plan-info` continua `<span>`.
  - `#hero-stats` (`.profile-stats`) → `<ul>`; os `.stat-item` que o JS gera (2 lugares) → `<li>`.
  - CSS: `.profile-chips` e `.profile-stats` ganharam `margin-bottom:0;padding:0;list-style:none` (mantêm o `margin-top` da classe).
- **Mantidas (27) e motivo:**
  - `.perfil-layout`, `#state-loading` + 3 skeletons, `#state-content`: layout e estados de carregamento.
  - `.profile-hero-inner`, `.avatar-wrap`, `.avatar-ring`, `.avatar-placeholder` (inclusive o gerado pelo JS): layout/avatar decorativo.
  - `.form-alert` (`role="alert"`), `.field-row`, `.form-actions`, `.reanalyze-bar`, `.add-skill-row`, `#plan-info`, `#perfil-repos-preview` (e os itens com `style` gerados nele), `.danger-zone`: layout ou grupos sem título próprio.
  - `.skills-grid`: os itens são gerados por `renderSkills` com estrutura própria; trocar exigiria mudar também os filhos.
  - `.skill-why` (`role="region"`): o título é um `<p>`, não heading, então `<section>` não se aplica.
  - `#info-rows` e os 3 `.info-row`: pares rótulo/valor; `<dl>` está fora da lista.
  - `#toast` (`role="status"`): `<output>` está fora da lista.

### 5. minha-assinatura — concluída

- **Pergunta 1 (visual):** SIM. `comparar minha-assinatura`: 6 de 6 capturas iguais (dev e empresa × 3 larguras).
- **Pergunta 2 (funções):** SIM. OK nas 2 telas; `npm test`: 668 passaram.
- **Arquivos:** só `views/minha-assinatura.ejs`; nenhum CSS mudou (`.sub-current-head` e `.sub-panel` são estilizados pela classe).
- **Cobertura:** nenhuma das contas mostra o cartão "Assinatura atual" (dev tem plano liberado pela equipe; empresa não tem assinatura) e os painéis só abrem com assinatura ativa; está na conferência manual.
- **Trocadas (3):**
  - `.sub-current-head` → `<header>` (rótulo "Plano atual", `<h2>` e chip de status).
  - `#panel-cartao` e `#panel-plano` (`.sub-panel`) → `<section>` (cada um tem `<h3>`).
- **Mantidas (28) e motivo:**
  - `<div>` interna de `.sub-current-head` ("Plano atual" + `<h2>`): `<hgroup>` não aceita `<span>`.
  - `.sub-wrap`, `#content` (`.sub-stack`), os `#loading`/`#card-loading`: layout e estados.
  - avisos `.sub-notice` (3, com `role` próprio) e a `<div>` de texto dentro deles (é parágrafo; `<p>` está fora da lista), `.sub-notice-actions`.
  - `#info-grid` e os `.sub-info-item` do JS: pares rótulo/valor; `<dl>` está fora da lista.
  - `.sub-actions` (5): grupos de botões.
  - `#cardBrickTrocaCartao`: contêiner do formulário do Mercado Pago.
  - `#plan-options`: os filhos são links `<a>`; `<ul>` exigiria envolvê-los em `<li>`.
  - `#history` e as `<div>` dentro das `<td>` do histórico: o CSS `.sub-history td > div` (inventário) depende delas.
  - `#cancel-modal` (overlay) e `.sub-modal` (`role="dialog"`): `<dialog>` está fora da lista e mudaria o comportamento.
  - `#mp-config`: só carrega `data-*` para o JS.

### 6. perfil-empresa — concluída

- **Pergunta 1 (visual):** SIM. Como `perfil.css` mudou, rodou nas 6 páginas que o usam (perfil-empresa, perfil-dev, minha-assinatura, assinar, planos, assinatura-resultado): 30 de 30 capturas iguais.
- **Pergunta 2 (funções):** SIM nas mesmas 6 (10 telas OK); `npm test`: 668 passaram.
- **Arquivos:** `views/perfil-empresa.ejs`, `public/css/perfil.css` (só a classe `.vagas-list` ganhou `margin:0;padding:0;list-style:none`).
- **Trocadas (7 `<div>`, mais 4 `<span>` e 1 `<p>` → `<li>`):**
  - `.profile-meta` → `<header>`; `#hero-chips` → `<ul>` com os 4 badges do JS como `<li>`; `#hero-stats` → `<ul>` com os 2 `.stat-item` do JS como `<li>` (mesmo padrão de `perfil-dev`).
  - `#vagas-list` → `<ul>`; cada `.vaga-row` do JS → `<li>`; a mensagem "Nenhuma vaga publicada ainda" → `<li class="vagas-empty">` (antes `<p>`; o `<ul>` só aceita `<li>`).
- **Mantidas (23) e motivo:**
  - `.perfil-layout`, `#state-loading` + 3 skeletons, `#state-content`: layout e estados.
  - `.profile-hero-inner`, `.company-logo-ring`, `.company-logo`: layout/logo decorativo.
  - `.form-alert` (`role="alert"`), `.field-row` (2), `.form-actions`, a `<div>` com `style` do link de nova vaga, `#plan-info`, `.danger-zone`: layout ou grupos sem título.
  - `.vaga-info` (dentro de cada item): título e meta da vaga.
  - `#info-rows` e os 4 `.info-row`: pares rótulo/valor; `<dl>` está fora da lista.
  - `#toast` (`role="status"`): `<output>` está fora da lista.

### 7. vaga-publica — concluída

- **Pergunta 1 (visual):** SIM. `comparar vaga-publica`: 9 de 9 capturas iguais (visitante, dev e empresa × 3 larguras).
- **Pergunta 2 (funções):** SIM. OK nas 3 telas; `npm test`: 668 passaram.
- **Arquivos:** `views/vaga-publica.ejs`, `public/css/vaga-publica.css` (usado só por esta página).
- **Trocadas (12 `<div>`, mais 6 `<span>` → `<li>`):**
  - `.vaga-hero-top` → `<header>` e `.vaga-hero-info` (`<h1>` + empresa) → `<hgroup>`, no HTML do servidor e no gerado pelo JS.
  - `.vaga-badges` → `<ul>`, com os 4 selos (nível, modalidade, contrato, inglês) como `<li>`.
  - `.match-card-header` → `<header>`; `.match-scores` → `<ul>` com os 2 `.score-item` como `<li>`.
  - `.skill-breakdown` → `<ul>` com cada `.skill-row` como `<li>`.
  - `.tag-list` → `<ul>` com cada `.tag-item` como `<li>`.
  - CSS: `.vaga-badges`, `.match-scores`, `.skill-breakdown` e `.tag-list` ganharam `padding:0;list-style:none` e margem zerada (mantendo o `margin-top` que a classe já tinha).
- **Mantidas (16) e motivo:**
  - `#state-loading`, `#state-error`, `#state-content`: os testes QA-019 e QA-020 exigem `<div>`.
  - `.vaga-grid`: layout das duas colunas.
  - `.vaga-icon-wrap` (decorativo), `.match-bar-track`/`.match-bar-fill` (barra visual), `.match-login-prompt`.
  - `.vaga-action-card` (2): cartão lateral de ações, sem título.
  - as `<div>` de rótulo/valor dentro de cada `.vaga-meta-item` (já um `<li>`): `<dl>` está fora da lista.

### 8. perfil-dev-empresa — concluída

- **Pergunta 1 (visual):** SIM. `comparar perfil-dev-empresa`: 3 de 3 capturas iguais (empresa × 3 larguras).
- **Pergunta 2 (funções):** SIM. OK; `npm test`: 668 passaram.
- **Arquivos:** só `views/perfil-dev-empresa.ejs` (o CSS da página fica no `<style>` dela).
- **Trocadas (7 `<div>`, mais os `<span>` dos chips e o `<p>` de "nenhuma skill" → `<li>`):**
  - `.dev-hero-main` → `<header>` (nome `<h1>`, cargo, GitHub e chips do candidato).
  - `#hero-chips` e `#hero-skill-chips` (`.dev-hero-chips`) → `<ul>`, com os badges e as skills que o JS gera como `<li>`.
  - `#skills-grid` → `<ul>` com cada `.skill-row` como `<li>`; a mensagem "Nenhuma skill detectada ainda." → `<li class="no-data">`.
  - `#roadmap-list` → `<ul>` com cada `.roadmap-row` como `<li>`.
  - CSS (no `<style>` da página): `.dev-hero-chips`, `.skills-grid` e `.roadmap-list` ganharam `padding:0;list-style:none` e margem zerada (mantendo o `margin-bottom` dos chips).
- **Mantidas (16) e motivo:**
  - `#state-loading`, `#state-error`, `#state-content`: estados.
  - `.dev-hero-avatar` (decorativo), `.dev-hero-actions`, `.match-ring-wrap`, `.match-ring-label`: anel de compatibilidade e botão de contato.
  - `.dev-tabs` (`role="tablist"`) e os `.dev-tab-panel` (`role="tabpanel"`, 2 no template): a `<div>` é o elemento certo para esses papéis ARIA.
  - `.tab-empty`: estado vazio das abas, sem título.
  - dentro dos itens do JS: `.skill-row-top`, `.skill-bar`/`.skill-fill` e `.roadmap-bar-wrap`/`.roadmap-bar-fill` (barras com `role="progressbar"` e o preenchimento visual).

### 9. roadmap/detalhe — concluída

- **Pergunta 1 (visual):** SIM. `comparar roadmap/detalhe`: 3 de 3 capturas iguais (dev × 3 larguras).
- **Pergunta 2 (funções):** SIM. OK; `npm test`: 668 passaram.
- **Arquivos:** só `views/roadmap/detalhe.ejs`; nenhum CSS mudou (`trilha.css` estiliza `.rm-fase-head`/`.rm-fase-info` pela classe).
- **Trocadas (2, repetidas em cada fase):**
  - `.rm-fase-head` → `<header>` (número, título, objetivo e percentual da fase).
  - `.rm-fase-info` (`<h2>` + `<p>` do objetivo) → `<hgroup>`.
- **Mantidas (14) e motivo:**
  - `.rm-page`: layout.
  - `.rm-alert` (3: aviso, info e resultado do projeto, com `role` próprio): avisos sem título.
  - `.rm-progress` (2, `role="progressbar"`) com `.rm-progress-track`/`.rm-progress-fill`: barra e preenchimento visual.
  - `.rm-actions`: grupo dos formulários "regenerar"/"arquivar".
  - `.rm-etapa-conteudo` e `.rm-etapa-meta`: conteúdo e metadados de cada etapa (que já é um `<li>`).
  - `.rm-projeto`: o rótulo "Projeto prático" é um `<p>`, não heading, então `<section>` não se aplica.

### 10. empresa-mensagens — concluída

- **Pergunta 1 (visual):** SIM. `comparar empresa-mensagens`: 3 de 3 capturas iguais (empresa × 3 larguras).
- **Pergunta 2 (funções):** SIM. OK; `npm test`: 668 passaram.
- **Arquivos:** só `views/empresa-mensagens.ejs`; nenhum CSS mudou (`mensagens.css` não estiliza `header`/`article`/`section` soltos).
- **Cobertura:** a empresa de teste não tem conversas, então as mensagens (`<article>`) e o painel do candidato (`<section>`) não aparecem no base; está na conferência manual. A mesma troca de `.msg-bubble-row` é feita em `mensagens`, onde a conta dev tem conversas.
- **Trocadas (4):**
  - `.msg-sidebar-head` → `<header>` (introdução da lista de conversas).
  - `.msg-bubble-row` do JS → `<article>` (cada mensagem é um conteúdo independente: texto e horário).
  - os 2 `.msg-info-block` do painel que têm `<h4>` ("Skills", "Progresso em roadmaps") → `<section>`.
- **Mantidas (10) e motivo:**
  - `.msg-layout`: layout das colunas.
  - `.msg-search-row`: invólucro do campo de busca (`<search>` está fora da lista).
  - `#convList`: os itens são `<button>`; `<ul>` exigiria envolvê-los em `<li>`.
  - `#threadEmpty`, `#threadActive`, `#threadBody`, `#infoPanelBody`: estados e contêineres preenchidos pelo JS.
  - no painel do JS: `.msg-info-meta`, a `<div>` dos chips de skill, e o último `.msg-info-block` (só um link, sem título).

### 11. mensagens — concluída

- **Pergunta 1 (visual):** SIM. `comparar mensagens`: 3 de 3 capturas iguais (dev × 3 larguras).
- **Pergunta 2 (funções):** SIM. OK (o roteiro abre uma conversa real, então as mensagens em `<article>` e o painel foram exercitados); `npm test`: 668 passaram.
- **Arquivos:** só `views/mensagens.ejs`; nenhum CSS mudou.
- **Cobertura:** a captura visual mostra a página sem conversa aberta, então o visual das mensagens não é comparado; está na conferência manual.
- **Trocadas (5):**
  - `.msg-sidebar-head` → `<header>` (botão "Nova conversa").
  - `.msg-bubble-row` do JS → `<article>` (mesma decisão de `empresa-mensagens`).
  - os 2 `.msg-info-block` do painel da empresa ("Sobre a empresa", "Vagas em aberto", ambos com `<h4>`) → `<section>`.
- **Mantidas (10) e motivo:**
  - `.msg-layout`, `.msg-search-row`, `#convList` (itens são `<button>`), `#threadEmpty`, `#threadActive`, `#threadBody`, `#infoPanelBody`: mesmos motivos de `empresa-mensagens`.
  - `#jobSearchResults` (modal "Nova conversa"): os resultados são `<button>`; `<ul>` exigiria `<li>` em volta.
  - no painel do JS: `.msg-info-meta` e `.msg-info-jobs`.

### 12. assinar — concluída

- **Pergunta 1 (visual):** SIM. `comparar assinar`: 6 de 6 capturas iguais (dev e empresa × 3 larguras).
- **Pergunta 2 (funções):** SIM. OK nas 2 telas; `npm test`: 668 passaram.
- **Arquivos:** só `views/assinar.ejs`; nenhum CSS mudou (`.sub-state` é estilizado pela classe e já é `<section>` em `minha-assinatura`).
- **Trocadas (2):** os 2 blocos `.sub-state` ("Você já assina este plano" e "Assinaturas temporariamente indisponíveis", cada um com `<h2>`) → `<section>`. O segundo é o que aparece no base (Mercado Pago não configurado localmente).
- **Mantidas (11) e motivo:**
  - `.sub-wrap`, `.sub-layout`: layout.
  - `.sub-actions` (2): grupos de botões.
  - `.sub-notice` (2, `role="note"`) e a `<div>` de texto dentro de cada um: avisos; o texto é parágrafo, mas `<p>` está fora da lista.
  - `#brick-loading`, `#cardPaymentBrick_container` (contêiner do Mercado Pago, com `data-*`), `#checkout-error`: estados e contêiner externo.

### 13. planos — concluída sem troca

- **Nenhum arquivo alterado**, então as perguntas 1 e 2 não se aplicam (nada a comparar) e não há commit próprio.
- **Mantidas (12) e motivo:**
  - `#plans-status`: contêiner onde o JS coloca os avisos.
  - os 5 avisos `.sub-notice` gerados pelo JS (aviso de indisponibilidade, problema na cobrança, assinatura ativa, pendente, cancelada): mensagens de status sem título; nenhuma tag da lista descreve um aviso.
  - a `<div>` de texto dentro de cada aviso (5) e `.sub-notice-actions`: o texto é parágrafo, mas `<p>` está fora da lista.

### 14. redefinir-senha — concluída

- **Pergunta 1 (visual):** SIM. `comparar redefinir-senha`: 3 de 3 capturas iguais (visitante × 3 larguras).
- **Pergunta 2 (funções):** SIM. OK; `npm test`: 668 passaram.
- **Arquivos:** só `views/redefinir-senha.ejs`; nenhum CSS mudou (`.lp-card-head` é estilizado pela classe; `.lp-preview > *` continua com os mesmos filhos).
- **Trocadas (1):** `.lp-card-head` → `<header>` (topo do cartão ilustrativo `<article class="lp-card">`, na coluna decorativa com `aria-hidden`).
- **Mantidas (9) e motivo:**
  - `.lp-layout`, `.lp-left-inner`: layout das duas colunas.
  - `.pass-wrap.field-wrap` (2): posicionam o ícone e o botão de mostrar senha dentro do campo.
  - `.lp-right-glow`, `.lp-preview`, `.lp-status-bar`, `.lp-avatar`: ilustração decorativa (`aria-hidden`).
  - `.lp-card-info`: nome e cargo são `<p>`, sem heading, então `<hgroup>` não se aplica.

### 15. cadastro — concluída

- **Pergunta 1 (visual):** SIM. `comparar cadastro`: 3 de 3 capturas iguais (visitante × 3 larguras).
- **Pergunta 2 (funções):** SIM. OK; `npm test`: 668 passaram.
- **Arquivos:** só `views/cadastro.ejs`; nenhum CSS mudou.
- **Trocadas (1):** `.lp-welcome` → `<header>` (selo, `<h1>` e subtítulo), igual ao que `login`, `esqueci-senha` e `redefinir-senha` já usam.
- **Mantidas (8) e motivo:**
  - `.lp-layout`, `.lp-left-inner`: layout.
  - `.type-tabs` (`role="tablist"`): a `<div>` é o elemento certo para esse papel ARIA.
  - `.field-wrap` (5, sendo 2 `.pass-wrap`): posicionam o ícone e o botão de mostrar senha dentro de cada campo.

### 16. esqueci-senha — concluída

- **Pergunta 1 (visual):** SIM. `comparar esqueci-senha`: 3 de 3 capturas iguais (visitante × 3 larguras).
- **Pergunta 2 (funções):** SIM. OK; `npm test`: 668 passaram.
- **Arquivos:** só `views/esqueci-senha.ejs`; nenhum CSS mudou.
- **Trocadas (1):** `.lp-card-head` → `<header>` (topo do cartão ilustrativo, igual em `redefinir-senha`).
- **Mantidas (8) e motivo:**
  - `.lp-layout`, `.lp-left-inner`: layout.
  - `.field-wrap`: posiciona o ícone dentro do campo de e-mail.
  - `.lp-right-glow`, `.lp-preview`, `.lp-status-bar`, `.lp-avatar`: ilustração decorativa (`aria-hidden`).
  - `.lp-card-info`: nome e cargo são `<p>`, sem heading, então `<hgroup>` não se aplica.

### 17. index — concluída sem troca

- **Nenhum arquivo alterado**, então as perguntas 1 e 2 não se aplicam e não há commit próprio.
- **Mantidas (9) e motivo:**
  - `.bg-decor` (`aria-hidden`): decoração de fundo do hero.
  - `.logos__viewport`: máscara/rolagem do carrossel de logos (a lista em si já é `<ul>`).
  - `.step-card__top` (4): selo "FIG 0.x" e ícone (ambos `aria-hidden`); o `<h3>` fica fora deles, então `<header>` só faria sentido mudando o aninhamento (mesma decisão de `para-devs`/`sobre`).
  - `.cta-final__inner`, `.cta-final__actions`: layout e grupo de botões.
  - `.footer__bottom`: fica dentro do `<footer>` do site, e um `<footer>` não pode conter outro.

### 18. mentor — concluída

- **Pergunta 1 (visual):** SIM. `comparar mentor`: 3 de 3 capturas iguais (dev × 3 larguras).
- **Pergunta 2 (funções):** SIM. OK (o roteiro envia uma pergunta, então a mensagem enviada — agora `<article>` — entra no estado comparado); `npm test`: 668 passaram.
- **Arquivos:** só `views/mentor.ejs`; nenhum CSS mudou.
- **Cobertura:** o histórico da conta dev está vazio, então as mensagens do histórico não aparecem nas capturas; está na conferência manual.
- **Trocadas (2):** `.msg-bubble-row` → `<article>` no histórico e na mensagem enviada (mesma decisão de `mensagens`/`empresa-mensagens`).
- **Mantidas (7) e motivo:**
  - `.msg-layout`: layout.
  - `.msg-thread-empty` (2: plano PRO e erro): estados sem título.
  - `#mentorBody`: área da conversa (mistura mensagens, "digitando..." e o estado vazio).
  - `#mentorAnexoPreview`: chip do arquivo anexado.
  - `#mentorEmpty` e a `<div>` centralizada do botão de entrevista (JS): estado vazio.
  - `createElement("div")` em `escapeHtml()`: elemento temporário que nunca entra no DOM.

### 19. roadmap/index — concluída

- **Pergunta 1 (visual):** SIM. `comparar roadmap/index`: 3 de 3 capturas iguais (dev × 3 larguras; os cards de roadmap aparecem no base).
- **Pergunta 2 (funções):** SIM. OK; `npm test`: 668 passaram.
- **Arquivos:** só `views/roadmap/index.ejs`; nenhum CSS mudou.
- **Trocadas (1, repetida em cada card):** `.rm-card-top` → `<header>` (nome do roadmap, meta e selos de status).
- **Mantidas (8) e motivo:**
  - `.rm-page`: layout.
  - `.rm-empty`: estado vazio sem título.
  - `.rm-card-list` (`role="list"`): virar `<ul>` exigiria trocar os filhos `<article role="listitem">`, que não são `<div>`.
  - `.rm-card-info` (título e meta são `<p>`, sem heading, então `<hgroup>` não se aplica) e `.rm-card-badges`.
  - `.rm-progress` (`role="progressbar"`) com `.rm-progress-track`/`.rm-progress-fill`.
- **Observação (não alterado):** os cards usam `<article role="listitem">`, que o axe acusa como role não permitido (mesmo problema do QA-033). A correção trocaria `<article>` por `<li>`, o que está fora da regra de só trocar `<div>`.

### 20. roadmap/novo — concluída sem troca

- **Nenhum arquivo alterado**; perguntas 1 e 2 não se aplicam.
- **Mantidas (9) e motivo:** o formulário já usa `<fieldset>` + `<legend>` para cada grupo. `.rm-radio-row` (2) está dentro do `<fieldset>`, então outro seria redundante; `.rm-field` (2) tem um campo só; `.rm-alert` (2, com `role` próprio), `#rmLoadingOverlay` (`role="status"`) e o spinner são estados; `.rm-page` é layout.

### 21. assinatura-resultado — concluída sem troca

- **Nenhum arquivo alterado**; perguntas 1 e 2 não se aplicam.
- **Mantidas (8) e motivo:** o bloco principal já é `<section class="card sub-state">`. Ficam `.sub-wrap` (largura), os 5 `.sub-actions` (grupos de botões), `.sub-notice--warn` (aviso sem título) e a `<div>` de texto dentro dele (é parágrafo; `<p>` está fora da lista).

### 22. dashboard — concluída sem troca

- **Nenhum arquivo alterado**; perguntas 1 e 2 não se aplicam.
- **Mantidas (8) e motivo:** `#content`, `.dash-layout` e `.dash-main` são estado e layout. `#today-cards` e `#trilha-tasks` são contêineres que o JS preenche com `<article>`/`<section>`. Os 3 atalhos de `.stats` são links: `<ul>` exigiria envolver cada `<a>` num `<li>`, e `<nav>` criaria uma segunda navegação sem nome. `.aside-mentor` e `.card-skills` (JS) são grupos sem título.

### 23. login — concluída sem troca

- **Nenhum arquivo alterado**; perguntas 1 e 2 não se aplicam.
- **Mantidas (7) e motivo:** o bloco de boas-vindas já é `<header>`. Ficam `.lp-layout` e `.lp-left-inner` (layout), `.type-tabs` (`role="tablist"`, e a `<div>` é o elemento certo para esse papel), `.github-block` (bloco do GitHub sem título), `.field-wrap` (2) e `.field-label-row` (posicionam ícone/botão e alinham rótulo com o link "Esqueci minha senha").

### 24. sobre — concluída sem troca

- **Nenhum arquivo alterado**; perguntas 1 e 2 não se aplicam.
- **Mantidas (7) e motivo:** `.pillars-grid` e `.team-grid` posicionam `<article>`s (um `<ul>` exigiria envolver cada um num `<li>`, mudando o aninhamento). Os 4 `.pillar-card__top` (selo "FTS" e ícone) ficam fora do `<h3>`, mesma decisão de `index`/`para-devs`. `.about-cta-actions` é um grupo de botões.

### 25. para-empresas — concluída sem troca

- **Nenhum arquivo alterado**; perguntas 1 e 2 não se aplicam.
- **Mantidas (4) e motivo:** `.pd-why__grid` posiciona os `<article>` (um `<ul>` mudaria o aninhamento); os 3 `.pd-feature__top` (selo "FIS" e ícone) ficam fora do `<h3>`.

### 26. para-devs — concluída sem troca

- **Nenhum arquivo alterado**; perguntas 1 e 2 não se aplicam.
- **Mantidas (3) e motivo:** mesmas de `para-empresas` — `.pd-why__grid` e os 2 `.pd-feature__top`.

### 27. empresa-matchs — concluída sem troca

- **Nenhum arquivo alterado**; perguntas 1 e 2 não se aplicam.
- **Mantida (1) e motivo:** `#match-empty` (`role="status"`) — o teste QA-033 exige `<div>`; além disso, `<section>` pediria título e `<output>` não aceita os `<p>` que ela recebe.

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
