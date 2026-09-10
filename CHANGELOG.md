# Changelog — Ápice

Documentação das melhorias realizadas no projeto após auditoria técnica completa.

---

## Fase 1 — Correções Críticas

> Foco: segurança, estabilidade e limpeza da base de código.

### Segurança

**Cabeçalhos HTTP com Helmet**
- Instalado e configurado o pacote `helmet` em `server.js`
- Habilitados: Content Security Policy (CSP), X-Frame-Options, X-Content-Type-Options, Strict-Transport-Security, Referrer-Policy
- CSP definida com fontes explícitas: `self`, Google Fonts, avatars do GitHub
- `crossOriginEmbedderPolicy` desativado para compatibilidade com o GitHub OAuth

**Rate Limiting**
- Instalado e configurado o pacote `express-rate-limit`
- Limiter aplicado nas rotas `/api/auth`: 20 requisições por janela de 15 minutos
- Respostas de bloqueio padronizadas em JSON com mensagem amigável

**Cookie de Sessão Seguro**
- `httpOnly: true` — impede acesso via JavaScript ao cookie de sessão
- `secure: true` apenas em produção (`NODE_ENV === "production"`)
- `sameSite: "lax"` — proteção contra CSRF
- `maxAge: 24h` — expiração explícita

**Handler de JSON Malformado**
- Adicionado middleware de erro para `entity.parse.failed`
- Retorna HTTP 400 com mensagem padronizada em vez de crash 500

**Mensagens de erro genéricas**
- Removidas todas as exposições de `err.message` nas respostas HTTP de `empresaController.js` e `roadmapController.js`
- Logs internos mantidos via `console.error` com prefixo de rota
- Respostas ao cliente substituídas por `"Erro interno. Tente novamente."`

### Estabilidade

**`session.destroy()` com callback** — `authController.js`
- Corrigida chamada assíncrona sem callback que causava erro silencioso no logout
- Adicionado log de erro caso a destruição da sessão falhe

**`deleteJob` com try/catch completo** — `empresaController.js`
- A primeira query de verificação de ownership estava fora do bloco try/catch
- Envolvida em um único bloco que cobre todo o método

**Função `getUserId` duplicada removida** — `roadmapController.js`
- Função `getUserId` estava declarada duas vezes identicamente
- Mantida uma única declaração com comentário explicativo

**Filtro `WHERE active = 1`**
- Vagas inativas não aparecem mais no dashboard do desenvolvedor nem na listagem pública
- Aplicado em `server.js` (rota `/dashboard`) e `roadmapController.js` (`listJobs`, `listJobsWithDetails`)

### Validações

**Validators aplicados nas rotas de vagas** — `routes/empresa.js`
- `validateCreateJob` e `validateUpdateJob` existiam em `validators/job.vlidator.js` mas nunca eram importados
- Importados e aplicados nas rotas `POST /jobs`, `PATCH /jobs/:id`
- `jobIdParam` aplicado nas rotas que recebem `:id`

### UX e Identidade Visual

**Padronização da marca "Ápice"**
- Todas as ocorrências de "Dev Estágios" foram substituídas por "Ápice" em todos os arquivos `.ejs`
- Títulos de página (`<title>`), meta descriptions, Open Graph tags, footers e textos internos
- Arquivos afetados: `login.ejs`, `cadastro.ejs`, `roadmap.ejs`, `progresso.ejs`, `empresa-vagas.ejs`, `empresa-dashboard.ejs`, `vagas.ejs`, `empresa-vaga-form.ejs`, `vaga-publica.ejs`

**Páginas de erro customizadas**
- Criados `views/404.ejs` e `views/500.ejs` com design consistente com o sistema
- Substituem as respostas genéricas padrão do Express
- Incluem navegação de recuperação (voltar, ir para o início, ver vagas)
- Handler 404 diferencia requisições HTML de requisições de API (JSON vs render)

### Limpeza

**10 arquivos mortos removidos**
- `public/views/cadastro.html`
- `public/views/dashboard.html`
- `public/views/empresa-dashboard.html`
- `public/views/index.html`
- `public/views/login.html`
- `public/views/perfil.html`
- `public/views/progresso.html`
- `public/views/roadmap.html`
- `public/views/vagas.html`
- `public/css/teste.css`

**`.env.example` criado**
- Documenta todas as variáveis de ambiente necessárias sem valores reais
- Inclui instrução para gerar `SESSION_SECRET` seguro via `crypto.randomBytes`

---

## Fase 2 — Substituição de Dados Mock por API Real

> Foco: as duas páginas centrais do fluxo de empresa usavam arrays JavaScript hardcoded em vez de dados reais do banco.

### Problema

`empresa-matchs.ejs` e `empresa-desenvolvedores.ejs` carregavam dados de arrays `MOCK_MATCHS` e `MOCK_DEVS` definidos diretamente no JavaScript do frontend, tornando as páginas não funcionais com dados reais.

### Solução

**Migration SQL** — `config/migration_v2.sql`
- Adicionada coluna `github_id BIGINT` na tabela `user_dev_profiles` para vincular perfil de dev ao ID numérico do GitHub
- Criada tabela `company_match_actions` para persistir ações de aceitar/recusar match por empresa

**API de Matchs** — `GET /api/empresa/matchs`
- Novo método `getMatchs` em `empresaController.js`
- Busca todas as vagas ativas da empresa
- Busca todos os desenvolvedores com `github_id` vinculado
- Carrega skills de cada dev e de cada vaga
- Calcula score de compatibilidade usando `computeSkillScore` (ponderação por obrigatória/desejável)
- Aplica ações salvas (aceito/recusado) de `company_match_actions`
- Retorna lista ordenada por score decrescente

**API de Ação de Match** — `PATCH /api/empresa/matchs/:devGithubId/:jobId`
- Novo método `updateMatchAction` em `empresaController.js`
- Persiste ação (aceito/recusado) na tabela `company_match_actions` via `INSERT ... ON DUPLICATE KEY UPDATE`
- Valida ownership da vaga antes de salvar

