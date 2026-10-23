# Inventário — análise de perfil, compatibilidade, autodiagnóstico e verificação de projetos

Levantamento somente leitura (nenhum arquivo de código foi alterado). Cobre quatro áreas:

1. Análise de repositórios do GitHub → perfil técnico
2. Cálculo de compatibilidade perfil × vaga
3. Autodiagnóstico
4. Verificação de projetos das fases do roadmap

> **Estado do repositório na data do levantamento (2026-10-21).** Existem alterações **não commitadas** na árvore de trabalho que afetam este inventário:
> - `services/aiProfileAnalyzer.js` foi **removido** (análise de repositório por IA) e a rota `GET /api/ai/perfil-tecnico` foi retirada de `routes/ai.js`. A seção da página `/repositorios` ("Análise de perfil técnico") e seu JS/CSS também saíram. O arquivo ainda existe em `HEAD` (último commit que o tocou: `2fecb2a`). Ele aparece abaixo marcado como **[removido — não commitado]**.
> - `controllers/trilhaController.js` passou a decidir o aviso "sem perfil técnico" por `user_skills` (via `temSkillsDetectadas`), não mais por `perfil_tecnico_ia`.
>
> Onde o texto diz "hoje", refere-se à árvore de trabalho atual.

---

## 0. Visão geral — como as quatro áreas se conectam

```
GitHub (OAuth + REST)
   │
   ├─ login / "Reanalisar" ──► githubAnalyzer.matchSkillsFromGitHub ──► user_skills (github_id, skill_id, confidence)
   │                                   ▲ usa skills.github_signals
   │
   ├─ perfil-dev.ejs ──► POST /api/user/skills ──► user_skills (source='manual', confidence 70)      ← "autodiagnóstico" (parcial)
   │                 └─► PATCH /api/user/profile ──► user_dev_profiles.nivel (auto-declarado)
   │
   user_skills + user_dev_profiles.nivel
        │
        ├─► matchCalculator (computeMatch / calculateJobMatch) ──► % de compatibilidade (dev, empresa, admin, IA)
        ├─► roadmapService.montarGap (gap por habilidade) ──► gerarRoadmap (IA/modelo) ──► roadmaps/fases/etapas
        └─► userContextService / aiTools / candidateSummarizer ──► contexto de IA (mentor, entrevista, resumo)

roadmap_fases (projeto) + roadmap_etapas.habilidade + skills.github_signals
        └─► roadmapService.verificarProjeto ──► githubAnalyzer.verificarRepoPublico / verificarHabilidadesNoRepo
```

Duas ideias estruturam tudo:

- **Fonte única de "o que o dev sabe":** `user_skills` (`github_id`, `skill_id`, `confidence` 0–100, `source` `github|manual`). É alimentada pelo algoritmo de sinais (fórmula `+40 linguagem / +20 README`) e por skills manuais (confiança fixa 70).
- **Nível do dev (`nivel`) é auto-declarado**, não calculado: vem de `user_dev_profiles.nivel` (padrão `iniciante`, editável em `/perfil`).

---

## 1. Análise de repositórios do GitHub → perfil técnico

### 1.1 Arquivos

