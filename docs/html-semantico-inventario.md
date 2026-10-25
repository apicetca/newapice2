# Inventário — troca de `<div>` por HTML semântico

Levantamento feito em 2026-10-23 na branch `refactor/html-semantico` (a partir de `main` em `b15b08c`). **Nenhum arquivo do projeto foi alterado**: este documento é só o mapa para planejar a troca sem mudar o visual.

## Resumo

- **47 views** `.ejs` (incluindo os 4 parciais de header). **33** têm pelo menos uma `<div>`. São **505 ocorrências** no total: 383 no markup do template e 122 dentro de strings JS (templates usados em `innerHTML`).
- **Já sem nenhuma `<div>`** (14 arquivos): `404.ejs`, `500.ejs`, `admin-dashboard.ejs`, `admin-empresas.ejs`, `admin-matchs.ejs`, `admin-usuarios.ejs`, `admin-vagas.ejs`, `empresa-dashboard.ejs`, `empresa-desenvolvedores.ejs`, `partials/header-admin.ejs`, `partials/header-company.ejs`, `partials/header-dev.ejs`, `partials/header.ejs`, `roadmap.ejs`.
- **CSS que depende de `div` pelo nome: só 2 seletores**, os dois do tipo `> div`. Nenhum `<style>` inline nas views usa `div`.
- **JS que depende de `div`:** 7 `createElement("div")` e 122 strings HTML com `<div` (em 15 views). **Nenhum** `querySelector`/`closest`/`matches` por `div`, nenhum `getElementsByTagName("div")` e nenhum `tagName === "DIV"`. Em `public/js/` não há **nenhuma** dependência de `div`.
- Ou seja: **quase nada depende da tag `div`**. O risco maior está no caminho inverso, nas regras de CSS para `main`, `footer`, `ul`/`li` etc. que passam a valer quando uma `<div>` vira essa tag (seção 5).

## 1. Views por quantidade de `<div>` (com nível de acesso)

Ordenado da que tem mais `<div>` para a que tem menos. **Markup** é a `<div>` escrita no template. **JS** é a `<div>` dentro de uma string em `<script>` (vira `innerHTML`). Acesso conforme `server.js`, `routes/trilha.js`, `controllers/assinaturasController.js` e `middlewares/auth.js`.