**API de Desenvolvedores** — `GET /api/empresa/desenvolvedores`
- Novo método `getDesenvolvedores` em `empresaController.js`
- Retorna todos os devs com: nome, GitHub, nível, lista de skills (nomes), melhor score de match com vagas da empresa, progresso em roadmaps
- Calcula métricas de "em roadmap ativo" e "roadmap concluído"

**Frontend atualizado**
- `empresa-matchs.ejs`: removido `MOCK_MATCHS`, substituído por `fetch("/api/empresa/matchs")`
- `empresa-desenvolvedores.ejs`: removido `MOCK_DEVS`, substituído por `fetch("/api/empresa/desenvolvedores")`
- Botões "Aceitar" e "Recusar" agora fazem `PATCH` na API e persistem no banco
- Estado dos botões reflete a ação salva ao carregar a página

---

## Fase 3 — Melhorias de Qualidade e Perfil do Desenvolvedor

> Foco: fechar exposições de segurança residuais, corrigir bug de performance e implementar a funcionalidade "Ver Perfil".

### Segurança

**`err.message` residuais corrigidos** — `roadmapController.js`
- 5 métodos ainda expunham o erro interno na resposta HTTP
- Métodos corrigidos: `listJobsWithDetails`, `getRoadmap`, `updateSkillStatus`, `getPublicJob`, `getDashboard`
- Padrão aplicado: `console.error("[ROTA]", err.message)` + `res.status(500).json({ error: "Erro interno. Tente novamente." })`

**Bug de query no `getDashboard`** — `roadmapController.js`
- A versão do remoto tinha `WHERE urp.github_id = ?` em uma query com `LEFT JOIN`, transformando-o efetivamente em `INNER JOIN`
- Restaurada a cláusula `HAVING COUNT(urp.github_id) > 0` que filtra corretamente apenas roadmaps com progresso

### Performance

**`connectionLimit` do pool MySQL** — `database/db.js`
- Valor anterior: `1` — causava serialização de todas as queries (uma por vez)
- Valor novo: `5` — permite até 5 conexões concorrentes
- `maxIdle` atualizado de `1` para `5` de forma consistente

### Funcionalidade

**Página de Perfil do Desenvolvedor (visão da empresa)**

*Backend* — `empresaController.js` + `routes/empresa.js`
- Novo método `getDevProfile` que recebe o `user_id` interno do dev
- Retorna: nome completo, GitHub, nível, lista de skills com confidence, melhor score de match com vagas da empresa, título da vaga com maior compatibilidade, progresso em roadmaps
- Rota adicionada: `GET /api/empresa/dev/:id`
- Validação de ID inválido (retorna 400) e dev não encontrado (retorna 404)

*Rota de página* — `server.js`
- Adicionada rota `GET /empresa/dev/:id` que renderiza `perfil-dev-empresa.ejs`
- Validação de ID antes de renderizar, com redirect para lista se inválido

*Nova view* — `views/perfil-dev-empresa.ejs`
- Página completa com sidebar da empresa
- Hero card com avatar colorido gerado por gradiente, nome, link GitHub, nível, badge da vaga mais compatível e score de match
- Seção de skills com barras de progresso animadas e percentual de confidence
- Seção de progresso em roadmaps (visível apenas se o dev tiver progresso)
- Estado de loading e estado de erro com mensagem e link de volta

*Frontend atualizado*
- `empresa-desenvolvedores.ejs`: `verPerfil(id)` navega para `/empresa/dev/:id`
- `empresa-matchs.ejs`: `verPerfil(devId)` navega para `/empresa/dev/:id`
- Substituídas as chamadas de toast "em breve" pelas navegações reais

### Favicon

**Adicionado em todos os views**
- `<link rel="icon" type="image/webp" href="/img/principal-gradiente.webp" />` inserido no `<head>` de todos os arquivos `.ejs`
- Unificado com a contribuição do colaborador remoto (Maeda13)

---

## Fase 4 — Auditoria pré-lançamento: segurança, consistência e recuperação de senha

> Foco: itens levantados numa auditoria completa do site (backend, banco, git, frontend) feita antes do lançamento. Cobre desde vulnerabilidades exploráveis até funcionalidade essencial que faltava.

### Segurança

**Upload de avatar permitia gravar HTML/script no domínio do site (XSS armazenado)** — `controllers/profileController.js`
- A extensão do arquivo salvo vinha de `path.extname(file.originalname)` — nome de arquivo enviado pelo cliente, totalmente falsificável — enquanto só o `mimetype` (também falsificável) era validado
- Um request malicioso com `Content-Type: image/jpeg` e `filename="x.html"` conseguia gravar um `.html` de verdade em `public/uploads/avatars/`, servido estaticamente no mesmo domínio; como o CSP libera `'unsafe-inline'` em `scriptSrc`, esse HTML executava script no mesmo domínio
- Corrigido: a extensão agora vem de uma tabela fixa `mimetype → extensão` (`MIME_TO_EXT`), nunca do nome enviado pelo cliente — mesmo que o mimetype seja falsificado, o arquivo salvo sempre tem extensão de imagem, e o `X-Content-Type-Options: nosniff` do Helmet impede o navegador de executar o conteúdo como HTML