| Tipo | Arquivo | Papel |
| --- | --- | --- |
| Service | `services/githubAnalyzer.js` | Algoritmo de detecção de skills (`matchSkillsFromGitHub`) e helpers de API (`fetchRepoLanguages`, `fetchRepoReadme`) |
| Service | `services/aiProfileAnalyzer.js` **[removido — não commitado]** | Análise qualitativa por IA (proficiência, boas práticas, pontos de melhoria) → `perfil_tecnico_ia` |
| Service | `services/portfolioDescriber.js` | Descrição de portfólio por IA a partir do README (`ai_description`). **Não é análise de perfil**, mas lê README do repo |
| Service | `services/userContextService.js` | Lê `user_skills`/`user_repositories`/`nivel` e monta contexto para a IA (mentor) |
| Service | `services/candidateSummarizer.js` | Resumo IA de candidato (lê `user_skills` + repos públicos) |
| Controller | `controllers/authController.js` | Dispara a análise no login OAuth (fire-and-forget); cria `user_dev_profiles` |
| Controller | `controllers/profileController.js` | `getProfile` (lista skills), `reanalyze`, `addSkill`, `removeSkill`, `getSkillsCatalog`, `updateProfile` (nivel) |
| Controller | `controllers/adminController.js` | CRUD de skills, incluindo `github_signals` (linhas ~316–360) |
| Route | `routes/profile.js` | `/api/user/profile`, `/reanalyze`, `/skills`, `/skills/:skillId`, `/skills/catalog` |
| Route | `routes/repositorios.js` | `/api/user/repos` (CRUD de repositórios exibidos no perfil), `/repos/github` (lista do GitHub), `/repos/:id/gerar-descricao` |
| Route | `routes/ai.js` | `GET /api/ai/perfil-tecnico` **[removido — não commitado]** |
| Route | `routes/auth.js` | `/auth/github` e callback OAuth |
| View | `views/repositorios.ejs` | Importar/gerenciar repositórios (a seção de análise por IA foi removida) |
| View | `views/perfil-dev.ejs` | Skills detectadas/manuais, botão "Reanalisar" (`#btn-reanalyze` → `POST /api/user/reanalyze`), seletor `nivel` |
| View | `views/admin-configuracoes.ejs` | Edição de `github_signals` por skill (campo `f-signals`) |
| View | `views/roadmap/novo.ejs` | Aviso "sem perfil técnico" (usa `temPerfilTecnico`) |
| Seed | `database/seed-skills.js`, `database/seed.js` | Catálogo inicial de skills **com `github_signals`** (61 entradas em `seed-skills.js`) |
| Config/SQL | `config/script_bd.sql`, `database/db.js` | Definição das tabelas |

### 1.2 Funções

| Função | Arquivo | O que faz |
| --- | --- | --- |
| `matchSkillsFromGitHub(accessToken, githubId, repos)` | `githubAnalyzer.js:45` | Carrega skills com `github_signals`, busca linguagens + README de cada repo (lotes de 5), calcula `confidence` por skill e faz `INSERT … ON DUPLICATE KEY UPDATE confidence` em `user_skills` (source `github`). Retorna as skills detectadas |
| `fetchRepoLanguages(token, fullName)` | `githubAnalyzer.js:12` | `GET /repos/{r}/languages` → nomes em minúsculo. Erro → `[]` |
| `fetchRepoReadme(token, fullName)` | `githubAnalyzer.js:29` | `GET /repos/{r}/readme` (raw) → minúsculo. Erro → `""` |
| `authController` (callback OAuth) | `authController.js:58–70` | Busca `/user` e `/user/repos?sort=updated&per_page=30`; chama `matchSkillsFromGitHub(...).catch(log)` sem bloquear o login |
| `profileController.reanalyze` | `profileController.js:~214` | `/user/repos?sort=updated&per_page=50` + `matchSkillsFromGitHub`; usa `github_id ?? user.id` |
| `profileController.addSkill` / `removeSkill` | `profileController.js:~248/267` | `INSERT … source='manual', confidence 70` (`GREATEST`) / `DELETE … source='manual'` |
| `profileController.getProfile` | `profileController.js:~60` | Junta `user_skills` + `skills` ordenado por `confidence` |
| `getSkillsSummary`, `getReposSummary`, `getNivel` | `userContextService.js` | Contexto para IA (limites `MAX_SKILLS=20`, `MAX_REPOS=10`) |
| `analyzeUserProfile`, `getCachedProfile`, `buildRepoPayload` | `aiProfileAnalyzer.js` **[removido]** | Eram o caminho IA → `perfil_tecnico_ia` |

### 1.3 Banco de dados

| Tabela | Colunas relevantes | Uso |
| --- | --- | --- |
| `skills` | `id`, `name`, `type` (`hard`/`soft`), `category`, **`github_signals`** (TEXT, palavras-chave separadas por vírgula) | Catálogo + sinais de detecção |
| `user_skills` | `github_id` (BIGINT), `skill_id`, `source` (`github`/`manual`), `confidence` (INT 0–100); UNIQUE `(github_id, skill_id)` | Resultado do algoritmo e skills manuais |
| `user_dev_profiles` | `user_id`, `github_id` (UNIQUE), `github_login`, `nivel` (`iniciante`/`intermediario`/`avancado`), `avatar_url`, `nome`, `sobrenome` | Ponte `user_id` ↔ `github_id`; nível auto-declarado |
| `user_repositories` | `user_id`, `repo_name`, `repo_full_name`, `description`, `is_private`, `language`, `stars`, `updated_at_gh`, `is_public`, `ai_description`; UNIQUE `(user_id, repo_full_name)` | Repositórios que o dev escolheu exibir. **O algoritmo de skills NÃO lê esta tabela** — usa direto a lista do GitHub (`/user/repos`) |
| `perfil_tecnico_ia` | `user_id` (UNIQUE), `proficiencia_estimada`, `boas_praticas` (JSON em TEXT), `pontos_melhoria` (JSON em TEXT), `created_at`, `updated_at` | Antes: saída da IA. **Hoje só é escrita por `registrarProjetoVerificadoNoPerfil`** (ver seção 4) e não é lida por nenhum fluxo ativo |

