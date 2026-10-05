# Diagnóstico — Implementação do Sistema de Roadmap

Investigação de código, sem alterações, em preparação para implementar `docs/roadmap-spec.md`. Branch: `feat/roadmap`.

## ⚠️ Achado crítico antes de tudo: já existe um "roadmap" no código, e é outra coisa

Antes de qualquer item abaixo, o ponto mais importante deste diagnóstico: **o nome `roadmap` já está em uso** para um sistema diferente e mais simples do que o descrito na spec.

| | Roadmap **existente** (hoje) | Roadmap da **spec** (a construir) |
|---|---|---|
| Conceito | Trilha = lista de skills que faltam para UMA vaga específica | Trilha = fases → etapas → projeto prático, gerada por IA a partir de um gap |
| Objetivo | Sempre uma vaga (`/roadmap?job=1`) | Vaga OU área (Front-end/Back-end/Full-stack/Dados) |
| Geração | Determinística: skills da vaga que o usuário não tem, com recursos da tabela `skill_resources`. IA só enriquece com um "motivo" (texto curto) por skill, via `enrichWithAI()` em `services/roadmapGenerator.js` | IA gera a estrutura inteira (fases/etapas/projeto) em JSON; recursos vêm de uma tabela curada nova (`recursos`) |
| Progresso | Por skill: `nao_iniciado/em_progresso/concluido`, tabela `user_roadmap_progress` | Por etapa (`pendente/em_andamento/concluida`) + por fase (projeto verificado) |
| Verificação | Não existe | Fase fecha com projeto no GitHub, verificado via análise de repositório (PRO) |
| Rotas | `GET /roadmap` (página), `GET /api/roadmap/:jobId`, `PATCH /api/roadmap/:jobId/skill/:skillId` | A definir — precisa de rotas para CRUD de `roadmaps`/`roadmap_fases`/`roadmap_etapas` |
| Arquivos | `routes/roadmap.js`, `controllers/roadmapController.js`, `services/roadmapGenerator.js`, `validators/roadmap.validator.js`, `views/roadmap.ejs`, `public/css/roadmap.css`, tabela `user_roadmap_progress` | Nenhum ainda |

Isso significa que a spec não é "construir do zero" — é **decidir o que fazer com o que já existe**: substituir, conviver sob nomes diferentes, ou fundir os dois conceitos (ex.: o roadmap-por-vaga vira o "modo objetivo=vaga" do sistema novo). **Essa decisão não está nas minhas mãos e deveria ser confirmada com você antes da próxima etapa**, porque ela determina:
- Se `/roadmap` (rota, view, CSS, link no header/drawer/bottom-nav — ver seção 9) é reaproveitado ou substituído.
- Se `user_roadmap_progress` (progresso atual, provavelmente com dados reais se o app já tem uso) migra para `roadmap_etapas` ou continua paralela.
- Se `roadmapController.js`/`routes/roadmap.js` crescem ou um módulo novo nasce do lado (ex. `controllers/roadmapTrilhaController.js`, para não misturar os dois domínios num arquivo só).

Todo o restante deste relatório descreve a infraestrutura **genérica** reaproveitável pelos dois cenários (DB, auth, IA, CSS, testes) — a parte específica do roadmap *atual* está marcada onde relevante.

---

## 1. Estrutura de pastas e inicialização (`server.js`)

Padrão MVC simples, sem framework de rotas automáticas:

```
server.js          → monta middlewares, rotas inline (páginas) + rotas modulares (API), start
app.js              → existe na raiz, não lido ainda (ver observação abaixo)
controllers/        → lógica de negócio das rotas de API
routes/             → express.Router() por domínio, montados em server.js
services/           → integrações (IA, GitHub, e-mail) e regras reutilizáveis
middlewares/auth.js → guards de sessão (requireAuth/requireDev/requireCompany/requireAdmin/isAuth/...)
validators/         → express-validator por domínio + handle-validation.js genérico
views/              → EJS, uma página por arquivo + views/partials/ para header/footer
public/css/, public/js/ → um CSS por página + alguns compartilhados (design-system.css, header.css)
database/           → pool de conexão + scripts de migração/seed (ver seção 3)
config/plans.js     → definição estática dos planos Free/PRO
tests/qa/           → um teste por item do backlog de QA (ver CLAUDE.md)
```