**`.env.example` continha segredos reais, não placeholders**
- O arquivo estava com `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `SESSION_SECRET`, `DB_HOST/PORT/NAME/USER/PASS` preenchidos com valores reais (uma cópia antiga do `.env`), e ainda estava listado no `.gitignore` — ou seja, nunca tinha sido commitado, mas corria o risco de ser commitado a qualquer momento com segredos reais dentro
- Reescrito com placeholders vazios/de exemplo; removido do `.gitignore` e adicionado ao versionamento de fato

**O próprio `.gitignore` nunca tinha sido commitado**
- Ele listava a si mesmo (`.gitignore`) como um dos padrões ignorados — por isso `git add -A`/`git add .` nunca conseguia incluí-lo no repositório, mesmo já existindo no disco há tempo
- Na prática, qualquer outro clone do repositório (outra máquina, outro colaborador, CI) ficava **sem nenhuma proteção** contra commitar `.env`, `node_modules/` ou `package-lock.json` por engano
- Corrigido: removida a linha autorreferente e commitado (`git add -f .gitignore`) de fato pela primeira vez

**Login com GitHub podia sequestrar uma conta empresa para uma sessão "dev"** — `controllers/authController.js`
- O callback do OAuth buscava usuário existente só por e-mail, sem checar `type`, e sempre montava a sessão com `type: "dev"` fixo
- Se o e-mail de uma conta empresa colidisse com o e-mail de uma conta GitHub, a empresa virava uma sessão "dev" inconsistente com o banco
- Corrigido: se o e-mail já pertence a uma conta que não é `dev`, o login por GitHub é recusado com redirect para `/login?error=email_in_use_company` e mensagem explicativa

**Foto de usuário real commitada no git** — `public/uploads/avatars/1.jpeg`
- Removida do versionamento (`git rm --cached`); `public/uploads/` adicionado ao `.gitignore` (a pasta é recriada em runtime pelo próprio código)

### Consistência de dados

**O "% de match" era calculado de duas formas diferentes** — `controllers/empresaController.js` + `services/matchCalculator.js`
- A visão da empresa (`getMatchs`, `getDesenvolvedores`, `getDevProfile`) usava uma função local (`computeSkillScore`) considerando só skills
- A visão do dev (roadmap, vaga pública) usava `calculateJobMatch`, com skills 85% + senioridade 15% — a mesma vaga podia mostrar % diferente para a empresa e para o dev
- Corrigido: `matchCalculator.js` agora exporta `computeSkillsScore`, `computeSeniorityScore` e `computeMatch` como núcleo puro reutilizável; `empresaController.js` usa `computeMatch` para as três telas, garantindo o mesmo número dos dois lados. `calculateJobMatch` foi refatorado para usar o mesmo núcleo por dentro, então não há mais duas fórmulas para manter sincronizadas

### Funcionalidade

**Fluxo completo de "esqueci minha senha" implementado** (antes não existia — nem link funcional, nem rota, nem capacidade de e-mail no projeto)
- Nova dependência: `nodemailer` — `services/emailService.js` (falha com erro claro se `SMTP_*` não estiver configurado, sem derrubar a aplicação)
- Nova tabela `password_resets` (token com hash SHA-256, expiração de 1h, uso único) — criada automaticamente pela auto-migração de `database/db.js`, mesmo padrão já usado no projeto
- Novos endpoints em `routes/users.js` (sob `/api/auth`, já cobertos pelo rate limiter existente): `POST /api/auth/forgot-password` e `POST /api/auth/reset-password`, com validação em `validators/auth.validator.js` e lógica em `controllers/usersController.js`
- Resposta de `forgot-password` é sempre genérica — nunca revela se o e-mail existe ou se a conta é GitHub-only (sem senha)
- Novas páginas `views/esqueci-senha.ejs` e `views/redefinir-senha.ejs`, seguindo o mesmo layout/design system de `login.ejs`
- Novas rotas de página em `server.js`: `GET /esqueci-senha`, `GET /redefinir-senha`
- Link "Esqueci minha senha" em `login.ejs` (antes `href="#"` morto) agora aponta para `/esqueci-senha`

**Toggle de modo escuro / alto contraste agora é alcançável** — `views/partials/header-dev.ejs`, `header-company.ejs`, `public/js/accessibility.js`, `public/css/header.css`
- As funções já existiam e estavam carregadas em algumas páginas, mas os únicos botões que as chamavam ficavam em partials (`sidebar-dev.ejs`, `sidebar-company.ejs`) nunca incluídos em nenhuma página real
- `accessibility.js` agora é carregado uma vez, pelo próprio header (dev/empresa), em toda página autenticada — removidos os `<script>` duplicados que existiam em 5 páginas individuais
- Botões adicionados no dropdown do usuário e no drawer mobile de ambos os headers; `accessibility.js` ajustado para sincronizar múltiplos botões do mesmo toggle via `data-a11y` em vez de um `id` fixo

### Limpeza

- `validators/job.vlidator.js` (nome com erro de digitação) removido — era cópia idêntica não usada de `validators/job.validator.js`
- `validators/roadmap.validator.js` agora é de fato usado por `routes/roadmap.js` (antes a validação de `status` só existia manualmente dentro do controller)
- Modal morto de criar/editar vaga removido de `views/empresa-dashboard.ejs` (`openModal`/`openEditModal`, nunca chamados — o fluxo real usa as páginas `/empresa/vagas/nova` e `/editar`; o payload do modal também estava desatualizado, faltando os campos adicionados depois)
- `config/script_bd.sql` reconstruído do zero: o arquivo antigo tinha uma linha corrompida (`-- MySQL dump...` sem o prefixo `--`, quebrando a execução), nomes de banco inconsistentes entre si e com o `.env`, e nenhum dado. O novo é um schema único, idempotente (`CREATE TABLE IF NOT EXISTS`, nunca `DROP`) refletindo o estado atual (tabelas base + todas as migrations em `database/*.js`, incluindo `password_resets`)

### Não alterado (decisão consciente, não é bug)

- **Segredos antigos no histórico do git**: `.env` foi commitado e apagado duas vezes no passado; confirmei que os valores atuais (`DB_*`, `GITHUB_CLIENT_SECRET`, `SESSION_SECRET`) já foram rotacionados e diferem dos que vazaram — mas o histórico do git ainda contém os valores antigos para quem tiver acesso ao repositório. Reescrever o histórico (`git filter-repo`/BFG + force-push) é destrutivo e afeta todo mundo com um clone do repo, então não fiz isso sem confirmação explícita.
- **`landing/index.html`**: protótipo estático órfão (não servido pelo Express, todos os links são `href="#"`). Não removi porque pode ser intencional para uma landing separada — confirmar antes de apagar.
- **`NODE_ENV` em produção**: o código já usa `NODE_ENV === "production"` para ativar cookie `secure`; isso depende de a variável estar configurada no painel do Clever Cloud, algo que não dá para verificar ou alterar a partir daqui.
- **Verificação de e-mail no cadastro e testes automatizados**: identificados na auditoria, mas fora do escopo desta rodada de correções — ver seção de ações manuais.

## Fase 5 — Área Administrador, Planos de Assinatura e base de Mensagens

> Foco: três áreas do produto que não existiam ainda, identificadas a partir do documento de priorização do time (Admin e Planos marcados como bloqueadores de lançamento; Mensagens como prioridade média, com protótipo a caminho).

### Área Administrador (bloqueador — concluído)

**Papel `admin` e infraestrutura de acesso**
- `users.type` ganhou o valor `'admin'` (`database/db.js`, auto-migração idempotente — não mexe nos valores existentes)
- Nova coluna `users.active` — suspensão de conta, usada tanto por devs quanto empresas
- Nova tabela `user_admin_profiles` (mesmo padrão de `user_dev_profiles`/`user_company_profiles`)
- Sem cadastro público de admin (`validateRegister` já restringe `type` a `dev`/`empresa`) — a única forma de criar a conta é `node database/seed-admin.js`, que lê `ADMIN_EMAIL`/`ADMIN_PASSWORD`/`ADMIN_NOME` do `.env`
- `middlewares/auth.js`: novos `requireAdmin`/`isAdmin`; `redirectIfAuth` agora manda admin logado pra `/admin/dashboard`
- Login (`usersController.login`) e login com GitHub (`authController.githubCallback`) passam a rejeitar contas com `active = 0`

**Backend** — `controllers/adminController.js` + `routes/admin.js` (`/api/admin`, atrás de `isAdmin`)
- Dashboard com métricas agregadas da plataforma
- Gestão de desenvolvedores e empresas (listar, suspender/reativar, definir plano manualmente)
- Gestão de vagas (visão de todas as vagas de todas as empresas, pausar/reativar)
- Monitoramento de matchs (ações aceito/recusado agregadas + top matchs ≥70%)
- Relatórios (skills mais comuns, vagas por nível, candidaturas por vaga, cadastros por semana)
- Configurações gerais → CRUD do catálogo de skills e seus recursos de aprendizado (antes só existia via script de seed, sem UI nenhuma)

**Frontend** — `views/partials/header-admin.ejs` (segue o padrão de `header-company.ejs`) + 7 páginas novas (`admin-dashboard`, `admin-usuarios`, `admin-empresas`, `admin-vagas`, `admin-matchs`, `admin-relatorios`, `admin-configuracoes`), reaproveitando `empresa-dashboard.css` (tabelas, cards de métrica, badges) em vez de criar CSS novo

### Planos de Assinatura (bloqueador — concluído, gateway de pagamento pendente)

- `config/plans.js`: os 5 planos do modelo Freemium (dev Gratuito/PRO, empresa Free/Básico/Premium), como objeto estático — sem UI de "criar plano", não precisa ser tabela
- Nova tabela `user_subscriptions` — ausência de linha = plano gratuito do tipo do usuário
- `services/subscriptionService.js` — única fonte de verdade sobre limites/features (`canCreateJob`, `hasFeature`, `getUserPlan`, `setUserPlan`)
- **Enforcement real:**
  - Empresa no plano Free/Básico não consegue publicar ou reativar vaga além do limite do plano (`empresaController.createJob`/`updateJob`) — responde `402` com mensagem de upgrade
  - Dev no plano gratuito continua vendo quais skills faltam no roadmap, mas sem os cursos/vídeos recomendados (exclusivo do PRO) — `services/roadmapGenerator.js` retorna `locked: true` em vez de simplesmente esconder a skill, e `views/roadmap.ejs` mostra um convite pra upgrade em vez de "sem recursos"
  - Dev PRO ganha selo "★ PRO" no perfil visto pela empresa (`empresa-desenvolvedores.ejs`, `perfil-dev-empresa.ejs`)
- **Como não há gateway de pagamento escolhido ainda**, o "checkout" por enquanto é manual: o admin define o plano de qualquer dev/empresa direto em `admin-usuarios.ejs`/`admin-empresas.ejs`. Isso já serve de válvula de escape até o pagamento real existir, e continua útil depois disso pra suporte/cortesias
- Seção "Meu plano" adicionada em `perfil-dev.ejs`/`perfil-empresa.ejs` (mostra plano atual e limites — sem botão de upgrade funcional ainda, de propósito: não faz sentido criar mais um CTA morto antes do checkout existir)
- **Não incluído nesta fase** (documentado, não esquecido): checkout/webhook real de pagamento (`services/billingService.js` não foi criado — aguarda decisão de gateway) e o motor de "alertas prioritários de vagas" do plano PRO (é uma funcionalidade nova de notificação, não só gating de algo que já existe)

### Base de Mensagens (prioridade média — schema + API prontos, UI aguardando protótipo)

- Novas tabelas `conversations` (dev × empresa × vaga opcional) e `messages`
- `controllers/messagesController.js` + `routes/messages.js` (`/api/messages`): listar conversas com prévia da última mensagem e contagem de não lidas, iniciar conversa, enviar mensagem, marcar como lida — com verificação de que só os dois lados da conversa conseguem acessá-la
- Sem view ainda — a UI (`views/mensagens.ejs` pro dev, view equivalente pra empresa) fica pra quando o protótipo chegar, pra não desenhar uma tela sem referência

### Testado de ponta a ponta contra o banco real (Clever Cloud)
- Login como admin redireciona certo; dev/empresa não acessam `/admin/*` (redirect na página, 403 na API)
- CRUD de skills + recursos de aprendizado no admin
- Empresa no plano Free bloqueada na 2ª vaga ativa (`402`); upgrade manual via admin libera; `GET /api/empresa/profile` reflete o plano novo
- Roadmap: mesmo dev/vaga real, comparação lado a lado — free sem `resources`, PRO com `resources` completos
- Mensagens: dev inicia conversa (idempotente — repetir a chamada reusa a mesma conversa em vez de duplicar), envia mensagem, empresa lê/marca como lida/responde, terceira empresa recebe `404` ao tentar acessar a conversa de outra
- Toda conta e vaga de teste criada durante os testes foi removida do banco depois

## Fase 6 — UI de Mensagens (a partir do protótipo) + correção de race condition no boot

> Foco: a UI de Mensagens que tinha ficado pendente na Fase 5 (só existia banco + API), agora construída em cima do protótipo enviado pelo time (layout de 3 colunas, estilo WhatsApp Web). No processo, apareceram dois bugs reais que valeram a correção.

### UI de Mensagens

- `views/mensagens.ejs` (dev) e `views/empresa-mensagens.ejs` (empresa) — layout de 3 colunas: lista de conversas com busca/filtro (Todas/Não lidas) à esquerda, conversa ativa no meio, painel de informações à direita (mostra dados da empresa pro dev, e o perfil resumido do dev pra empresa — reaproveita `GET /api/empresa/dev/:id`, que já existia)
- `public/css/mensagens.css` — novo, compartilhado pelas duas páginas
- Ícone de mensagens com badge de não lidas adicionado em `header-dev.ejs`/`header-company.ejs` (`GET /api/messages/unread-count`, endpoint novo e leve, separado de `listConversations` pra não pesar em toda página)
- **"Nova conversa"**: em vez de um buscador de empresas/devs solto, o dev busca por **vaga** (reaproveita `GET /api/jobs/detalhes`) e a empresa é resolvida a partir da vaga — `messagesController.startConversation` ganhou essa dedução automática quando só vem `job_id`. A empresa busca por **desenvolvedor** (reaproveita `GET /api/empresa/desenvolvedores`)
- **Campos novos no perfil da empresa** — `descricao`, `cidade`, `estado` (`user_company_profiles`), porque o protótipo mostra "Sobre a empresa" e localização no painel de mensagens e esses dados não existiam. Editáveis em `/empresa/perfil`; expostos por um novo endpoint público-pra-quem-tá-logado `GET /api/empresas/:id` (`routes/company-public.js`, separado de `routes/empresa.js` porque aquele é todo travado pra "só a própria empresa")

### Dois bugs reais encontrados testando contra o banco de produção

**1. Condição de corrida no boot — o servidor aceitava requisição antes das migrações terminarem**
`server.js` chamava `app.listen()` de forma síncrona logo depois de `require("./database/db")`, mas as migrações automáticas (`testarConexao()`) rodam em segundo plano sem ninguém esperar por elas. Nos meus testes, uma requisição batendo nas colunas novas (`descricao`/`cidade`/`estado`) menos de ~3s depois do boot falhava com `Unknown column`. Isso não é só um problema do meu teste — **acontece de verdade em todo deploy/restart em produção**, criando uma janela de erro 500 logo após cada deploy no Clever Cloud. Corrigido: `app.listen()` agora espera `db.ready` (a promise que `database/db.js` já expunha desde a Fase 5, mas que nada usava ainda).

**2. Dev sem GitHub vinculado aparecia com nome e id nulos nas conversas**
`conversations.dev_github_id` guarda o `github_id` de verdade quando existe, ou o `user_id` interno como *fallback* pra devs que se cadastraram só com e-mail/senha (mesmo padrão de `getUserId()` já usado no resto do app). O `JOIN` de `listConversations` só casava por `github_id`, então pra esses devs `dev_name`/`dev_id` vinham `null` — e a empresa não conseguia nem abrir o perfil do dev no painel de mensagens (`ID inválido`). Corrigido casando por `github_id` OU `user_id`.

### Testado de ponta a ponta contra o banco real
Cadastro → dev busca vaga → inicia conversa → manda mensagem → empresa vê badge de não lida → empresa abre o painel do dev → dev abre o painel da empresa (com descrição/cidade/vagas abertas de verdade) → confirmado que o boot não aceita mais requisição antes da hora. Contas de teste removidas depois.

## Fase 7 — Integração de IA generativa (Gemini) + distribuição de linguagens no roadmap

> Foco: adicionar IA generativa a funcionalidades já existentes (análise de repositório, compatibilidade, trilha de estudos, portfólio) e criar quatro funcionalidades novas (mentor de carreira, simulador de entrevista, resumo de candidatos, insights de mercado), reaproveitando a identidade visual e os padrões técnicos já estabelecidos no projeto — sem quebrar cadastro, login, importação de repositórios ou o cálculo de compatibilidade existente.

### Client de IA centralizado

**`services/geminiClient.js`** — ponto único de configuração para toda chamada de IA, no mesmo espírito de `services/subscriptionService.js` ser o ponto único para planos
- Usa a **Interactions API** do Gemini (`POST /v1beta/interactions`, Google AI Studio, nível gratuito) — não a `generateContent` mais antiga
- Modelo configurável via `GEMINI_MODEL` (nunca hardcoded), padrão `gemini-3.6-flash`
- `askGeminiJSON({ system, prompt, maxTokens })` sempre pede e faz parse de JSON estruturado, no mesmo espírito de como a resposta da API do GitHub já era tratada
- **Descobertas só visíveis testando contra a API real** (documentado aqui porque não tinha como prever sem uma chave de verdade):
  - O campo correto é `generation_config.max_output_tokens`, não `max_tokens`
  - O texto gerado vem em `steps[].content[].text` (no step do tipo `"model_output"`), não em `output_text` como a documentação sugeria
  - O Gemini soma os tokens de "thinking" interno dentro do próprio teto de `max_output_tokens` — nos testes, ~400-450 tokens de raciocínio antes mesmo de começar a gerar a resposta, mesmo com `thinking_level: "low"`. Os valores herdados de uma tentativa anterior com Claude (512-1024) truncavam a resposta no meio do JSON; todos os serviços foram recalibrados para 1536-3072
  - `gemini-3.7-flash` (modelo mais novo disponível) apresentou alta latência e um erro de indisponibilidade temporária nos testes (17-35s para uma pergunta trivial); `gemini-3.6-flash` respondeu de forma consistente em 3-9s e foi o modelo mantido como padrão
- **Migração anterior:** o client já tinha sido implementado uma vez sobre a Messages API da Anthropic (Claude), a pedido inicial, e depois totalmente substituído pelo Gemini a pedido do usuário — `services/anthropicClient.js` foi removido, sem deixar código morto

### Melhorias em funcionalidades já existentes

**1. Análise de repositórios com IA** — `services/aiProfileAnalyzer.js`
- Além da extração estática já existente (linguagem por extensão, dependências), envia README + estrutura de cada repositório pra IA e recebe de volta proficiência estimada, boas práticas identificadas e pontos de melhoria
- Nova tabela `perfil_tecnico_ia`, vinculada ao usuário — resultado é cacheado, não reprocessa a cada acesso
- `GET /api/ai/perfil-tecnico` (`routes/ai.js`)
- `fetchRepoReadme`/`fetchRepoLanguages` de `services/githubAnalyzer.js` passaram a ser exportadas para reuso, em vez de duplicar a lógica de busca de README

**2. Compatibilidade semântica com vagas** — `services/matchCalculator.js`
- Nova função `getMatchExplanation(githubId, jobId)`: reaproveita `calculateJobMatch` como única fonte de verdade do percentual numérico (não substitui, só complementa), envia o breakdown de skills pra IA e recebe de volta uma explicação textual curta de por que aquele número saiu daquele jeito
- Nova tabela `match_ia_cache`, cacheada por par candidato-vaga
- `GET /api/ai/jobs/:id/match-explicacao`

**3. Trilha de estudos personalizada** — `services/roadmapGenerator.js`
- Quando o plano já libera a trilha personalizada (`hasFeature('roadmap_personalizado')`, feature PRO que já existia), cada skill faltante ganha `ia_motivo`/`ia_tipo_recurso` gerados por IA a partir do gap de skills, além dos recursos estáticos do banco
- Uma única chamada de IA para todo o gap de skills de uma vez (não uma por skill), decisão de custo/latência
- Falha graciosamente: se a IA não responder, a trilha continua funcionando só com os recursos estáticos, sem quebrar nada

**4. Portfólio com descrições geradas** — `services/portfolioDescriber.js`
- Funcionalidade nova por completo (não existia geração de portfólio no projeto antes desta fase)
- Para cada repositório, gera uma descrição profissional a partir do README e da linguagem, sob demanda
- Nova coluna `ai_description` em `user_repositories`
- `POST /api/user/repos/:id/gerar-descricao` (`routes/repositorios.js`)
- Botão "Gerar com IA" no modal de edição já existente em `views/repositorios.ejs` — preenche o campo, usuário revisa e salva pelo fluxo que já existia

### Funcionalidades novas

**5. Mentor de carreira (chat)** — exclusivo plano PRO
- `services/mentorChat.js`: usa skills + nível do usuário como contexto de sistema, mantém histórico de conversa
- Nova tabela `mentor_conversas`
- `GET /api/ai/mentor/historico`, `POST /api/ai/mentor/mensagem`, gate 402 no mesmo padrão já usado em `empresaController.createJob`
- Nova página `/mentor` + `views/mentor.ejs`, clonando a estrutura visual de `views/mensagens.ejs` (bolhas de conversa, `escapeHtml`, toast)

**6. Simulador de entrevista técnica** — exclusivo plano PRO
- `services/interviewSimulator.js`: gera pergunta técnica a partir do nível/skills do candidato (e, opcionalmente, dos requisitos de uma vaga), recebe resposta em texto e devolve feedback específico
- Nova tabela `entrevista_simulacoes`
- `POST /api/ai/entrevista/iniciar`, `POST /api/ai/entrevista/:id/responder`
- Nova página `/entrevista` + `views/entrevista.ejs`, reaproveitando `.dev-card`/`.repos-empty`/`.btn-primary-dev` já existentes em `dev.css`

**7. Resumo inteligente de candidatos** — exclusivo empresa Premium
- Não existia endpoint de listagem de candidaturas recebidas (`job_applications` só era contado, nunca listado) — `getJobApplications` e `getApplicationSummary` foram criados em `controllers/empresaController.js`, reaproveitando o controller/estilo já usado ali
- `services/candidateSummarizer.js`: gera resumo curto (pontos fortes, projetos relevantes) a partir de skills + repositórios públicos do candidato
- Nova coluna `resumo_ia` em `job_applications`
- `GET /api/empresa/jobs/:id/candidaturas`, `POST /api/empresa/candidaturas/:id/resumo-ia`

**8. Insights de mercado** — página pública, sem gate de plano
- `services/marketInsights.js`: agrega quantas vagas ativas pedem cada skill, gera resumo textual das tecnologias mais demandadas
- Nova tabela `mercado_insights` — pensada como rotina periódica; como não há cron configurado no projeto ainda, gera sob demanda quando não há um insight salvo
- `GET /api/ai/insights-mercado`
- Nova página pública `/insights-mercado` + `views/insights-mercado.ejs`, com o mesmo condicional `<% if (locals.user) %>` de header dev/público já usado em `views/vagas.ejs`

### LGPD

Em todo ponto onde um payload é montado para envio à IA, um comentário explícito marca que só vão tecnologias, skills e trechos de README/descrição — nunca nome completo, e-mail ou outro dado pessoal do candidato. Vale para os 8 itens acima.

### Distribuição de linguagens no roadmap

Funcionalidade separada, pedida depois: a página `/roadmap` só mostrava a trilha de skills faltantes para uma vaga específica — não existia, em nenhuma tela do projeto, um resumo visual de "% de cada linguagem no perfil do usuário" (tipo o gráfico de linguagens de um perfil do GitHub). Não era uma regressão, era funcionalidade que nunca tinha sido construída.

- Novo método `getLanguageDistribution` em `controllers/roadmapController.js`: agrega `user_repositories.language` por usuário (contagem de repositórios por linguagem, convertida em percentual)
- `GET /api/user/languages` (`routes/roadmap.js`)
- Nova seção "💻 Linguagens do seu perfil" em `views/roadmap.ejs`, logo abaixo do resumo numérico de skills — carregada em paralelo com o roadmap, sem bloquear o resto da página; se falhar, a seção se esconde sozinha
- CSS em `public/css/roadmap.css`, reaproveitando as variáveis do design system (`--accent`, `--bg-3`, `--border-lite`) e o padrão visual das seções (`#section-known`/`#section-learn`) que já existiam

### Configuração

**`.env.example`** — nova seção:
```
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.6-flash
```
Sem `GEMINI_API_KEY` definida, as funcionalidades de IA falham de forma isolada (erro logado no servidor, resposta HTTP 502) — o resto da plataforma continua funcionando normalmente, mesmo padrão de degradação graciosa já usado para `SMTP_*`.

**Nenhuma dependência nova instalada** — todas as chamadas de IA usam `axios`, que já era dependência do projeto (mesmo padrão da integração com a API do GitHub).

### Testado de ponta a ponta contra dados reais

- **Insights de mercado**: gerou resumo real a partir das vagas cadastradas (27s na primeira chamada — sem cache —, 0.2s na segunda, já cacheado)
- **Mentor de carreira**: conversa real com um usuário existente (skills reais do banco) — resposta contextualizada corretamente às skills que ele já tinha
- **Simulador de entrevista**: gerou pergunta técnica real e avaliou uma resposta deliberadamente errada — o feedback identificou corretamente que a resposta não respondia à pergunta
- **Distribuição de linguagens**: query testada contra repositórios reais de um usuário (2 repos HTML + 1 JavaScript → 67%/33%, soma 100% corretamente)
- Regressão completa rodada depois de cada mudança: todas as rotas pré-existentes (`/`, `/dashboard`, `/repositorios`, `/roadmap`, `/mensagens`, `/api/jobs`, `/api/user/repos`, `/empresa/dashboard`) continuam respondendo exatamente como antes
- Dados de teste (conversa do mentor, simulação de entrevista) removidos do banco depois dos testes
- **Não testado**: análise de repositório e descrição de portfólio via IA — ambas dependem de um token OAuth do GitHub numa sessão de navegador real, que não é simulável por script. O código reaproveita `fetchRepoReadme`, que já existia e funcionava antes desta fase, então o risco é concentrado só na chamada à IA em si (já testada em outros três fluxos)

### Não alterado (decisão consciente, não é bug)

- **Segredos reais que apareceram no `.env.example` local durante o trabalho**: em determinado ponto o `.env.example` do working tree continha valores reais de banco/GitHub OAuth em vez de placeholders (não estavam no histórico do git ainda). Foram substituídos por placeholders vazios antes do primeiro commit desta fase, então nunca chegaram a ser publicados no `origin/main`.

### Arquivos da Fase 7

**Novos:** `services/geminiClient.js`, `services/aiProfileAnalyzer.js`, `services/portfolioDescriber.js`, `services/mentorChat.js`, `services/interviewSimulator.js`, `services/candidateSummarizer.js`, `services/marketInsights.js`, `routes/ai.js`, `views/mentor.ejs`, `views/entrevista.ejs`, `views/insights-mercado.ejs`

**Alterados:** `.env.example`, `config/plans.js` (novas feature keys `mentor_carreira`/`simulador_entrevista`), `config/script_bd.sql`, `database/db.js` (7 tabelas novas + 2 colunas novas), `controllers/empresaController.js`, `controllers/roadmapController.js`, `routes/empresa.js`, `routes/repositorios.js`, `routes/roadmap.js`, `server.js` (rotas de página `/mentor`, `/entrevista`, `/insights-mercado`), `services/githubAnalyzer.js`, `services/matchCalculator.js`, `services/roadmapGenerator.js`, `views/repositorios.ejs`, `views/roadmap.ejs`, `public/css/roadmap.css`

**Removido:** `services/anthropicClient.js` (substituído por `geminiClient.js`)

## Arquivos modificados por fase

| Arquivo | Fase 1 | Fase 2 | Fase 3 | Fase 4 |
|---|:---:|:---:|:---:|:---:|
| `server.js` | ✅ | — | ✅ | ✅ |
| `database/db.js` | — | — | ✅ | ✅ |
| `controllers/authController.js` | ✅ | — | — | ✅ |
| `controllers/empresaController.js` | ✅ | ✅ | ✅ | ✅ |
| `controllers/roadmapController.js` | ✅ | — | ✅ | — |
| `controllers/profileController.js` | — | — | — | ✅ |
| `controllers/usersController.js` | — | — | — | ✅ |
| `routes/empresa.js` | ✅ | ✅ | ✅ | — |
| `routes/roadmap.js` | — | — | — | ✅ |
| `routes/users.js` | — | — | — | ✅ |
| `validators/job.vlidator.js` | ✅ | — | — | 🗑️ removido |
| `validators/auth.validator.js` | — | — | — | ✅ |
| `services/matchCalculator.js` | — | — | — | ✅ |
| `services/emailService.js` | — | — | — | 🆕 novo |
| `config/migration_v2.sql` | — | ✅ | — | — |
| `config/script_bd.sql` | — | — | — | ✅ reconstruído |
| `.env.example` | ✅ | — | — | ✅ |
| `.gitignore` | — | — | — | ✅ |
| `package.json` | — | — | — | ✅ (+ nodemailer) |
| `views/login.ejs` | ✅ | — | ✅ | ✅ |
| `views/cadastro.ejs` | ✅ | — | ✅ | — |
| `views/esqueci-senha.ejs` | — | — | — | 🆕 novo |
| `views/redefinir-senha.ejs` | — | — | — | 🆕 novo |
| `views/dashboard.ejs` | — | — | — | ✅ |
| `views/roadmap.ejs` | ✅ | — | ✅ | ✅ |
| `views/progresso.ejs` | ✅ | — | ✅ | — |
| `views/repositorios.ejs` | — | — | — | ✅ |
| `views/perfil-dev.ejs` | — | — | — | ✅ |
| `views/perfil-empresa.ejs` | — | — | — | ✅ |
| `views/vagas.ejs` | ✅ | — | ✅ | — |
| `views/vaga-publica.ejs` | ✅ | — | ✅ | — |
| `views/empresa-dashboard.ejs` | ✅ | — | ✅ | ✅ |
| `views/empresa-vagas.ejs` | ✅ | — | ✅ | — |
| `views/empresa-vaga-form.ejs` | ✅ | — | ✅ | — |
| `views/empresa-matchs.ejs` | ✅ | ✅ | ✅ | — |
| `views/empresa-desenvolvedores.ejs` | ✅ | ✅ | ✅ | — |
| `views/404.ejs` | ✅ | — | — | — |
| `views/500.ejs` | ✅ | — | — | — |
| `views/perfil-dev-empresa.ejs` | — | — | ✅ | — |
| `views/partials/header-dev.ejs` | — | — | — | ✅ |
| `views/partials/header-company.ejs` | — | — | — | ✅ |
| `public/css/header.css` | — | — | — | ✅ |
| `public/js/accessibility.js` | — | — | — | ✅ |
| `public/uploads/avatars/1.jpeg` | — | — | — | 🗑️ removido do git |

---

## Ações manuais necessárias

As ações abaixo **não podem ser feitas automaticamente** e precisam ser executadas pelo responsável do projeto:

### ~~1. Rodar a migration no banco de dados~~ — ✅ obsoleto

`database/db.js` (`testarConexao()`) já roda essa e todas as migrations seguintes automaticamente, de forma idempotente, toda vez que o servidor sobe — inclusive a `password_resets` da Fase 4. Não precisa mais rodar `config/migration_v2.sql` manualmente.

### ~~2. Rotacionar credenciais comprometidas~~ — ✅ já feito

Confirmado comparando o `.env` atual com as duas versões antigas commitadas no histórico do git (`70d33a4^` e `2660173^`): `DB_HOST/NAME/USER/PASS`, `GITHUB_CLIENT_ID/SECRET` e `SESSION_SECRET` já são todos diferentes dos valores que vazaram. Nenhuma ação pendente aqui.

### 3. Configurar SMTP para o e-mail de redefinição de senha funcionar (Fase 4)

Sem isso, `POST /api/auth/forgot-password` continua respondendo com sucesso genérico (não quebra a UI, não vaza quais e-mails existem), mas nenhum e-mail é enviado de verdade — só um `console.error` no servidor.

| Variável | Descrição |
|---|---|
| `SMTP_HOST` | Host do provedor SMTP (ex: um serviço transacional como SendGrid, Mailgun, SES, etc.) |
| `SMTP_PORT` | Geralmente `587` (STARTTLS) ou `465` (TLS implícito) |
| `SMTP_USER` / `SMTP_PASS` | Credenciais do provedor |
| `SMTP_FROM` | Remetente, ex: `Ápice <no-reply@apice.app>` |

Configurar no `.env` local e nas variáveis de ambiente de produção (Clever Cloud).

### 4. Confirmar `NODE_ENV=production` no ambiente de produção (Clever Cloud)

`server.js` só ativa `cookie.secure: true` (cookie de sessão só por HTTPS) quando `NODE_ENV === "production"`. Isso não dá para confirmar a partir do repositório — precisa ser checado no painel do Clever Cloud.

### 5. (Opcional) Purgar segredos antigos do histórico do git

As credenciais já foram rotacionadas (item 2), então não é urgente, mas o histórico do git ainda expõe os valores antigos (`.env` foi commitado e apagado duas vezes: commits `70d33a4` e `2660173`). Se o repositório é ou vai ser público, ou tem colaboradores fora do time de confiança, considerar `git filter-repo` ou BFG Repo-Cleaner para remover essas duas versões do histórico — é uma operação destrutiva que reescreve hashes de commit e exige force-push coordenado com todo mundo que tem um clone, por isso não foi feita automaticamente.

### 6. Trocar a senha da conta admin criada para testes (Fase 5)

Rodei `node database/seed-admin.js` para poder testar a Área Administrador de ponta a ponta contra o banco de produção. Isso criou uma conta real:

- E-mail: `admin.teste@apice.app`
- Senha: `TesteAdmin123!`

**Troque essa senha (ou crie sua própria conta admin e desative/apague essa) antes do lançamento** — são credenciais que ficaram neste chat, não algo que só você conhece. Pra criar uma conta sua: defina `ADMIN_EMAIL`/`ADMIN_PASSWORD`/`ADMIN_NOME` no `.env` com seus próprios valores e rode o script de novo (ele não mexe em contas com e-mail diferente).

### 7. Escolher gateway de pagamento (Fase 5)

O sistema de planos já limita vagas por plano e libera/restringe recursos do dev (roadmap, destaque de perfil), mas o "pagar de verdade" ainda não existe — hoje o plano de qualquer usuário só muda manualmente pelo admin. Quando decidirem entre Mercado Pago, Stripe ou outro, dá pra plugar o checkout/webhook em cima do que já existe (`services/subscriptionService.js`) sem mexer no resto.

### 8. Revisar o protótipo de Mensagens quando estiver pronto (Fase 5)

O banco e a API (`/api/messages/*`) já funcionam ponta a ponta. Falta só a tela — me manda o protótipo que eu volto com o design certo em vez de inventar uma UI própria.

### 9. Configurar `GEMINI_API_KEY` no ambiente de produção (Fase 7)

Sem essa variável, as 8 funcionalidades de IA generativa (análise de repositório, compatibilidade semântica, trilha personalizada, descrições de portfólio, mentor de carreira, simulador de entrevista, resumo de candidatos, insights de mercado) falham de forma isolada — erro logado no servidor, resposta HTTP 502 — mas o resto da plataforma continua funcionando normalmente.

| Variável | Descrição |
|---|---|
| `GEMINI_API_KEY` | Gerada em [aistudio.google.com/apikey](https://aistudio.google.com/apikey) — nível gratuito |
| `GEMINI_MODEL` | Padrão `gemini-3.6-flash`; ajustável sem alterar código |

Configurar no `.env` local e nas variáveis de ambiente de produção (Clever Cloud).