### 1.4 Dados / configuração

| Arquivo | Conteúdo |
| --- | --- |
| `database/seed-skills.js` | Lista de skills com `github_signals` (ex.: `Node.js → javascript,nodejs,node`; `Python → python,py`; `React → react,reactjs,jsx,tsx`) |
| `skills.github_signals` (banco) | Fonte efetiva dos sinais em runtime; editável pelo admin |
| **Pesos/limiares (hardcoded em `githubAnalyzer.js`)** | `+40` se o sinal está entre as linguagens do repo; `+20` se o sinal aparece no README; soma por **sinal × repositório**; teto `100`; só grava se `> 0`; lote de 5 repos |
| Pesos de skill manual (hardcoded em `profileController.addSkill`) | `confidence = 70` (e `GREATEST` com valor existente) |

### 1.5 APIs externas

| API | Chamada | Onde |
| --- | --- | --- |
| GitHub OAuth | `https://github.com/login/oauth/authorize`, `…/access_token` | `authController.js:17,38` |
| GitHub REST | `GET /user`, `GET /user/repos?sort=updated&per_page=30` (login) / `=50` (reanalisar) / `GET /user/repos` (lista para importar) | `authController.js`, `profileController.js`, `routes/repositorios.js:30` |
| GitHub REST | `GET /repos/{r}/languages`, `GET /repos/{r}/readme` (`Accept: application/vnd.github.raw`) | `githubAnalyzer.js` |
| Gemini / fallback multi-provedor | `askGeminiJSON` (`services/geminiClient.js`, modelo `GEMINI_MODEL` padrão `gemini-3.6-flash`) → `aiFallback.js` (groq, cerebras, mistral, openrouter) | Apenas no caminho **removido** (`aiProfileAnalyzer`) e em `portfolioDescriber` |

Autenticação: `Authorization: Bearer <accessToken>` com o token da sessão (`req.session.user.accessToken`), nunca persistido em banco.

### 1.6 Testes

Não há teste unitário dedicado a `matchSkillsFromGitHub`/`githubAnalyzer`. Cobertura indireta:

- `tests/verificarProjeto.test.js` — **mocka** `services/githubAnalyzer` (não testa a fórmula).
- `tests/userContextService.test.js` — contexto de IA (`buildUserContextBlock`).
- `tests/bug-perfil-dev-catalog-shape.test.js` — `perfil-dev.ejs` com a resposta paginada de `/api/user/skills/catalog`.
- `tests/qa/QA-006.test.js` — mockava `aiProfileAnalyzer` (mock removido junto com o módulo).

---

## 2. Compatibilidade perfil × vaga

### 2.1 Arquivos