**Observação**: existe um `app.js` na raiz (visto no Glob) que eu não li — `package.json` aponta `"main": "server.js"` e `npm start` roda `node server.js`, então `app.js` não parece estar em uso pelo fluxo real. Vale confirmar se é lixo antigo antes de mexer por perto.

**Ordem dos middlewares em `server.js`** (relevante para onde plugar novas rotas):
1. Checagem de `APP_URL` (`process.exit(1)` se faltar — já vivido nesta sessão).
2. `helmet` com CSP customizada (`connectSrc` já libera os domínios de fonte, QA-040).
3. Rate limiters: `authLimiter` (20/15min, só em `/api/auth`) e `aiLimiter` (30/15min, em todo `/api/ai`).
4. `express.static("public")`, `express.json()`.
5. Middleware que força `Cache-Control: no-store` e remove `If-None-Match` em `/api/*` (evita 304 quebrando `res.json()`).
6. Handler de JSON malformado.
7. `express-session` com `MySQLStore` (store = pool do MySQL — sessão e dados vivem no mesmo banco).
8. `exposeUser` (expõe `res.locals.user` sem `accessToken`, para todo EJS).
9. Rotas de página inline (`/`, `/login`, `/vagas`, `/dashboard`, `/roadmap`, etc.) — todas antes das rotas modulares.
10. Rotas modulares (`app.use("/api/...", ...)`), incluindo `app.use("/api", roadmapRoutes)` **sem prefixo de domínio** — por isso o roadmap atual expõe `/api/jobs`, `/api/vagas/:id`, `/api/roadmap/:jobId`, `/api/dashboard` todos "soltos" em `/api`, não em `/api/roadmap/...`. Isso é algo a decidir para as rotas novas: seguir esse padrão plano ou criar um prefixo próprio (`/api/trilhas`, por exemplo) para não colidir.
11. 404 e 500 handlers por último.
12. Start só depois de `db.ready` resolver (migrações automáticas já têm que ter rodado).

## 2. Rotas e organização

Dois níveis, sem convenção rígida de REST:
- **Rotas de página** (renderizam EJS): ficam direto em `server.js`, cada uma faz sua própria query simples antes de `res.render(...)`, com `try/catch` silencioso (`catch (_) {}`) quando o dado é só enriquecimento (ex. contadores da home).
- **Rotas de API** (JSON): um arquivo em `routes/` por domínio, que delega para um `controllers/*Controller.js` (objeto com métodos async). Validação de entrada via `express-validator`, com um helper comum `validators/handle-validation.js` chamado como middleware no fim da cadeia.

Para a feature nova, o padrão natural seria: `routes/roadmap.js` (ou um novo arquivo, dependendo da decisão da seção anterior) + `controllers/roadmapController.js` (ou novo) + `validators/roadmap.validator.js` (estender ou criar `trilha.validator.js`).

## 3. Conexão MySQL e migrações

`database/db.js` cria um **pool único** (`mysql2/promise`, `connectionLimit: 5`) exportado como singleton (`module.exports = pool`) — todo `require("../database/db")` em controllers/services usa essa mesma instância.

**Não existe uma ferramenta de migração** (nenhum Knex/Sequelize/Prisma/migrate-mysql). O padrão do projeto é:
- `testarConexao()` (chamada automaticamente ao importar `db.js`, exposta como `pool.ready`) roda, depois de conectar, uma sequência de `CREATE TABLE IF NOT EXISTS` + chamadas aos helpers `addColumn`/`addUniqueKey`/`addEnumValue` (idempotentes, checam `INFORMATION_SCHEMA` antes de alterar). **Isso roda a cada boot do servidor**, em produção inclusive — é a "migração automática" mencionada no comentário sobre a janela de 500 entre deploy e migração.
- Além disso há 3 scripts standalone em `database/` (`migration.js`, `migration-avatar.js`, `migration-jobs-v2.js`) e `config/migration_v2.sql`/`config/migration_repos.sql` — rodados manualmente uma vez (`node database/migration.js`), não fazem parte do boot.
- `database/seed.js` cria o schema base inteiro (users, jobs, skills, etc.) e popula dados iniciais — é o "ponto zero" do banco, não algo que roda em todo boot.