| # | View | Total | Markup | JS | Acesso | Rota |
|---:|---|---:|---:|---:|---|---|
| 1 | [vagas.ejs](../views/vagas.ejs) | 63 | 46 | 17 | Público | `/vagas` |
| 2 | [progresso.ejs](../views/progresso.ejs) | 46 | 29 | 17 | Dev | `/meu-progresso` |
| 3 | [repositorios.ejs](../views/repositorios.ejs) | 36 | 28 | 8 | Dev | `/repositorios` |
| 4 | [perfil-dev.ejs](../views/perfil-dev.ejs) | 34 | 25 | 9 | Dev ¹ | `/perfil` |
| 5 | [minha-assinatura.ejs](../views/minha-assinatura.ejs) | 31 | 26 | 5 | Dev ou empresa | `/minha-assinatura` |
| 6 | [perfil-empresa.ejs](../views/perfil-empresa.ejs) | 30 | 22 | 8 | Empresa | `/empresa/perfil` |
| 7 | [vaga-publica.ejs](../views/vaga-publica.ejs) | 28 | 6 | 22 | Público | `/vagas/:id` |
| 8 | [empresa-vaga-form.ejs](../views/empresa-vaga-form.ejs) | 27 | 27 | 0 | Empresa | `/empresa/vagas/nova`, `/empresa/vagas/:id/editar` |
| 9 | [perfil-dev-empresa.ejs](../views/perfil-dev-empresa.ejs) | 23 | 16 | 7 | Empresa | `/empresa/dev/:id` |
| 10 | [roadmap/detalhe.ejs](../views/roadmap/detalhe.ejs) | 16 | 16 | 0 | Dev | `/trilha/:id` |
| 11 | [empresa-mensagens.ejs](../views/empresa-mensagens.ejs) | 14 | 8 | 6 | Empresa | `/empresa/mensagens` |
| 12 | [mensagens.ejs](../views/mensagens.ejs) | 14 | 9 | 5 | Dev | `/mensagens` |
| 13 | [assinar.ejs](../views/assinar.ejs) | 13 | 13 | 0 | Dev ou empresa ² | `/planos/:id/assinar` |
| 14 | [planos.ejs](../views/planos.ejs) | 12 | 1 | 11 | Dev ou empresa | `/planos` |
| 15 | [redefinir-senha.ejs](../views/redefinir-senha.ejs) | 10 | 10 | 0 | Público | `/redefinir-senha` |
| 16 | [cadastro.ejs](../views/cadastro.ejs) | 9 | 9 | 0 | Público | `/cadastro` |
| 17 | [esqueci-senha.ejs](../views/esqueci-senha.ejs) | 9 | 9 | 0 | Público | `/esqueci-senha` |
| 18 | [index.ejs](../views/index.ejs) | 9 | 9 | 0 | Público | `/` |
| 19 | [mentor.ejs](../views/mentor.ejs) | 9 | 5 | 4 | Dev | `/mentor` (`/entrevista` redireciona p/ cá) |
| 20 | [roadmap/index.ejs](../views/roadmap/index.ejs) | 9 | 9 | 0 | Dev | `/trilha` |
| 21 | [roadmap/novo.ejs](../views/roadmap/novo.ejs) | 9 | 9 | 0 | Dev | `/trilha/novo` |
| 22 | [assinatura-resultado.ejs](../views/assinatura-resultado.ejs) | 8 | 8 | 0 | Dev ou empresa | `/assinatura/retorno` |
| 23 | [dashboard.ejs](../views/dashboard.ejs) | 8 | 7 | 1 | Dev | `/dashboard` |
| 24 | [insights-mercado.ejs](../views/insights-mercado.ejs) | 8 | 8 | 0 | Público | `/insights-mercado` |
| 25 | [login.ejs](../views/login.ejs) | 7 | 7 | 0 | Público | `/login` (logado → redireciona p/ o painel) |
| 26 | [sobre.ejs](../views/sobre.ejs) | 7 | 7 | 0 | Público | `/sobre` |
| 27 | [para-empresas.ejs](../views/para-empresas.ejs) | 4 | 4 | 0 | Público | `/para-empresas` |
| 28 | [admin-relatorios.ejs](../views/admin-relatorios.ejs) | 3 | 2 | 1 | Admin | `/admin/relatorios` |
| 29 | [para-devs.ejs](../views/para-devs.ejs) | 3 | 3 | 0 | Público | `/para-devs` |
| 30 | [admin-configuracoes.ejs](../views/admin-configuracoes.ejs) | 2 | 1 | 1 | Admin | `/admin/configuracoes` |
| 31 | [empresa-vagas.ejs](../views/empresa-vagas.ejs) | 2 | 2 | 0 | Empresa | `/empresa/vagas` |
| 32 | [empresa-candidaturas.ejs](../views/empresa-candidaturas.ejs) | 1 | 1 | 0 | Empresa | `/empresa/vagas/:id/candidaturas` |
| 33 | [empresa-matchs.ejs](../views/empresa-matchs.ejs) | 1 | 1 | 0 | Empresa | `/empresa/matchs` |
| 34 | [404.ejs](../views/404.ejs) | 0 | 0 | 0 | Público | qualquer rota inexistente |
| 35 | [500.ejs](../views/500.ejs) | 0 | 0 | 0 | Público | erro do servidor |
| 36 | [admin-dashboard.ejs](../views/admin-dashboard.ejs) | 0 | 0 | 0 | Admin | `/admin/dashboard` |
| 37 | [admin-empresas.ejs](../views/admin-empresas.ejs) | 0 | 0 | 0 | Admin | `/admin/empresas` |
| 38 | [admin-matchs.ejs](../views/admin-matchs.ejs) | 0 | 0 | 0 | Admin | `/admin/matchs` |
| 39 | [admin-usuarios.ejs](../views/admin-usuarios.ejs) | 0 | 0 | 0 | Admin | `/admin/usuarios` |
| 40 | [admin-vagas.ejs](../views/admin-vagas.ejs) | 0 | 0 | 0 | Admin | `/admin/vagas` |
| 41 | [empresa-dashboard.ejs](../views/empresa-dashboard.ejs) | 0 | 0 | 0 | Empresa | `/empresa/dashboard` |
| 42 | [empresa-desenvolvedores.ejs](../views/empresa-desenvolvedores.ejs) | 0 | 0 | 0 | Empresa | `/empresa/desenvolvedores` |
| 43 | [partials/header-admin.ejs](../views/partials/header-admin.ejs) | 0 | 0 | 0 | Parcial — Admin | as 7 páginas de admin |
| 44 | [partials/header-company.ejs](../views/partials/header-company.ejs) | 0 | 0 | 0 | Parcial — Empresa | todas as páginas de empresa + páginas mistas |
| 45 | [partials/header-dev.ejs](../views/partials/header-dev.ejs) | 0 | 0 | 0 | Parcial — Dev | todas as páginas de dev + páginas mistas |
| 46 | [partials/header.ejs](../views/partials/header.ejs) | 0 | 0 | 0 | Parcial — Público | header de visitante (index, vagas, vaga-publica, para-devs, para-empresas, sobre, insights) |
| 47 | [roadmap.ejs](../views/roadmap.ejs) | 0 | 0 | 0 | Dev | `/roadmap` |

¹ `/perfil` usa só `requireAuth`. Empresa é redirecionada para `/empresa/perfil`, mas **admin cai em `perfil-dev.ejs`** (não há bloqueio para admin).  
² `/planos/:id/assinar` exige login (redireciona para `/login?next=…`), bloqueia admin e exige que o tipo do plano bata com o tipo da conta.

**Método de contagem:** busca por `<div` (sem diferenciar maiúsculas) em cada arquivo. Ocorrências dentro de `<script>…</script>` vão para a coluna JS. `createElement("div")` **não** entra nessa contagem (está na seção 3). Isso explica `roadmap.ejs` e `empresa-candidaturas.ejs`, que têm `createElement("div")` mesmo com contagem 0 ou 1.

### Resumo por nível de acesso