| Tipo | Arquivo | Papel |
| --- | --- | --- |
| Service | `services/matchCalculator.js` | **Núcleo**: `computeSkillsScore`, `computeSeniorityScore`, `computeMatch` (puros) + `calculateJobMatch` (com banco) + `getMatchExplanation` (IA, cacheada) |
| Service | `services/aiTools.js` | Ferramenta `analisarCompatibilidadeVaga` (mentor) → `calculateJobMatch` |
| Service | `services/roadmapGenerator.js` | Roadmap **antigo** por vaga (`generateRoadmap`) → `calculateJobMatch` |
| Controller | `controllers/roadmapController.js` | `getPublicJob` (match + `matchProjetado`), `getRoadmap`, `updateSkillStatus`, `calcularMatchProjetadoComRoadmap` |
| Controller | `controllers/empresaController.js` | `getMatchs` (~316), `getDesenvolvedores` (~453), `getDevProfile` (~523) → `computeMatch` |
| Controller | `controllers/adminController.js` | Relatório de matchs (~245) → `computeMatch` |
| Route | `routes/roadmap.js` | `GET /api/vagas/:id`, `GET /api/roadmap/:jobId`, `PATCH /api/roadmap/:jobId/skill/:skillId` |
| Route | `routes/ai.js` | `GET /api/ai/jobs/:id/match-explicacao` |
| Route | `routes/empresa.js` | `GET /api/empresa/matchs`, `PATCH /matchs/:devGithubId/:jobId`, desenvolvedores |
| View | `views/vaga-publica.ejs` | `renderMatch(match, isLoggedIn, matchProjetado)`; chama `/api/ai/jobs/:id/match-explicacao` |
| View | `views/roadmap.ejs` | Roadmap antigo por vaga (match + breakdown) |
| View | `views/empresa-matchs.ejs`, `empresa-desenvolvedores.ejs`, `perfil-dev-empresa.ejs`, `admin-matchs.ejs` | Exibição do match no lado da empresa/admin |

### 2.2 Funções e fórmula

| Função | Arquivo:linha | Resumo |
| --- | --- | --- |
| `computeSkillsScore(userSkillMap, jobSkills)` | `matchCalculator.js:34` | Média ponderada de `confidence/100`; peso `2` para `obrigatoria`, `1` para `desejavel`; sem skills na vaga → `100` |
| `computeSeniorityScore(nivel, jobLevel)` | `matchCalculator.js:48` | `diff = rank(vaga) − rank(dev)`; `diff ≤ 0 → 100`, `1 → 55`, `≥2 → 10`; nível/vaga desconhecidos → `100` |
| `computeMatch(userSkillMap, jobSkills, nivel, jobLevel)` | `matchCalculator.js:57` | `round(skills×0.85 + senioridade×0.15)`, teto 100; sem `nivel` → senioridade 100 |
| `calculateJobMatch(skillsId, jobId, profileData)` | `matchCalculator.js:63` | Lê `job_skills` e `user_skills`; aplica `habilidadesAdquiridas` (projeção → confiança 100); devolve `{ match, breakdown[], readyFor, scores{skills,seniority} }` |
| `getMatchExplanation(githubId, jobId, profileData)` | `matchCalculator.js:146` | Lê/grava `match_ia_cache`; chama IA só para **explicar** (o % numérico continua vindo de `calculateJobMatch`) |
| `calcularMatchProjetadoComRoadmap` | `roadmapController.js:~20` | Se há roadmap ativo para a vaga, refaz o match com as habilidades das etapas como adquiridas |
| `confidenceToNivel` | `roadmapService.js:104` | Converte confiança em nível (ver 3 e 4) |

### 2.3 Banco de dados

| Tabela | Colunas | Uso |
| --- | --- | --- |
| `jobs` | `level` (`estagio`/`junior`/`pleno`), `active`, demais campos de vaga | Senioridade da vaga |
| `job_skills` | `job_id`, `skill_id`, `importance` (`obrigatoria`/`desejavel`), `learn_order` | Skills exigidas e peso |
| `user_skills` | `github_id`, `skill_id`, `confidence` | Skills do dev |
| `user_dev_profiles` | `nivel`, `github_id` | Senioridade do dev |
| `match_ia_cache` | `github_id`, `job_id`, `percentual`, `explicacao`, `created_at`; UNIQUE `(github_id, job_id)` | Cache da explicação por IA (sem invalidação) |
| `user_roadmap_progress` | `github_id`, `job_id`, `skill_id`, `status` (`nao_iniciado`/`em_progresso`/`concluido`), `completed_at` | Progresso do roadmap **antigo** (não altera o % do match) |
| `company_match_actions`, `job_applications` | `dev_github_id`, `job_id`, `action`/`resumo_ia` | Ações da empresa sobre matchs e candidaturas (consomem o match) |
| `skill_resources` | `skill_id`, `type`, `title`, `url`, `is_free`, `duration` | Recursos do roadmap antigo |

### 2.4 Pesos, limiares e constantes (todos hardcoded)