**Para o roadmap novo**: o caminho natural e já estabelecido é adicionar os `CREATE TABLE IF NOT EXISTS` das 5 tabelas novas (`roadmaps`, `roadmap_fases`, `roadmap_etapas`, `recursos`, `recursos_pendentes`) dentro de `testarConexao()` em `database/db.js`, seguindo exatamente o padro dos blocos já lá (ex. o de `mercado_insights`, mais recente). Não há "arquivo de migração versionado" — é tudo nesse único lugar, em ordem cronológica por comentário de seção.

## 4. Tabelas existentes relevantes

### `users` (base de toda conta)
```sql
id INT PK, email VARCHAR(255) UNIQUE, password_hash VARCHAR(255),
type ENUM('dev','empresa','admin'),  -- 'admin' adicionado via addEnumValue
active TINYINT(1) DEFAULT 1,         -- adicionado depois (suspensão de conta)
created_at TIMESTAMP
```

### `user_dev_profiles`
```sql
id INT PK, user_id INT UNIQUE FK→users,
nome, sobrenome VARCHAR(100), github_login VARCHAR(100),
nivel ENUM('iniciante','intermediario','avancado'),
github_id BIGINT UNIQUE,             -- addColumn posterior
avatar_url VARCHAR(500)              -- addColumn posterior
```
Nota: **`req.session.user.nivel` é o nível do dev** (não confundir com `level` da vaga, que é estágio/júnior/pleno). O id "canônico" de um dev em várias tabelas de domínio (skills, roadmap, matches) é o `github_id`, não o `users.id` — ver `getUserId(req)` repetido em vários controllers (`req.session.user.github_id ?? req.session.user.id`, fallback para quem não conectou GitHub).

### `jobs` (vaga)
```sql
id INT PK, title VARCHAR(200), company VARCHAR(100), description TEXT,
level ENUM('estagio','junior','pleno') DEFAULT 'estagio',
company_id INT FK→users (null = vaga antiga sem dono),  -- migration.js
active BOOLEAN DEFAULT true,
created_at TIMESTAMP
```
`validators/job.validator.js` hoje só valida `title`/`level`/`description` — os demais campos (modality, contract_type, salary etc., se existirem na v2) foram cobertos no QA-010.

### `perfil_tecnico_ia` (entrada "Perfil técnico" da spec)
```sql
id INT PK, user_id INT UNIQUE FK→users,
proficiencia_estimada VARCHAR(50),   -- 'iniciante'|'intermediario'|'avancado', como texto livre
boas_praticas TEXT,                  -- array JSON serializado (JSON.stringify/.parse manual)
pontos_melhoria TEXT,                -- idem
created_at, updated_at TIMESTAMP
```
Gerado por `services/aiProfileAnalyzer.js::analyzeUserProfile()` — cacheado, só reprocessa com `?reanalisar=1`. **Não tem lista estruturada de skills/níveis** (é texto livre em `boas_praticas`/`pontos_melhoria`) — a spec pede "habilidades que já usa e o nível de cada uma" como estrutura, o que é mais parecido com a tabela `user_skills` (ver abaixo) do que com `perfil_tecnico_ia`. Provavelmente o gap da spec precisa combinar as duas fontes: `user_skills` (estruturada, por `github_id`+`skill_id`+`confidence`) para o "o que sabe", e `perfil_tecnico_ia` só como contexto qualitativo adicional.

### `user_skills` (skills detectadas, estruturadas)
```sql
id INT PK, github_id BIGINT, skill_id INT FK→skills,
source ENUM('github','manual'), confidence INT (0-100),
UNIQUE(github_id, skill_id)
```

### Planos (`config/plans.js` + `user_subscriptions`)
Não há tabela `planos` — é um objeto estático em código (`PLANS`), chaveado por `plan_code`. A tabela de banco é `user_subscriptions`:
```sql
id INT PK, user_id INT UNIQUE FK→users, plan_code VARCHAR(30),
status ENUM('active','canceled') DEFAULT 'active',
current_period_end DATETIME, payment_provider, payment_customer_id, payment_subscription_id,
created_at TIMESTAMP
```
Os 2 planos dev são `dev_free`/`dev_pro`, cada um com um objeto `features: { roadmap_personalizado, destaque_perfil, mentor_carreira, simulador_entrevista }` (booleans). **Não há compra/checkout real** — "upgrade" hoje é manual via admin (`setUserPlan()`).