| Acesso | Views | `<div>` | Arquivos |
|---|---:|---:|---|
| Dev | 10 | 181 | progresso.ejs, repositorios.ejs, perfil-dev.ejs, roadmap/detalhe.ejs, mensagens.ejs, mentor.ejs, roadmap/index.ejs, roadmap/novo.ejs, dashboard.ejs, roadmap.ejs |
| Público | 13 | 157 | vagas.ejs, vaga-publica.ejs, redefinir-senha.ejs, cadastro.ejs, esqueci-senha.ejs, index.ejs, insights-mercado.ejs, login.ejs, sobre.ejs, para-empresas.ejs, para-devs.ejs, 404.ejs, 500.ejs |
| Empresa | 9 | 98 | perfil-empresa.ejs, empresa-vaga-form.ejs, perfil-dev-empresa.ejs, empresa-mensagens.ejs, empresa-vagas.ejs, empresa-candidaturas.ejs, empresa-matchs.ejs, empresa-dashboard.ejs, empresa-desenvolvedores.ejs |
| Dev ou empresa | 4 | 64 | minha-assinatura.ejs, assinar.ejs, planos.ejs, assinatura-resultado.ejs |
| Admin | 7 | 5 | admin-relatorios.ejs, admin-configuracoes.ejs, admin-dashboard.ejs, admin-empresas.ejs, admin-matchs.ejs, admin-usuarios.ejs, admin-vagas.ejs |
| Parcial — Admin | 1 | 0 | partials/header-admin.ejs |
| Parcial — Empresa | 1 | 0 | partials/header-company.ejs |
| Parcial — Dev | 1 | 0 | partials/header-dev.ejs |
| Parcial — Público | 1 | 0 | partials/header.ejs |

## 2. CSS que depende de `div` pelo nome

Busca em `public/css/*.css` e em todo `<style>` inline das views por seletores com `div` como tag (`div`, `> div`, `div.`, `div:`, `div#`, `div[`), ignorando comentários.