| Constante | Valor | Onde |
| --- | --- | --- |
| Peso skills / senioridade | **85% / 15%** | `matchCalculator.js:60` e `:117–120` (duplicado) |
| Peso por importância | obrigatória **2**, desejável **1** | `matchCalculator.js:39` |
| `NIVEL_ORDER` | `iniciante 0`, `intermediario 1`, `avancado 2` | `matchCalculator.js:23` (**duplicada** em `roadmapService.js:32`) |
| `LEVEL_ORDER` (vaga) | `estagio 0`, `junior 1`, `pleno 2` | `matchCalculator.js:24` |
| Pontuação de senioridade | diff ≤0 → 100; 1 → 55; ≥2 → 10 | `matchCalculator.js:53` |
| `readyFor` | match **≥ 70** | `matchCalculator.js:125` |
| Projeção do roadmap | habilidade adquirida → confiança 100 | `matchCalculator.js:89` |
| Prompt da explicação | `MATCH_IA_SYSTEM_PROMPT`; `maxTokens: 1536` | `matchCalculator.js:15,170` |

A fórmula está **duplicada** em dois lugares dentro do arquivo: `computeMatch` (puro, usado por empresa/admin) e o cálculo inline de `calculateJobMatch` (usado pelo dev). O comentário do arquivo diz que `computeMatch` é a "única fonte de verdade", mas `calculateJobMatch` não o chama — repete `0.85/0.15`.

### 2.5 APIs externas

- Gemini/fallback somente em `getMatchExplanation` (`askGeminiJSON`). O restante do cálculo é determinístico e local.
- LGPD no prompt: só nomes de skills, importância, `tem_a_skill`, `confianca` e o % calculado.

### 2.6 Testes

- `tests/matchCalculator.test.js` — `calculateJobMatch` (db mockado).
- `tests/matchProjetado.test.js` — `getPublicJob` + `matchProjetado`.
- `tests/qa/QA-006.test.js` — mock de `matchCalculator` nas rotas de IA.
- Não há teste direto de `computeSkillsScore`/`computeSeniorityScore`/`computeMatch` nem de `getMatchExplanation`.

---

## 3. Autodiagnóstico

**Situação:** a spec (`docs/roadmap-spec.md`, "Entradas" e "Falhas e casos-limite") prevê que, sem análise do GitHub, o usuário "marca as tecnologias que já usa e o nível de cada uma". **Não existe uma tela/fluxo dedicado a isso.** O comentário de `roadmapService.montarGap` confirma: "autodiagnóstico implementado ainda" = não. O que existe é o equivalente parcial abaixo.

### 3.1 O que cumpre hoje o papel de autodiagnóstico

| Mecanismo | Onde | Efeito |
| --- | --- | --- |
| Skills **manuais** | `views/perfil-dev.ejs` (busca no catálogo) → `POST /api/user/skills` / `DELETE /api/user/skills/:skillId` → `profileController.addSkill`/`removeSkill` | Grava `user_skills` com `source='manual'` e **confiança fixa 70** (≈ "intermediário" em `confidenceToNivel`). **Não há seleção de nível por skill** |
| **Nível geral** auto-declarado | `perfil-dev.ejs` (`#f-nivel`) → `PATCH /api/user/profile` → `profileController.updateProfile` | Grava `user_dev_profiles.nivel`; entra na senioridade do match e no contexto de IA |
| Aviso "sem perfil técnico" | `views/roadmap/novo.ejs` + `trilhaController.formularioNovo`/`criar` (`temSkillsDetectadas`) | Só informa; o texto chama "isso é o autodiagnóstico" ao ato de importar/analisar repositórios |
| Caso "sem dados" no gap | `roadmapService.montarGap` | Sem `github_id` ou sem `user_skills` → todo requisito vira `tem_gap = true` ("precisa aprender tudo") |

### 3.2 Arquivos

`views/perfil-dev.ejs`, `routes/profile.js`, `controllers/profileController.js` (`addSkill`, `removeSkill`, `getSkillsCatalog`, `updateProfile`), `views/roadmap/novo.ejs`, `controllers/trilhaController.js` (`temSkillsDetectadas`, `formularioNovo`, `criar`), `services/roadmapService.js` (`montarGap`, `confidenceToNivel`), `docs/roadmap-spec.md`.

### 3.3 Banco, dados e limiares