## 5. Plano na sessão e bloqueio por feature

O plano **não fica na sessão** — `req.session.user` não tem campo de plano. Toda checagem passa por `services/subscriptionService.js`, que consulta `user_subscriptions` no banco a cada chamada (`getUserPlan(userId, type)`), com fallback para o plano free do tipo se não houver assinatura ativa. Isso é "a única fonte de verdade", conforme o próprio comentário do arquivo.

Dois padrões de bloqueio já existem:
- **`hasFeature(userId, featureKey)`** → usado como middleware-fábrica `requireFeature(featureKey, mensagem)` em `routes/ai.js`, retorna **402** (não 403) com uma mensagem amigável quando bloqueado — e `routes/ai.js` também aplica `requireDevType` antes, por causa do QA-006 (empresa não deveria nem chegar a essa checagem).
- **`canCreateJob(companyId)`** → mesmo princípio para o limite de vagas ativas da empresa.

Para o roadmap novo (limites de "roadmaps ativos" e "regenerações por período"), o padrão a seguir é claramente esse: uma função nova em `subscriptionService.js` (ex. `canCreateRoadmap(userId)`, `canRegenerateRoadmap(userId, roadmapId)`) consultando a contagem relevante, chamada como guard explícito no controller — **não** indo por `hasFeature` sozinho, porque o limite é numérico (1 vs 5, 1/mês vs 1/semana), não um boolean. A tabela `roadmaps` da spec (`status`, `versao`) dá a base pra essa contagem; falta decidir onde registrar "quando foi a última regeneração" (campo novo em `roadmaps`, ex. `regenerado_em`, ou derivar de `versao` + `gerado_em`).

## 6. Como as chamadas de IA são feitas hoje

Dois clientes coexistem, com fallback entre eles:

- **`services/geminiClient.js`** — client único e oficial (`@google/genai`, Interactions API, não `generateContent` — ver comentário detalhado no arquivo sobre por quê). Expõe `askGeminiJSON({system, prompt, maxTokens, responseSchema})` (pergunta isolada, retorna JSON parseado) e `chatTurn`/`sendFunctionResults` (conversa com memória + function calling, usado só pelo mentor). Variáveis de ambiente: `GEMINI_API_KEY` (obrigatória, lança erro se faltar) e `GEMINI_MODEL` (default `gemini-3.6-flash`).
- **`services/aiFallback.js`** — não lido em detalhe nesta investigação, mas é chamado automaticamente de dentro de `askGeminiJSON` quando o Gemini falha (cota, 5xx, timeout de 15s). Multi-provedor gratuito (Groq/Cerebras/Mistral/OpenRouter, formato OpenAI). Resultado marcado com `__provider`/`__model` quando veio do fallback.

Todo serviço de IA do projeto (`aiProfileAnalyzer`, `roadmapGenerator`, `mentorChat`, `interviewSimulator`, `marketInsights`, `candidateSummarizer`, `portfolioDescriber`) passa por `geminiClient.js` — **nenhum chama a API externa direto**. Para a geração de roadmap da spec (JSON estruturado, fases/etapas/projeto), `askGeminiJSON` com um `responseSchema` é exatamente o mecanismo certo — já suporta schema opcional, e o padrão "valida → se inválido, repete uma vez → se falhar de novo, cai pro modelo estático" da spec é um comportamento novo a implementar no service, não algo que `askGeminiJSON` já faz (ele só tenta Gemini → fallback multi-provedor, não valida o *schema de negócio* da resposta).

`routes/ai.js` é o único lugar com rate limit de IA (`aiLimiter`, 30/15min, aplicado a `app.use("/api/ai", aiLimiter, aiRoutes)` em `server.js`) — rotas de roadmap fora de `/api/ai` não têm esse limite hoje (o roadmap atual, em `/api`, não passa por `aiLimiter`). Vale decidir se a geração de roadmap da spec deveria morar sob `/api/ai/...` por causa desse rate limit (faz sentido, já que vai chamar IA de verdade, diferente do enriquecimento opcional de hoje).

## 7. Análise de repositório do GitHub