| Arquivo | Seletor | Alvo no HTML |
|---|---|---|
| [public/css/assinatura.css:202](../public/css/assinatura.css#L202) | `.sub-history td > div` | `<td>` do histórico de cobranças em `minha-assinatura.ejs` (dentro de `@media`). Se a `<div>` dentro da `<td>` mudar de tag, o `text-align: right` deixa de valer |
| [public/css/repositorios.css:612](../public/css/repositorios.css#L612) | `.modal-foot > div` | filho direto de `.modal-foot` em `repositorios.ejs` (dentro de `@media`, com `!important`). Precisa ser atualizado junto se essa `<div>` mudar de tag |

Nenhum `<style>` inline em `views/` usa `div` em seletor.

## 3. JS que depende de `div`

Busca em `public/js/**/*.js` e em todo `<script>` inline das views. **`public/js/` não tem nenhuma ocorrência.** Também não aparecem `querySelector`/`querySelectorAll`/`closest`/`matches` com `div` no seletor, nem `getElementsByTagName("div")` ou `tagName`/`nodeName === "DIV"`.

### 3.1 `document.createElement("div")`

| Local | Código |
|---|---|
| [views/empresa-candidaturas.ejs:69](../views/empresa-candidaturas.ejs#L69) `<script>` | `const div = document.createElement("div");` |
| [views/empresa-mensagens.ejs:254](../views/empresa-mensagens.ejs#L254) `<script>` | `const div = document.createElement("div");` |
| [views/mensagens.ejs:273](../views/mensagens.ejs#L273) `<script>` | `const div = document.createElement("div");` |
| [views/mentor.ejs:105](../views/mentor.ejs#L105) `<script>` | `const div = document.createElement("div");` |
| [views/roadmap.ejs:365](../views/roadmap.ejs#L365) `<script>` | `const div = document.createElement("div");` |
| [views/vagas.ejs:312](../views/vagas.ejs#L312) `<script>` | `const card = document.createElement("div");` |
| [views/vagas.ejs:406](../views/vagas.ejs#L406) `<script>` | `const el = document.createElement("div");` |

### 3.2 Strings HTML com `<div` (geradas para `innerHTML`/templates)

São as ocorrências da coluna **JS** da seção 1. Trocar a tag aqui é um ajuste da string. O cuidado é o CSS que o elemento gerado vai herdar (seção 5).

#### vaga-publica.ejs — 22

| Linha | `<div>` na linha | Código |
|---|---:|---|
| [159](../views/vaga-publica.ejs#L159) | 1 | `<div class="vaga-hero-top">` |
| [160](../views/vaga-publica.ejs#L160) | 1 | `<div class="vaga-icon-wrap" aria-hidden="true">${jobIcon(job.title)}</div>` |
| [161](../views/vaga-publica.ejs#L161) | 1 | `<div class="vaga-hero-info">` |
| [170](../views/vaga-publica.ejs#L170) | 1 | `` <div class="vaga-badges">${badges.join("")}</div>`; `` |
| [214](../views/vaga-publica.ejs#L214) | 1 | `<div class="match-login-prompt">` |
| [231](../views/vaga-publica.ejs#L231) | 1 | `<div class="match-card-header">` |
| [235](../views/vaga-publica.ejs#L235) | 1 | `<div class="match-bar-track">` |
| [236](../views/vaga-publica.ejs#L236) | 1 | `<div class="match-bar-fill ${cls}" id="match-fill" style="width:0%"></div>` |
| [242](../views/vaga-publica.ejs#L242) | 1 | `<div class="match-scores">` |
| [243](../views/vaga-publica.ejs#L243) | 1 | `<div class="score-item">` |
| [247](../views/vaga-publica.ejs#L247) | 1 | `<div class="score-item">` |
| [324](../views/vaga-publica.ejs#L324) | 1 | `<div class="skill-row ${isLoggedIn && has ? "has" : "miss"}">` |
| [342](../views/vaga-publica.ejs#L342) | 1 | `<div class="skill-breakdown">` |
| [428](../views/vaga-publica.ejs#L428) | 1 | `<div class="vaga-action-card">` |
| [431](../views/vaga-publica.ejs#L431) | 3 | `` <li class="vaga-meta-item"><div><div class="vaga-meta-label">${i.label}</div><div class="vaga-meta-val">${i.val}</div></div></li>`).join(... `` |
| [478](../views/vaga-publica.ejs#L478) | 1 | `` ? `<div class="tag-list">${job.tags.split(",").map(t => `<span class="tag-item">${escapeHtml(t.trim())}</span>`).join("")}</div>` `` |
| [484](../views/vaga-publica.ejs#L484) | 1 | `<div class="vaga-action-card">` |
| [495](../views/vaga-publica.ejs#L495) | 1 | `<div>` |
| [496](../views/vaga-publica.ejs#L496) | 1 | `<div class="vaga-meta-label">${i.label}</div>` |
| [497](../views/vaga-publica.ejs#L497) | 1 | `<div class="vaga-meta-val">${i.val}</div>` |

#### progresso.ejs — 17

| Linha | `<div>` na linha | Código |
|---|---:|---|
| [209](../views/progresso.ejs#L209) | 1 | `<div class="empty-icon">${IC.target}</div>` |
| [257](../views/progresso.ejs#L257) | 1 | `<div class="roadmap-card-inner">` |
| [258](../views/progresso.ejs#L258) | 1 | `<div class="card-stripe ${stripeClass}" aria-hidden="true"></div>` |
| [259](../views/progresso.ejs#L259) | 1 | `<div class="card-content">` |
| [261](../views/progresso.ejs#L261) | 1 | `<div class="card-top">` |
| [262](../views/progresso.ejs#L262) | 1 | `<div class="card-info">` |
| [263](../views/progresso.ejs#L263) | 1 | `<div class="card-title">${escapeHtml(r.title)}</div>` |
| [264](../views/progresso.ejs#L264) | 1 | `<div class="card-company">` |
| [269](../views/progresso.ejs#L269) | 1 | `<div class="card-badges">` |
| [278](../views/progresso.ejs#L278) | 1 | `<div class="card-progress">` |
| [279](../views/progresso.ejs#L279) | 1 | `<div class="card-prog-header">` |
| [283](../views/progresso.ejs#L283) | 1 | `<div class="card-track"` |
| [289](../views/progresso.ejs#L289) | 1 | `<div class="card-fill ${fillClass}"` |
| [295](../views/progresso.ejs#L295) | 1 | `<div class="card-stats">` |
| [351](../views/progresso.ejs#L351) | 1 | `<div style="text-align:center;max-width:340px;margin:0 auto">` |
| [355](../views/progresso.ejs#L355) | 1 | `<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">` |
| [369](../views/progresso.ejs#L369) | 1 | `` loadingEl.innerHTML = `<div class="spinner" aria-hidden="true"></div><p>Carregando seu progresso...</p>`; `` |

#### vagas.ejs — 17

| Linha | `<div>` na linha | Código |
|---|---:|---|
| [303](../views/vagas.ejs#L303) | 1 | `<div class="empty-state" role="status">` |
| [304](../views/vagas.ejs#L304) | 1 | `<div class="empty-icon">${IC.search}</div>` |
| [344](../views/vagas.ejs#L344) | 1 | `<div class="job-card-accent" aria-hidden="true"></div>` |
| [345](../views/vagas.ejs#L345) | 1 | `<div class="job-card-body">` |
| [347](../views/vagas.ejs#L347) | 1 | `<div class="job-card-top">` |
| [348](../views/vagas.ejs#L348) | 1 | `<div class="job-icon-wrap" aria-hidden="true">${jobIcon(job.title)}</div>` |
| [349](../views/vagas.ejs#L349) | 1 | `<div class="job-meta">` |
| [351](../views/vagas.ejs#L351) | 1 | `<div class="job-company">` |
| [365](../views/vagas.ejs#L365) | 1 | `<div class="skill-block">` |
| [366](../views/vagas.ejs#L366) | 1 | `<div class="skill-block-label">Habilidades técnicas</div>` |
| [367](../views/vagas.ejs#L367) | 1 | `<div class="skills-row" aria-label="Skills obrigatórias e desejáveis">` |
| [373](../views/vagas.ejs#L373) | 1 | `<div class="skill-block">` |
| [374](../views/vagas.ejs#L374) | 1 | `<div class="skill-block-label">Habilidades comportamentais</div>` |
| [375](../views/vagas.ejs#L375) | 1 | `<div class="skills-row" aria-label="Soft skills">${softHtml}</div>` |
| [380](../views/vagas.ejs#L380) | 1 | `<div class="job-card-footer">` |
| [486](../views/vagas.ejs#L486) | 1 | `<div class="empty-state" role="alert">` |
| [487](../views/vagas.ejs#L487) | 1 | `<div class="empty-icon">${IC.search}</div>` |

#### planos.ejs — 11

| Linha | `<div>` na linha | Código |
|---|---:|---|
| [193](../views/planos.ejs#L193) | 2 | `` notices.push(`<div class="sub-notice sub-notice--warn"><div><strong>Assinaturas temporariamente indisponíveis.</strong> Tente novamente m... `` |
| [198](../views/planos.ejs#L198) | 2 | `` notices.push(`<div class="sub-notice sub-notice--error"><div><strong>Problema na cobrança do plano ${name}:</strong> ${escapeHtml(subscri... `` |
| [199](../views/planos.ejs#L199) | 1 | `` <div class="sub-notice-actions"><a class="btn-primary" href="/minha-assinatura">Atualizar cartão</a></div></div></div>`); `` |
| [202](../views/planos.ejs#L202) | 2 | `` notices.push(`<div class="sub-notice sub-notice--ok"><div>Você assina o plano <strong>${name}</strong>.${next} <a href="/minha-assinatura... `` |
| [204](../views/planos.ejs#L204) | 2 | `` notices.push(`<div class="sub-notice"><div>A assinatura do plano <strong>${name}</strong> está aguardando confirmação do Mercado Pago. <a... `` |
| [206](../views/planos.ejs#L206) | 2 | `` notices.push(`<div class="sub-notice"><div>Sua assinatura do plano <strong>${name}</strong> foi cancelada e dá acesso até <strong>${escap... `` |

#### perfil-dev.ejs — 9

| Linha | `<div>` na linha | Código |
|---|---:|---|
| [271](../views/perfil-dev.ejs#L271) | 1 | `` ring.innerHTML = `<div class="avatar-placeholder" id="avatar-el" aria-hidden="true">${initials}</div>`; `` |
| [361](../views/perfil-dev.ejs#L361) | 1 | `<div class="stat-item">` |
| [365](../views/perfil-dev.ejs#L365) | 1 | `<div class="stat-item">` |
| [528](../views/perfil-dev.ejs#L528) | 1 | `<div class="info-row">` |
| [532](../views/perfil-dev.ejs#L532) | 1 | `<div class="info-row">` |
| [536](../views/perfil-dev.ejs#L536) | 1 | `<div class="info-row">` |
| [733](../views/perfil-dev.ejs#L733) | 1 | `<div class="stat-item"><span class="stat-value">${profile.skills.length}</span><span class="stat-label">habilidades</span></div>` |
| [734](../views/perfil-dev.ejs#L734) | 1 | `<div class="stat-item"><span class="stat-value">${dominated}</span><span class="stat-label">dominadas</span></div>` |
| [835](../views/perfil-dev.ejs#L835) | 1 | `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--bg-3);border:1px solid var(--border);border-radius:...` |

#### perfil-empresa.ejs — 8

| Linha | `<div>` na linha | Código |
|---|---:|---|
| [313](../views/perfil-empresa.ejs#L313) | 1 | `<div class="stat-item">` |
| [317](../views/perfil-empresa.ejs#L317) | 1 | `<div class="stat-item">` |
| [362](../views/perfil-empresa.ejs#L362) | 1 | `<div class="vaga-row">` |
| [364](../views/perfil-empresa.ejs#L364) | 1 | `<div class="vaga-info">` |
| [383](../views/perfil-empresa.ejs#L383) | 1 | `<div class="info-row">` |
| [387](../views/perfil-empresa.ejs#L387) | 1 | `<div class="info-row">` |
| [391](../views/perfil-empresa.ejs#L391) | 1 | `<div class="info-row">` |
| [395](../views/perfil-empresa.ejs#L395) | 1 | `<div class="info-row">` |

#### repositorios.ejs — 8

| Linha | `<div>` na linha | Código |
|---|---:|---|
| [248](../views/repositorios.ejs#L248) | 1 | `<div class="repo-card${isPublic ? ' repo-card--published' : ''}" data-id="${r.id}">` |
| [249](../views/repositorios.ejs#L249) | 1 | `<div class="repo-icon">${REPO_ICON}</div>` |
| [250](../views/repositorios.ejs#L250) | 1 | `<div class="repo-info">` |
| [253](../views/repositorios.ejs#L253) | 1 | `<div class="repo-meta">` |
| [262](../views/repositorios.ejs#L262) | 1 | `<div class="repo-actions">` |
| [407](../views/repositorios.ejs#L407) | 1 | `<div class="modal-repo-icon">${REPO_ICON}</div>` |
| [408](../views/repositorios.ejs#L408) | 1 | `<div class="modal-repo-info">` |
| [411](../views/repositorios.ejs#L411) | 1 | `<div class="modal-repo-meta">` |

#### perfil-dev-empresa.ejs — 7

| Linha | `<div>` na linha | Código |
|---|---:|---|
| [340](../views/perfil-dev-empresa.ejs#L340) | 1 | `<div class="skill-row">` |
| [341](../views/perfil-dev-empresa.ejs#L341) | 1 | `<div class="skill-row-top">` |
| [347](../views/perfil-dev-empresa.ejs#L347) | 1 | `<div class="skill-bar" role="progressbar" aria-valuenow="${s.confidence}" aria-valuemin="0" aria-valuemax="100" aria-label="${escapeHtml(...` |
| [348](../views/perfil-dev-empresa.ejs#L348) | 1 | `<div class="skill-fill" style="width:0%" data-w="${s.confidence}%"></div>` |
| [366](../views/perfil-dev-empresa.ejs#L366) | 1 | `<div class="roadmap-row">` |
| [368](../views/perfil-dev-empresa.ejs#L368) | 1 | `<div class="roadmap-bar-wrap" role="progressbar" aria-valuenow="${r.progress}" aria-valuemin="0" aria-valuemax="100" aria-label="${r.job_...` |
| [369](../views/perfil-dev-empresa.ejs#L369) | 1 | `<div class="roadmap-bar-fill" style="width:0%" data-w="${r.progress}%"></div>` |

#### empresa-mensagens.ejs — 6

| Linha | `<div>` na linha | Código |
|---|---:|---|
| [244](../views/empresa-mensagens.ejs#L244) | 1 | `<div class="msg-bubble-row ${m.mine ? "mine" : ""} ${stacked ? "stacked" : ""}">` |
| [317](../views/empresa-mensagens.ejs#L317) | 1 | `<div class="msg-info-meta" style="align-items:center">` |
| [321](../views/empresa-mensagens.ejs#L321) | 2 | `` ${skillsHtml ? `<div class="msg-info-block"><h4>Skills</h4><div>${skillsHtml}</div></div>` : ""} `` |
| [322](../views/empresa-mensagens.ejs#L322) | 1 | `` ${data.roadmaps?.length ? `<div class="msg-info-block"><h4>Progresso em roadmaps</h4>${data.roadmaps.map(r => `<p style="font-size:.8rem;... `` |
| [323](../views/empresa-mensagens.ejs#L323) | 1 | `<div class="msg-info-block">` |

#### mensagens.ejs — 5

| Linha | `<div>` na linha | Código |
|---|---:|---|
| [263](../views/mensagens.ejs#L263) | 1 | `<div class="msg-bubble-row ${m.mine ? "mine" : ""} ${stacked ? "stacked" : ""}">` |
| [345](../views/mensagens.ejs#L345) | 1 | `` ${data.descricao ? `<div class="msg-info-block"><h4>Sobre a empresa</h4><p>${escapeHtml(data.descricao)}</p></div>` : ""} `` |
| [346](../views/mensagens.ejs#L346) | 1 | `<div class="msg-info-meta">` |
| [350](../views/mensagens.ejs#L350) | 1 | `<div class="msg-info-block">` |
| [352](../views/mensagens.ejs#L352) | 1 | `<div class="msg-info-jobs">${jobsHtml}</div>` |

#### minha-assinatura.ejs — 5

| Linha | `<div>` na linha | Código |
|---|---:|---|
| [211](../views/minha-assinatura.ejs#L211) | 1 | `` return `<div class="sub-info-item"><span class="sub-info-label">${escapeHtml(label)}</span><span class="sub-info-value">${escapeHtml(valu... `` |
| [315](../views/minha-assinatura.ejs#L315) | 1 | `<td data-label="Data"><div>${escapeHtml(fmtDate(p.paid_at \|\| p.created_at))}</div></td>` |
| [316](../views/minha-assinatura.ejs#L316) | 1 | `<td data-label="Plano"><div>${escapeHtml(p.plan_name)}</div></td>` |
| [317](../views/minha-assinatura.ejs#L317) | 1 | `<td data-label="Valor"><div>${p.amount != null ? escapeHtml(money(p.amount)) : "—"}</div></td>` |
| [318](../views/minha-assinatura.ejs#L318) | 1 | `<td data-label="Status"><div>` |

#### mentor.ejs — 4

| Linha | `<div>` na linha | Código |
|---|---:|---|
| [114](../views/mentor.ejs#L114) | 1 | `<div id="mentorEmpty">` |
| [116](../views/mentor.ejs#L116) | 1 | `<div style="text-align:center">` |
| [126](../views/mentor.ejs#L126) | 1 | `<div class="msg-bubble-row ${m.role === "user" ? "mine" : ""}">` |
| [220](../views/mentor.ejs#L220) | 1 | `<div class="msg-bubble-row mine">` |

#### admin-configuracoes.ejs — 1

| Linha | `<div>` na linha | Código |
|---|---:|---|
| [254](../views/admin-configuracoes.ejs#L254) | 1 | `<div class="resource-row">` |

#### admin-relatorios.ejs — 1

| Linha | `<div>` na linha | Código |
|---|---:|---|
| [90](../views/admin-relatorios.ejs#L90) | 1 | `<div class="bar-row">` |

#### dashboard.ejs — 1

| Linha | `<div>` na linha | Código |
|---|---:|---|
| [150](../views/dashboard.ejs#L150) | 1 | `` ${(job.skills \|\| []).length ? `<div class="card-skills"><span class="card-skills-label">Habilidades</span><ul class="skill-chips">${job.s... `` |

## 4. Páginas por nível de acesso

Guardas em `middlewares/auth.js`: `requireDev` / `requireCompany` / `requireAdmin` redirecionam quem não está logado para `/login` e quem está logado com outro tipo de conta para o próprio painel.

### Sem login (13)

- [index.ejs](../views/index.ejs): `/`
- [login.ejs](../views/login.ejs): `/login` (logado → redireciona p/ o painel)
- [cadastro.ejs](../views/cadastro.ejs): `/cadastro`
- [esqueci-senha.ejs](../views/esqueci-senha.ejs): `/esqueci-senha`
- [redefinir-senha.ejs](../views/redefinir-senha.ejs): `/redefinir-senha`
- [vagas.ejs](../views/vagas.ejs): `/vagas`
- [vaga-publica.ejs](../views/vaga-publica.ejs): `/vagas/:id`
- [para-devs.ejs](../views/para-devs.ejs): `/para-devs`
- [para-empresas.ejs](../views/para-empresas.ejs): `/para-empresas`
- [sobre.ejs](../views/sobre.ejs): `/sobre`
- [insights-mercado.ejs](../views/insights-mercado.ejs): `/insights-mercado`
- [404.ejs](../views/404.ejs): qualquer rota inexistente
- [500.ejs](../views/500.ejs): erro do servidor

### Exige dev (10)

- [dashboard.ejs](../views/dashboard.ejs): `/dashboard`
- [progresso.ejs](../views/progresso.ejs): `/meu-progresso`
- [repositorios.ejs](../views/repositorios.ejs): `/repositorios`
- [roadmap.ejs](../views/roadmap.ejs): `/roadmap`
- [mensagens.ejs](../views/mensagens.ejs): `/mensagens`
- [mentor.ejs](../views/mentor.ejs): `/mentor` (`/entrevista` redireciona p/ cá)
- [perfil-dev.ejs](../views/perfil-dev.ejs): `/perfil` ¹
- [roadmap/index.ejs](../views/roadmap/index.ejs): `/trilha`
- [roadmap/novo.ejs](../views/roadmap/novo.ejs): `/trilha/novo`
- [roadmap/detalhe.ejs](../views/roadmap/detalhe.ejs): `/trilha/:id`

### Exige empresa (9)

- [empresa-dashboard.ejs](../views/empresa-dashboard.ejs): `/empresa/dashboard`
- [empresa-vagas.ejs](../views/empresa-vagas.ejs): `/empresa/vagas`
- [empresa-desenvolvedores.ejs](../views/empresa-desenvolvedores.ejs): `/empresa/desenvolvedores`
- [empresa-matchs.ejs](../views/empresa-matchs.ejs): `/empresa/matchs`
- [empresa-mensagens.ejs](../views/empresa-mensagens.ejs): `/empresa/mensagens`
- [perfil-dev-empresa.ejs](../views/perfil-dev-empresa.ejs): `/empresa/dev/:id`
- [empresa-vaga-form.ejs](../views/empresa-vaga-form.ejs): `/empresa/vagas/nova`, `/empresa/vagas/:id/editar`
- [empresa-candidaturas.ejs](../views/empresa-candidaturas.ejs): `/empresa/vagas/:id/candidaturas`
- [perfil-empresa.ejs](../views/perfil-empresa.ejs): `/empresa/perfil`

### Exige login de dev ou empresa (admin é redirecionado) (4)

- [planos.ejs](../views/planos.ejs): `/planos`
- [assinar.ejs](../views/assinar.ejs): `/planos/:id/assinar` ²
- [assinatura-resultado.ejs](../views/assinatura-resultado.ejs): `/assinatura/retorno`
- [minha-assinatura.ejs](../views/minha-assinatura.ejs): `/minha-assinatura`

### Exige admin (7)

- [admin-dashboard.ejs](../views/admin-dashboard.ejs): `/admin/dashboard`
- [admin-usuarios.ejs](../views/admin-usuarios.ejs): `/admin/usuarios`
- [admin-empresas.ejs](../views/admin-empresas.ejs): `/admin/empresas`
- [admin-vagas.ejs](../views/admin-vagas.ejs): `/admin/vagas`
- [admin-matchs.ejs](../views/admin-matchs.ejs): `/admin/matchs`
- [admin-relatorios.ejs](../views/admin-relatorios.ejs): `/admin/relatorios`
- [admin-configuracoes.ejs](../views/admin-configuracoes.ejs): `/admin/configuracoes`

**Páginas mistas** (sem login, mas o header muda conforme o tipo de conta): `vagas`, `vaga-publica`, `insights-mercado` e `sobre` incluem `header`, `header-dev` e `header-company`. Para testar a troca nelas, abra **deslogado, como dev e como empresa**.

**Parciais:** `header.ejs` (visitante), `header-dev.ejs`, `header-company.ejs`, `header-admin.ejs`. Todos com **0** `<div>`.

## 5. Risco no sentido inverso: CSS que passa a valer ao trocar a tag

Fora do escopo pedido, mas é o que mais pode mudar o visual. Trocar `<div>` por `<main>`, `<footer>`, `<ul>`/`<li>`, `<section>` etc. faz o elemento passar a receber regras escritas para **essa tag**, além dos estilos padrão do navegador.

**Regras por tag "solta" (sem classe), as mais perigosas:**

- [design-system.css:9](../public/css/design-system.css#L9): `*, *::before, *::after { margin: 0; padding: 0 }`. Zera margem/padding padrão de **qualquer** tag nova (`ul`, `figure`, `dl`, `fieldset`, `blockquote`…). Isso ajuda.
- [design-system.css:75](../public/css/design-system.css#L75): `ul, ol { list-style: none }`. Lista sem marcador em todo o site. Uma `<div>` que vira `<ul>`/`<li>` não ganha bolinha.
- [auth.css:19](../public/css/auth.css#L19) e [:684](../public/css/auth.css#L684): `main { display: flex; padding: 80px 20px 64px; … }`. Vale para **qualquer** `<main>` em `login`, `cadastro`, `esqueci-senha` e `redefinir-senha` (as únicas que carregam `auth.css`; elas já têm um `<main class="lp-left">`). Não crie um segundo `<main>` nessas páginas.
- [roadmap.css:525](../public/css/roadmap.css#L525) e [:549](../public/css/roadmap.css#L549): `footer { border-top; padding: 16px 40px; text-align: center; … }`. Vale para **qualquer** `<footer>` em `roadmap.ejs`. Isso inclui um `<footer>` dentro de card/`<article>`, que não seria o rodapé da página.
- [auth.css:660](../public/css/auth.css#L660): `footer.site-footer`. Só com a classe, sem risco.

**Regras `.classe li` / `.classe > li`** (só valem se a `<div>` virar `<li>` dentro desse container): 

| Local | Seletor |
|---|---|
| [views/planos.ejs:52](../views/planos.ejs#L52) `<style>` | `.plan-features li` |
| [views/planos.ejs:53](../views/planos.ejs#L53) `<style>` | `.plan-features li.is-off` |
| [public/css/assinatura.css:40](../public/css/assinatura.css#L40) | `.sub-benefits li` |
| [public/css/auth.css:377](../public/css/auth.css#L377) | `.lp-steps-mini li` |
| [public/css/auth.css:382](../public/css/auth.css#L382) | `.lp-steps-mini li:first-child` |
| [public/css/dashboard.css:162](../public/css/dashboard.css#L162) | `.skill-chips li` |
| [public/css/dev.css:328](../public/css/dev.css#L328) | `.jobs-grid > li, .repos-grid > li` |
| [public/css/dev.css:336](../public/css/dev.css#L336) | `ul.user-stats` |
| [public/css/empresa-vaga-form.css:150](../public/css/empresa-vaga-form.css#L150) | `.skill-dropdown li` |
| [public/css/empresa-vaga-form.css:155](../public/css/empresa-vaga-form.css#L155) | `.skill-dropdown li:hover` |
| [public/css/empresa-vaga-form.css:156](../public/css/empresa-vaga-form.css#L156) | `.skill-dropdown li.selected` |
| [public/css/landing.css:755](../public/css/landing.css#L755) | `.footer__nav ul` |
| [public/css/landing.css:921](../public/css/landing.css#L921) | `.footer__social li` |
| [public/css/para-devs.css:45](../public/css/para-devs.css#L45) | `.pd-plan__list li` |
| [public/css/para-devs.css:46](../public/css/para-devs.css#L46) | `.pd-plan__list li span` |
| [public/css/para-devs.css:47](../public/css/para-devs.css#L47) | `.pd-plan__list li.is-off` |
| [public/css/para-devs.css:48](../public/css/para-devs.css#L48) | `.pd-plan__list li.is-off span` |
| [public/css/para-devs.css:125](../public/css/para-devs.css#L125) | `.pd-plan__list li .ic` |
| [public/css/para-devs.css:126](../public/css/para-devs.css#L126) | `.pd-empresa .pd-plan__list li.is-muted .ic, .pd-empresa .pd-plan__list li.is-off .ic` |
| [public/css/para-devs.css:128](../public/css/para-devs.css#L128) | `.pd-empresa .pd-plan__list li.is-off` |
| [public/css/roadmap.css:197](../public/css/roadmap.css#L197) | `.summary-stats li.has` |
| [public/css/roadmap.css:198](../public/css/roadmap.css#L198) | `.summary-stats li.missing` |
| [public/css/roadmap.css:423](../public/css/roadmap.css#L423) | `.resources li` |

**Outros pontos a conferir ao trocar:**

- `<button>` no lugar de `<div>` clicável traz fonte, borda, fundo e `display: inline-block` do navegador. É preciso `font: inherit; background: none; border: 0; color: inherit; text-align: inherit`.
- `<section>`, `<article>`, `<aside>`, `<nav>`, `<header>`, `<footer>` são `display: block` como a `<div>`. Sem regra por tag, a troca é visualmente neutra.
- `<ul>`/`<ol>` só aceitam `<li>` como filho direto. Ao trocar o container, troque também os filhos.
- Seletores estruturais (`> *`, `:first-child`, `:nth-child`, `+`, `~`) não dependem da tag, mas quebram se a troca **inserir ou remover** um nível de aninhamento. Ex.: [dashboard.css:25](../public/css/dashboard.css#L25) `.dash-main > .section:last-child` e `.section:nth-child(2/3)` em [dashboard.css:57-58](../public/css/dashboard.css#L57-L58).
- `<dialog>` e `inert` já estão em uso (QA-016/QA-032). Não reintroduza `<div role="dialog">`.
- **Testes que esperam `<div>` literalmente** (falham se a tag mudar, e precisam ser atualizados junto, desde que a intenção do teste continue valendo):
  - [QA-019.test.js](../tests/qa/QA-019.test.js): `<div … id="state-error">` em `vaga-publica.ejs`; `<div … id="modal-error">` em `repositorios.ejs`
  - [QA-020.test.js](../tests/qa/QA-020.test.js): `<div id="state-content">` / `<div id="state-loading">` no HTML renderizado de `vaga-publica.ejs` e `insights-mercado.ejs`
  - [QA-033.test.js](../tests/qa/QA-033.test.js): `#roadmap-list` (fechado por `</div>`) e `<div … id="roadmap-empty">` em `progresso.ejs`; `<div … id="match-empty">` em `empresa-matchs.ejs`; `<div class="job-card" role="listitem">` em `vagas.ejs`. Esse último foi a correção de QA-033: o `<article>` não aceita `role="listitem"`. A versão semântica certa é `<li>` dentro de `<ul>`, não voltar para `<article>`
  - [QA-038.test.js](../tests/qa/QA-038.test.js): `<div class="gp-track" … id="gp-bar-wrap">` e `<div class="card-track">` em `progresso.ejs`
- Rode `npm test` depois de cada arquivo alterado.

## Como este inventário foi gerado

Script Node lendo `views/**/*.ejs`, `public/css/**/*.css` e `public/js/**/*.js`. Ele separa as regiões `<script>`/`<style>` de cada view, conta `<div` e aplica regex para seletores e chamadas JS. Ocorrências dentro de comentários HTML/EJS também entram na contagem. Os níveis de acesso foram lidos manualmente das rotas.