- Tabelas: `user_skills` (`source`, `confidence`), `user_dev_profiles.nivel`, `skills`.
- `confidenceToNivel` (`roadmapService.js:104`): `≤0 → null`, `1–40 → iniciante`, `41–70 → intermediario`, `>70 → avancado`.
- `data/habilidades-referencia.json`: baseline por área usado no gap quando o objetivo é uma **área** (`front-end` 9, `back-end` 9, `full-stack` 9, `dados` 8 habilidades, cada uma com `nivel_esperado`). O próprio `_comentario` do arquivo cita "gap do autodiagnóstico/perfil técnico".
- Gap por área: `tem_gap = nivel_atual == null || NIVEL_ORDER[nivel_atual] < NIVEL_ORDER[nivel_esperado]`. Gap por vaga: **binário** (`confidence <= 0`), pois `job_skills` não guarda nível esperado.

### 3.4 APIs externas

Nenhuma (fluxo local).

### 3.5 Testes

- `tests/bug-perfil-dev-catalog-shape.test.js` (catálogo de skills usado pelo seletor manual).
- `tests/roadmapService.test.js` — `gerarRoadmap` (usa `montarGap`).
- Sem teste de `addSkill`/`removeSkill`/`updateProfile` nem de `confidenceToNivel`/`montarGap` isoladamente.

---

## 4. Verificação de projetos das fases do roadmap

### 4.1 Arquivos

| Tipo | Arquivo | Papel |
| --- | --- | --- |
| Service | `services/roadmapService.js` | `verificarProjeto`, `fecharProjetoSemVerificar`, `extrairRepoFullNameDoUrl`, `carregarFaseComDono`, `habilidadesExigidasNaFase`, `registrarProjetoVerificadoNoPerfil`; também `gerarRoadmap`/`regenerarRoadmap`/`salvarFasesEEtapas` |
| Service | `services/githubAnalyzer.js` | `verificarRepoPublico`, `verificarHabilidadesNoRepo` (reutilizam `fetchRepoLanguages`/`fetchRepoReadme`) |
| Service | `services/subscriptionService.js` | `hasFeature(userId, "verificacao_projetos")` (gate de plano) |
| Controller | `controllers/trilhaController.js` | `enviarProjeto` (`POST /trilha/:id/fases/:faseId/projeto`), `montarDadosDetalhe`, `detalhe`, `atualizarEtapa` |
| Route | `routes/trilha.js` | Rotas `/trilha/*` (`requireDev`) |
| Middleware | `middlewares/roadmapLimites.js` | `limiteRoadmapsAtivos`, `limiteRegeneracao` (limites por plano) |
| View | `views/roadmap/detalhe.ejs` | Bloco "Projeto prático": enunciado, selo de status, formulário do repositório, resultado |
| View | `views/roadmap/index.ejs`, `views/roadmap/novo.ejs` | Lista e criação de roadmaps |
| Front JS | `public/js/roadmap.js` | Marcação de etapas via `fetch` (`POST /trilha/:id/etapas/:etapaId`), recálculo de %; não participa da verificação do projeto |
| Config | `config/plans.js` | `features.verificacao_projetos` (`dev_free: false`, `dev_pro: true`) e limites `roadmap.max_ativos` / `regen_intervalo_dias` |
| Migração | `migrations/20261001_roadmap_up.sql`, `_down.sql`, `run-roadmap-migration.js` | Cria `roadmaps`, `roadmap_fases`, `roadmap_etapas`, `recursos`, `recursos_pendentes` |
| Docs | `docs/roadmap-spec.md`, `docs/roadmap-diagnostico.md` | Especificação e diagnóstico |

### 4.2 Fluxo e funções

`enviarProjeto` valida `faseId` e posse (`roadmap_fases.roadmap_id`), exige `repoUrl`, e então:

- **PRO** (`hasFeature(..., "verificacao_projetos")`) → `verificarProjeto(faseId, repoUrl, accessToken)`.
- **Free** → `fecharProjetoSemVerificar(faseId, repoUrl)` (selo `nao_verificado`).

`verificarProjeto` (`roadmapService.js`):