`services/githubAnalyzer.js::matchSkillsFromGitHub(accessToken, githubId, repos)` é a função reaproveitável para a "verificação de projeto" da spec (seção "Progresso e verificação" → PRO). Hoje ela:
1. Busca linguagens (`GET /repos/{full_name}/languages`) e README (`GET /repos/{full_name}/readme`) de cada repo, em lotes de 5.
2. Para cada skill do catálogo com `github_signals` preenchido (lista de palavras-chave), soma confiança: +40 se a palavra aparece como linguagem do repo, +20 se aparece no README.
3. Grava em `user_skills` via `INSERT ... ON DUPLICATE KEY UPDATE`.

Para "a fase X confere se as habilidades da fase aparecem no código" (spec), o reaproveitamento não é 1:1: `matchSkillsFromGitHub` analisa **todos os repos importados do perfil**, não um repositório específico informado pelo usuário (`projeto_repo_url` da fase). Vai precisar de uma variante que recebe **um `repo_full_name` só** e as skills-alvo da fase, reaproveitando `fetchRepoLanguages`/`fetchRepoReadme` (já exportadas) e a lógica de scoring, mas não a função inteira como está. Também falta tratar "repositório privado ou link inválido" (caso-limite da spec) — hoje as duas funções engolem erro e retornam `[]`/`""` silenciosamente (`catch { return [] }`), o que seria indistinguível de "repo público sem nada relevante" — precisa diferenciar esses casos pra dar o feedback certo ao usuário.

`services/aiProfileAnalyzer.js` é o outro ponto de "análise de repositório", mas é qualitativo (IA opina sobre boas práticas/pontos de melhoria) e cacheado em `perfil_tecnico_ia` — não teria papel direto na verificação pass/fail de uma fase, mas poderia alimentar o "perfil técnico atualizado" mencionado quando uma fase é aprovada.

## 8. Página/rota de roadmap existente

Coberto em detalhe na seção "Achado crítico" no topo. Resumo rápido: `GET /roadmap` (requer `requireDev`) renderiza `views/roadmap.ejs`, que lê `?job=` da query string, busca `/api/roadmap/:jobId` e `/api/vagas/:jobId`, e renderiza duas listas (já sabe / precisa aprender) com barra de match. Progresso por skill vem de `PATCH /api/roadmap/:jobId/skill/:skillId`.

Também existe `GET /meu-progresso` → `views/progresso.ejs`, que lista **todos os roadmaps** (um por vaga com progresso salvo) via `GET /api/dashboard` (`roadmapController.getDashboard`) — é a tela de "overview", enquanto `/roadmap?job=X` é o detalhe de um. Isso é relevante porque a spec também fala em listar múltiplos roadmaps (até 5 no PRO) — `progresso.ejs` já tem boa parte do padrão visual de "lista de cards com barra de progresso" que serviria de referência direta para uma tela equivalente do sistema novo.

## 9. Layout EJS, CSS e padrão visual

- **Partials de header**: um por tipo de conta — `partials/header-dev.ejs`, `header-company.ejs`, `header-admin.ejs` (+ `header.ejs` para visitante). Cada um recebe `currentPage` (via local passado no `res.render(...)`) para marcar o item ativo (`is-active`/`aria-current`) em três lugares redundantes: nav desktop, drawer mobile, bottom-nav mobile (pill). **Qualquer página nova precisa lembrar de marcar `currentPage` nos três lugares** — são links hardcoded no partial, não uma lista iterada, então uma página de roadmap novo exigiria editar `header-dev.ejs` (e possivelmente `header-company.ejs`, se empresa também acessa) pra adicionar o item de menu, não é automático.
- **CSS**: um arquivo por página (`public/css/<page>.css`) + compartilhados `design-system.css` (tokens: cores, radius, fontes — ver tokens abaixo) e `header.css`/`dev.css` (layout base da área logada). Toda página do dev carrega `design-system.css` + `header.css` + `dev.css` + seu CSS próprio, nessa ordem.
- **Tokens de cor relevantes** (`design-system.css`): `--accent` (#7C3AED, roxo — marca), `--accent-text` (#A78BFA, criado no QA-034 pra contraste AA em texto sobre `--accent-dim`), `--teal` (#59E435, verde — "sucesso/concluído"), `--blue` (#60a5fa), `--yellow` (#fbbf24). `--radius-sm/md/lg/xl` para arredondamento. O padrão de badge (`badge-green`/`badge-blue`/`badge-yellow`/`badge-muted`) e de card com "stripe" lateral colorida (visto em `progresso.ejs`, `.card-stripe`) é o vocabulário visual a seguir para os novos cards de fase/roadmap.
- **Padrão de card**: `progresso.ejs` é a melhor referência pronta — card com stripe lateral por status, badges de nível/status, barra de progresso animada (`role="progressbar"` com `aria-valuenow` + preenchimento via width em JS), ícones SVG inline reaproveitáveis (objeto `IC` no `<script>`).
- **Segurança**: toda renderização de texto vindo do banco em `innerHTML` usa `escapeHtml()` de `/js/escape-html.js` (pós-QA-001/002) — qualquer view nova que gere HTML client-side a partir de dados de skills/recursos/vagas precisa importar esse script e usá-lo, sem exceção.
- **Acessibilidade estabelecida**: `id="main-content"` no `<main>` (skip-link aponta pra ele, QA-036), `role="progressbar"` sempre com `aria-label` (QA-038), estado vazio como elemento **irmão** da lista com `role` próprio, nunca filho de `role="list"` (QA-033) — relevante porque a spec vai ter várias listas (fases, etapas, recursos) que provavelmente vão repetir esse padrão de estado vazio.

## 10. Testes

- **Runner**: Jest (`npm test` = `jest --passWithNoTests`), sem `jest.config.js` — usa defaults (`testEnvironment: "node"`). `supertest` está instalado mas não vi uso em nenhum teste lido; os testes QA que inspecionei são **testes de código-fonte** (leem o `.ejs`/`.js` como texto e fazem asserções via regex/string, não testes de integração rodando o servidor) — justificado explicitamente nos comentários como contorno à falta de `jest-environment-jsdom` e de um banco MySQL disponível em CI/dev.
- Também existem `@playwright/test` + `@axe-core/playwright` nos devDependencies — usados (conforme o texto dos achados QA-032 a QA-041) para verificação manual/pontual com navegador real durante as correções, não como suíte automatizada rodando em `npm test`.
- Convenção de nome: `tests/qa/QA-XXX.test.js`, um arquivo por achado do backlog, cada um com um comentário de cabeçalho explicando o bug e por que o teste é feito do jeito que é.
- Para o roadmap novo, dado que não há banco de teste nem jsdom configurados, a geração/validação de JSON da IA (`generateRoadmap`, a validação de schema, o fallback pro roadmap-modelo) é testável de forma real com Jest puro (funções de serviço, mockando `geminiClient`) — já a parte de UI (EJS/JS client-side) provavelmente vai seguir o mesmo padrão de inspeção de código-fonte usado nos QA-*.

---

## Riscos de quebrar algo existente

1. **Colisão de nome/rota `/roadmap`** (seção 1, já destacada) — o maior risco. Decisão de produto necessária antes de codar.
2. **`routes/roadmap.js` está montado sem prefixo** (`app.use("/api", roadmapRoutes)`) — rotas novas nesse mesmo router herdam esse espaço de nomes plano; fácil colidir com outra rota `/api/*` já existente em outro arquivo se não for cuidadoso.
3. **Migração automática roda em todo boot** — qualquer erro de sintaxe num `CREATE TABLE`/`ALTER` novo em `db.js` quebra a inicialização do servidor inteiro (os helpers não isolam falhas por bloco de forma independente — há um único `try/catch` ao redor de toda a sequência de migração em `testarConexao()`, então um erro no meio impede os blocos seguintes de rodar, embora não derrube o processo graças ao catch externo).
4. **`hasFeature`/`getUserPlan` sempre consulta `type="dev"` fixo** (`subscriptionService.js:37`) — se o roadmap novo precisar checar plano de empresa por algum motivo futuro, essa função não serve como está.
5. **IA sem limite de custo fora de `/api/ai`** — `aiLimiter` só se aplica a rotas montadas sob `/api/ai`; se a geração de roadmap ficar em `routes/roadmap.js` (montado em `/api`, não `/api/ai`), chamadas de IA caras ficariam sem esse rate limit, repetindo o padrão de risco do QA-005.
6. **`user_roadmap_progress` pode ter dados reais de usuários atuais** — se a decisão for migrar/substituir o roadmap atual, qualquer `DROP`/rename de tabela precisa de plano de migração de dados, não só de schema (o backup via `mysqldump` pedido no início desta sessão ficou pendente por falta do client local — recomendo resolver isso antes de qualquer mudança destrutiva em tabela).
7. **Três arquivos de migração standalone não rodam automaticamente** (`migration.js`, `migration-avatar.js`, `migration-jobs-v2.js`) — se alguma coluna que o roadmap novo depende foi adicionada por um desses scripts (não por `db.js`), um ambiente novo (ex. ambiente de CI, ou outro dev) pode não ter essa coluna a menos que rode o script manualmente. Vale confirmar se `jobs` já tem todas as colunas que a spec presume (ex. os campos usados pelos "requisitos da vaga").

## Recomendação de onde colocar cada arquivo novo

Assumindo a decisão de **não colidir** com o roadmap atual (ex.: manter `/roadmap` como está e dar um nome novo à trilha da spec — ex. `/trilha`, `/meu-roadmap`, ou absorver sob um /roadmap/v2 — isso precisa ser decidido com você):

| Camada | Arquivo sugerido | Padrão a seguir |
|---|---|---|
| Schema | Blocos novos dentro de `database/db.js::testarConexao()` | `CREATE TABLE IF NOT EXISTS` + `addColumn` idempotente, uma seção por tabela, comentada como as existentes |
| Rotas | `routes/trilha.js` (novo arquivo, não reaproveitar `routes/roadmap.js`) | Router + `isAuth`/`requireDevType` conforme o caso, montado em `server.js` — considerar `/api/trilha/...` com prefixo próprio em vez do padrão plano de `/api` |
| Controller | `controllers/trilhaController.js` | Objeto com métodos async, mesmo formato de try/catch + `console.error` + mensagens em pt-BR já usado em todos os outros |
| Geração IA | `services/trilhaGenerator.js` (novo, não misturar com `roadmapGenerator.js` atual) | `askGeminiJSON` com `responseSchema`, usando `geminiClient.js` como hoje; implementar a lógica de "valida → regenera 1x → cai pro modelo estático" aqui, já que `geminiClient.js` não faz validação de schema de negócio |
| Verificação de projeto | Função nova em `services/githubAnalyzer.js` (ex. `verifyPhaseProject(accessToken, repoFullName, targetSkills)`) reaproveitando `fetchRepoLanguages`/`fetchRepoReadme` já exportadas | Não reescrever do zero a chamada à API do GitHub |
| Limites de plano | Funções novas em `services/subscriptionService.js` (ex. `canCreateRoadmap`, `canRegenerateRoadmap`) | Mesmo princípio de `canCreateJob` — consulta direta, sem guardar estado na sessão |
| Validação de entrada | `validators/trilha.validator.js` | Mesmo padrão de `roadmap.validator.js`/`job.validator.js` (express-validator + `handleValidation`) |
| Views | `views/trilha.ejs` (geração/detalhe) + reaproveitar o padrão de `progresso.ejs` para a listagem de múltiplos roadmaps | Mesmo cabeçalho `<head>` (design-system + header + dev.css + CSS próprio), `id="main-content"`, `escapeHtml()` em tudo que for `innerHTML` |
| CSS | `public/css/trilha.css` | Reaproveitar tokens existentes (`--accent`, `--teal`, `--accent-text`), padrão de card com stripe de `progresso.css` |
| Header/navegação | Editar `header-dev.ejs` (3 pontos: nav desktop, drawer, bottom-nav) | Replicar o bloco de "Roadmap"/"Progresso" já existente |
| Testes | `tests/trilha/*.test.js` (ou dentro de `tests/qa/` se preferir manter tudo num lugar só) | Jest puro para `trilhaGenerator`/`subscriptionService` (mockando `geminiClient`); inspeção de código-fonte para o client-side, como os QA-* |

**Antes da próxima etapa**, a decisão que mais influencia tudo acima: **o que fazer com o roadmap atual (`/roadmap`, `user_roadmap_progress`, `roadmapController.js`)** — conviver, substituir ou fundir. Recomendo alinhar isso antes de eu gerar o prompt de implementação para o Claude Code mencionado no fim da spec.