1. `carregarFaseComDono` (fase + `usuario_id`); fase inexistente → exceção.
2. `extrairRepoFullNameDoUrl` (regex `github.com/{dono}/{repo}`); inválida → `{status:"erro"}`.
3. `verificarRepoPublico` (`GET /repos/{r}`): não existe → erro; `private:true` → erro (grava `projeto_repo_url` em ambos).
4. `habilidadesExigidasNaFase` = `DISTINCT habilidade` das **etapas** da fase (a coluna de habilidades do projeto não é persistida).
5. Busca `skills.github_signals` por `name IN (habilidades)` (só as que têm sinais).
6. `verificarHabilidadesNoRepo` → mesma fórmula `+40 linguagem / +20 README` (teto 100); `encontrada = confidence > 0`.
7. `faltando = não encontradas`. Se vazio → `projeto_status='verificado'`, `verificado_em=NOW()`, e `registrarProjetoVerificadoNoPerfil` (se havia habilidades com sinais). Senão → `projeto_status='em_revisao'` e devolve `faltando[]`.

Retornos: `{status: "erro" | "aprovado" | "faltando" | "nao_verificado", mensagem, faltando?}`.

### 4.3 Banco de dados

| Tabela | Colunas | Uso |
| --- | --- | --- |
| `roadmaps` | `usuario_id`, `tipo_objetivo` (`vaga`/`area`), `vaga_id`, `area`, `horas_semana`, `status` (`ativo`/`arquivado`), `versao`, `gerado_em`, `origem` (`ia`/`modelo`) | Roadmap do usuário |
| `roadmap_fases` | `roadmap_id`, `ordem`, `nome`, `objetivo`, `projeto_enunciado`, **`projeto_repo_url`**, **`projeto_status`** (`pendente`/`verificado`/`nao_verificado`/`em_revisao`), **`verificado_em`** | Projeto prático e resultado da verificação |
| `roadmap_etapas` | `fase_id`, `ordem`, `titulo`, `descricao`, **`habilidade`**, `horas_estimadas`, `recurso_id`, `status` (`pendente`/`em_andamento`/`concluida`), `concluida_em` | Habilidades que o projeto deve demonstrar |
| `skills` | `name`, `github_signals` | Sinais usados na verificação (o `name` da skill precisa ser **idêntico** a `roadmap_etapas.habilidade`) |
| `perfil_tecnico_ia` | `user_id`, `boas_praticas` (append de texto), `pontos_melhoria` | Registro da aprovação (`registrarProjetoVerificadoNoPerfil`) — **único escritor ativo** hoje |
| `recursos`, `recursos_pendentes` | `habilidade`, `titulo`, `url`, `tipo`, `idioma`, `gratuito`, `nivel`, `ativo` / `vezes_solicitada` | Recursos de estudo das etapas (não participam da verificação) |
| `user_subscriptions` | plano do usuário | Decide Free × PRO |

### 4.4 Dados / configuração

| Item | Valor |
| --- | --- |
| Pontuação de habilidade no repo | `+40` linguagem, `+20` README, teto `100`; aprovada se `> 0` (mesma fórmula do algoritmo de perfil) |
| Critério de aprovação | **todas** as habilidades verificáveis (com `github_signals`) devem aparecer; habilidades sem sinais cadastrados são **ignoradas**; se nenhuma tiver sinais → aprova |
| Gate de plano | `config/plans.js` → `verificacao_projetos` |
| Limites de roadmap | `dev_free`: `max_ativos 1`, `regen_intervalo_dias 30`; `dev_pro`: `5` e `7` |
| Estrutura da trilha | `FASES_MIN 3`, `FASES_MAX 5`, `ETAPAS_MIN 3`, `ETAPAS_MAX 6` (`roadmapService.js:24–27`) |
| `data/habilidades-referencia.json` | Habilidades por área (gap quando objetivo é área; também `inferirAreaDaVaga`) |
| `data/roadmaps-modelo/{front-end,back-end,full-stack,dados}.json` | Roadmaps estáticos de fallback (`origem='modelo'`); chaves `area`, `origem`, `fases` (4/4/5/4 fases) |

### 4.5 APIs externas

- **GitHub REST** (token da sessão do dono): `GET /repos/{r}`, `GET /repos/{r}/languages`, `GET /repos/{r}/readme`.
- **Gemini/fallback**: só na **geração** do roadmap (`gerarConteudoRoadmap` → `askGeminiJSON`, `maxTokens: 4096`, até 2 tentativas, depois modelo estático). **A verificação do projeto não chama IA** — é puramente por sinais (a view rotula como "Verificação por IA (PRO)" no card do dashboard, mas o código é determinístico).

### 4.6 Testes

- `tests/verificarProjeto.test.js` — `verificarProjeto` (link inválido, repo inexistente/privado, aprovado, faltando) e `fecharProjetoSemVerificar`; `githubAnalyzer` e `db` mockados.
- `tests/trilha.test.js` — `POST /trilha/:id/fases/:faseId/projeto` (gate de plano), limites Free, regeneração, formulário.
- `tests/roadmapService.test.js` — `validarEstruturaRoadmap`, `classificarErroIA`, `gerarRoadmap`, `inferirAreaDaVaga`, `regenerarRoadmap`.
- `tests/matchProjetado.test.js`, `tests/userContextService.test.js` — integrações do roadmap ativo.
- Sem teste direto de `verificarHabilidadesNoRepo`/`verificarRepoPublico` (só mockados).

---

## 5. Ordem de leitura sugerida

1. `services/githubAnalyzer.js` (fórmula base, reutilizada nas áreas 1 e 4)
2. `services/matchCalculator.js` (área 2)
3. `services/roadmapService.js` (`montarGap` → áreas 3/4; `verificarProjeto`)
4. `controllers/profileController.js` (skills manuais e `nivel`)
5. `controllers/trilhaController.js` + `routes/trilha.js`
6. `config/script_bd.sql` + `migrations/20261001_roadmap_up.sql` (esquema)
7. `docs/roadmap-spec.md` e `docs/roadmap-diagnostico.md` (intenção de produto)

---

## 6. Pontos de atenção observados (fatos do código, sem alteração)

1. **Fórmula de confiança soma por sinal × repositório.** Um mesmo sinal presente em vários repos/README acumula (+20 por README, +40 por repo com a linguagem) até o teto 100. Sinais curtos/comuns do seed (`go`, `py`, `js`, `api`, `rest`, `cache`, `next`, `sql`) usam `readme.includes(sinal)` (substring) e podem gerar falso positivo.
2. **Sinais de framework nunca casam com linguagens.** `languages` vem de `/repos/{r}/languages` (só linguagens: `javascript`, `css`, `html`…). Sinais como `express`, `react`, `django` só podem pontuar via README (+20), nunca +40.
3. **Falhas de API viram "nada encontrado".** `fetchRepoLanguages`/`fetchRepoReadme` engolem erros (`[]`/`""`). Um limite de taxa ou token inválido produz `confidence 0` — na verificação de projeto, isso aparece como "habilidades faltando", indistinguível de ausência real.
4. **`github_id` vs `user_id`.** `getUserId(req)` usa `github_id ?? user.id` (fallback para contas sem GitHub), mas `montarGap` só lê `user_dev_profiles.github_id`; sem ele o gap vira "aprender tudo" mesmo que existam skills manuais gravadas com o `user_id` como `github_id`.
5. **Análise lê a lista do GitHub, não `user_repositories`.** O que o dev "importa" na página de repositórios não influencia a detecção de skills; ela usa os 30 (login) / 50 (reanalisar) repositórios mais recentes da conta.
6. **`nivel` é auto-declarado** (padrão `iniciante`) e fica na sessão (`req.session.user.nivel`); entra em 15% do match. Não há cálculo automático de nível a partir dos repositórios.
7. **Fórmula do match duplicada** em `computeMatch` e `calculateJobMatch`; `NIVEL_ORDER` duplicada em `matchCalculator.js` e `roadmapService.js`.
8. **`match_ia_cache` não é invalidado** quando skills/nível mudam.
9. **`perfil_tecnico_ia` ficou sem leitor** após a remoção da análise por IA: apenas `registrarProjetoVerificadoNoPerfil` escreve nela (e o `INSERT` não preenche `proficiencia_estimada`). `docs/roadmap-spec.md` e `docs/roadmap-diagnostico.md` ainda a descrevem como fonte do "perfil técnico".
10. **Verificação de projeto usa as habilidades das etapas**, não as do projeto (`projeto.habilidades` da IA não é persistida). A correspondência com `skills` é por nome exato; habilidade da etapa sem linha em `skills` (ou sem `github_signals`) é ignorada na checagem.
11. **Rótulo × implementação:** a UI chama a verificação de "Verificação por IA (PRO)", mas o código não usa IA nessa etapa.
