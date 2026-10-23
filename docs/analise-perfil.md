# Análise de perfil — funcionamento do algoritmo

Oct 21, 2026 · @Apice

A análise de perfil do Ápice é determinística: nenhum dos quatro cálculos abaixo usa IA para chegar ao resultado. A IA só aparece em volta, para explicar o match e para gerar o roadmap.

## Fonte e estado do código

Todas as regras deste documento vêm do `docs/analise-perfil-inventario.md`, um levantamento somente leitura feito pelo Claude Code em 21/10/2026. Cada regra cita o arquivo e, quando o inventário informa, a linha. Antes de mudar uma regra no código, confira o trecho citado.

**Estado do repositório:** o inventário foi feito sobre uma árvore de trabalho com duas mudanças que depois foram commitadas no branch `feat/analise-perfil`:

- A análise de repositórios por IA (`services/aiProfileAnalyzer.js` e a rota `GET /api/ai/perfil-tecnico`) foi removida **de forma definitiva**. Este documento descreve o sistema sem ela.
- `controllers/trilhaController.js` passou a decidir o aviso "sem perfil técnico" pela tabela `user_skills`, e não mais por `perfil_tecnico_ia`.

## Visão geral

[conteúdo incorporado no original: fluxo da análise de perfil · 3 entradas, 2 tabelas, 3 usos]

O que o dev sabe chega a `user_skills` por dois caminhos: a análise do GitHub e as skills manuais. O nível é declarado à parte, em `user_dev_profiles.nivel`, e só entra na compatibilidade. A verificação de projetos (linha tracejada) não lê `user_skills`: aplica a fórmula do GitHub direto no repositório do projeto.

## 1. Análise do GitHub → perfil técnico

Cada skill do catálogo recebe uma confiança de 0 a 100. A confiança soma pontos sempre que uma palavra-chave da skill aparece nas linguagens ou no README de um repositório. O resultado vai para a tabela `user_skills`, que é a fonte única do que o dev sabe.

### Quando roda

| Gatilho | Repositórios lidos | Onde |
| --- | --- | --- |
| Login via GitHub (OAuth) | os 30 atualizados mais recentemente (`GET /user/repos?sort=updated&per_page=30`) | `authController.js:58–70`. Roda em segundo plano, sem bloquear o login; um erro só vai para o log |
| Botão "Reanalisar" em `/perfil` | os 50 mais recentes (`per_page=50`) | `profileController.reanalyze` → `POST /api/user/reanalyze` |

A análise usa a lista que vem do GitHub. Os repositórios que o dev importa em `/repositorios` (tabela `user_repositories`) **não** entram na conta.

### Entradas

- **Sinais de cada skill:** a coluna `skills.github_signals` traz palavras-chave separadas por vírgula. Por exemplo: `React → react,reactjs,jsx,tsx`, `Python → python,py`, `Node.js → javascript,nodejs,node`. O catálogo inicial tem 61 skills com sinais (`database/seed-skills.js`), e o admin pode editar os sinais em `admin-configuracoes.ejs`.
- **Linguagens do repositório:** `GET /repos/{r}/languages`, convertidas para minúsculas (`fetchRepoLanguages`, `githubAnalyzer.js:12`). Em caso de erro, vira uma lista vazia.
- **README do repositório:** `GET /repos/{r}/readme` em texto puro, convertido para minúsculas (`fetchRepoReadme`, `githubAnalyzer.js:29`). Em caso de erro, vira texto vazio.

As chamadas usam o token OAuth da sessão (`req.session.user.accessToken`), que nunca é gravado no banco.

### A fórmula

A função é `analisarGitHub(accessToken, githubId, repos)` (`githubAnalyzer.js`); `matchSkillsFromGitHub` é um atalho que devolve só a lista de skills. Os repositórios são processados em lotes de 5. A pontuação de uma skill em um repositório fica em `pontuarSkillNoRepo`, a mesma função usada na verificação de projetos. Desde a Etapa 4 do plano, para cada skill e cada repositório:

```latex
\text{confiança}(skill) = \min\Big(100,\ \sum_{repo} \big(40 \cdot [\exists\, sinal \in \text{linguagens}] + 20 \cdot [\exists\, sinal \text{ no README como palavra inteira}]\big)\Big)
```

- **+40** quando **algum** sinal da skill está entre as linguagens do repositório (comparação exata).
- **+20** quando **algum** sinal aparece no README como palavra inteira: antes e depois do sinal não pode haver letra nem número. `py` não casa com "happy"; `c++` e `c#` funcionam.
- Sinônimos (`react`, `reactjs`, `jsx`) não somam entre si: cada repositório dá no máximo 40 + 20 por skill.
- O total tem teto de **100**.
- Repositório cuja leitura falhou (limite de uso, token inválido, rede) fica fora da conta (Etapa 2).
- Só grava a skill se a confiança for **maior que 0**: `INSERT … ON DUPLICATE KEY UPDATE confidence` em `user_skills`, com `source = 'github'`.

### Exemplo passo a passo

Dados hipotéticos, só para mostrar a conta. Skill **React**, sinais `react, reactjs, jsx, tsx`:

| Repositório | Linguagens | Trecho do README | Pontos |
| --- | --- | --- | --- |
| `loja-front` | javascript, css | "feito com React e JSX" | `react` e `jsx` no README, contados uma vez = **20** |
| `portfolio` | typescript, html | "usei reactjs" | `reactjs` no README (`react` dentro de "reactjs" não conta mais) = **20** |
| `api-tarefas` | javascript | "API em Node" | nenhum sinal = **0** |

Confiança de React = min(100, 20 + 20 + 0) = **40**. Antes da Etapa 4, com a soma por sinal e a busca por trecho, o mesmo exemplo dava **80**. Nenhum sinal de React casa com as linguagens, porque o GitHub devolve só nomes de linguagem (javascript, typescript…). Por isso React só pontua pelo README.

### Saída

| Tabela | Colunas | Observação |
| --- | --- | --- |
| `user_skills` | `github_id`, `skill_id`, `source` (`github`/`manual`), `confidence` (0–100) | UNIQUE `(github_id, skill_id)` |
| `user_dev_profiles` | `user_id`, `github_id`, `nivel` | Liga `user_id` a `github_id`. O `nivel` não é calculado aqui (ver seção 2) |

`profileController.getProfile` lista as skills do dev ordenadas por confiança, e `perfil-dev.ejs` as exibe.

## 2. Autodiagnóstico e gap

O autodiagnóstico previsto na spec, em que o usuário marca as tecnologias que usa e o nível de cada uma, **ainda não existe** como tela própria. O comentário de `roadmapService.montarGap` confirma isso. Hoje, dois mecanismos do perfil cumprem esse papel em parte.

### O que existe hoje

| Mecanismo | Caminho | Efeito |
| --- | --- | --- |
| Skills manuais | `perfil-dev.ejs` (busca no catálogo) → `POST /api/user/skills` / `DELETE /api/user/skills/:skillId` → `profileController.addSkill` / `removeSkill` | Grava em `user_skills` com `source = 'manual'` e **confiança fixa 70**, usando `GREATEST` com o valor que já existir. Não há escolha de nível por skill. A remoção apaga só linhas manuais |
| Nível geral declarado | `perfil-dev.ejs` (`#f-nivel`) → `PATCH /api/user/profile` → `profileController.updateProfile` | Grava `user_dev_profiles.nivel` (`iniciante`, `intermediario` ou `avancado`; padrão `iniciante`). Entra em 15% do match (seção 3) e no contexto da IA |
| Aviso "sem perfil técnico" | `views/roadmap/novo.ejs` + `trilhaController` (`temSkillsDetectadas`) | Só informa. Aparece quando o dev não tem linhas em `user_skills` |

O nível do dev é sempre declarado por ele. Nenhuma parte do sistema calcula o nível a partir dos repositórios.

### De confiança para nível

`confidenceToNivel` (`roadmapService.js:104`) converte a confiança de uma skill em nível:

| Confiança | Nível |
| --- | --- |
| 0 ou menos | nenhum (`null`) |
| 1 a 40 | `iniciante` |
| 41 a 70 | `intermediario` |
| mais de 70 | `avancado` |

Uma skill manual (confiança 70) vale, portanto, `intermediario`.

### Cálculo do gap (`montarGap`)

O gap diz quais habilidades o roadmap precisa ensinar. A regra muda conforme o objetivo:

- **Objetivo é uma área:** compara com `data/habilidades-referencia.json`. O arquivo lista as habilidades de cada área com um `nivel_esperado`: front-end 9, back-end 9, full-stack 9 e dados 8 habilidades. Uma habilidade tem gap quando:

```latex
\text{gap} = (\text{nivel\_atual} = \text{null}) \ \lor\ \text{ordem}(\text{nivel\_atual}) < \text{ordem}(\text{nivel\_esperado})
```

com a ordem `iniciante 0`, `intermediario 1`, `avancado 2` (`NIVEL_ORDER`, `roadmapService.js:32`).

- **Objetivo é uma vaga:** o gap é binário. A habilidade tem gap quando a confiança é 0 ou menos, porque `job_skills` não guarda um nível esperado.
- **Sem dados:** se o dev não tem `github_id` em `user_dev_profiles` ou não tem linhas em `user_skills`, todo requisito vira gap ("precisa aprender tudo").

## 3. Compatibilidade perfil × vaga

O match é 85% skills e 15% senioridade, arredondado e com teto de 100. Com 70 ou mais, o dev é considerado pronto para a vaga (`readyFor`). O núcleo fica em `services/matchCalculator.js`.

### Entradas

| Dado | Tabela | Valores |
| --- | --- | --- |
| Skills exigidas pela vaga | `job_skills` | `skill_id`, `importance` (`obrigatoria` ou `desejavel`) |
| Senioridade da vaga | `jobs.level` | `estagio`, `junior`, `pleno` |
| Skills do dev | `user_skills` | `confidence` de 0 a 100. Skill ausente conta como 0 |
| Senioridade do dev | `user_dev_profiles.nivel` | `iniciante`, `intermediario`, `avancado` (declarado) |

### Nota de skills (`computeSkillsScore`, `matchCalculator.js:34`)

Média ponderada das confianças, com peso **2** para skill obrigatória e **1** para desejável. Se a vaga não tem skills cadastradas, a nota é 100.

```latex
S = 100 \cdot \frac{\sum_i w_i \cdot c_i / 100}{\sum_i w_i}, \qquad w_i = \begin{cases} 2 & \text{obrigatória} \\ 1 & \text{desejável} \end{cases}
```

### Nota de senioridade (`computeSeniorityScore`, `matchCalculator.js:48`)

Compara a posição da vaga com a do dev, nas escalas `estagio 0 / junior 1 / pleno 2` e `iniciante 0 / intermediario 1 / avancado 2`:

| Diferença (vaga − dev) | Nota |
| --- | --- |
| 0 ou menos (dev no nível da vaga ou acima) | 100 |
| 1 | 55 |
| 2 ou mais | 10 |
| nível do dev ou da vaga desconhecido | 100 |

### Match final (`computeMatch`, `matchCalculator.js:57`)

```latex
\text{match} = \min\big(100,\ \text{round}(0{,}85 \cdot S + 0{,}15 \cdot N)\big)
```

em que S é a nota de skills e N a de senioridade. `calculateJobMatch` (`matchCalculator.js:63`) faz a mesma conta lendo o banco e devolve `{ match, breakdown[], readyFor, scores{skills, seniority} }`, com `readyFor = match ≥ 70` (`:125`).

### Projeção com o roadmap

Quando o dev tem roadmap ativo para a vaga, `calcularMatchProjetadoComRoadmap` (`roadmapController.js`) refaz a conta tratando as habilidades das etapas como adquiridas: elas entram com **confiança 100** (`profileData.habilidadesAdquiridas`, `matchCalculator.js:89`). É o número de "sua compatibilidade sobe para ~Y%".

### Exemplo passo a passo

Dados hipotéticos. Vaga **júnior**; dev **iniciante**.

| Skill da vaga | Importância | Peso | Confiança do dev | Peso × confiança/100 |
| --- | --- | --- | --- | --- |
| JavaScript | obrigatória | 2 | 80 | 1,6 |
| React | obrigatória | 2 | 80 | 1,6 |
| SQL | desejável | 1 | 0 | 0 |
| Git | desejável | 1 | 70 (manual) | 0,7 |
| **Total** |  | **6** |  | **3,9** |

1. Nota de skills: S = 100 × 3,9 / 6 = **65**.
2. Senioridade: júnior (1) − iniciante (0) = 1 → N = **55**.
3. Match: round(0,85 × 65 + 0,15 × 55) = round(55,25 + 8,25) = round(63,5) = **64**. Como 64 < 70, `readyFor` é falso.
4. Projeção com um roadmap que ensina SQL: SQL passa a 100, o total vai a 4,9, S = 81,7 e o match projetado = round(69,4 + 8,25) = **78**.

### Quem usa o cálculo

| Função | Usada por |
| --- | --- |
| `calculateJobMatch` | Dev: `vaga-publica.ejs` (via `roadmapController.getPublicJob`), roadmap antigo (`roadmapGenerator.js`) e ferramenta do mentor (`aiTools.analisarCompatibilidadeVaga`) |
| `computeMatch` | Empresa (`empresaController`: matchs, desenvolvedores, perfil do dev) e admin (`adminController`, relatório de matchs) |

### Explicação por IA

`getMatchExplanation` (`matchCalculator.js:146`) só **explica** o resultado; o percentual continua vindo de `calculateJobMatch`. A explicação é guardada em `match_ia_cache` (UNIQUE `github_id, job_id`). A IA recebe apenas nomes de skills, importância, se o dev tem a skill, a confiança e o percentual.

## 4. Verificação de projetos das fases

Uma fase é aprovada quando **todas** as habilidades verificáveis da fase aparecem no repositório, pela mesma fórmula da seção 1 (+40 linguagem, +20 README). Não há IA nesta etapa, embora a interface a chame de "Verificação por IA (PRO)".

### Entrada e divisão por plano

`trilhaController.enviarProjeto` (`POST /trilha/:id/fases/:faseId/projeto`) confere se a fase pertence ao roadmap do usuário e exige `repoUrl`. Depois:

| Plano | Função | Resultado |
| --- | --- | --- |
| PRO (`hasFeature(userId, "verificacao_projetos")`) | `verificarProjeto(faseId, repoUrl, accessToken)` | `aprovado`, `faltando` ou `erro` |
| Free | `fecharProjetoSemVerificar(faseId, repoUrl)` | `nao_verificado`: a fase fecha com esse selo |

O recurso vem de `config/plans.js` (`dev_free: false`, `dev_pro: true`).

### Passos de `verificarProjeto` (`roadmapService.js`)

1. **Carrega a fase e o dono** (`carregarFaseComDono`). Fase inexistente gera exceção.
2. **Lê o link** (`extrairRepoFullNameDoUrl`, regex `github.com/{dono}/{repo}`). Link inválido → `erro`.
3. **Confere o repositório** (`verificarRepoPublico`, `GET /repos/{r}`). Inexistente ou privado → `erro`. Nos dois casos, grava `projeto_repo_url`.
4. **Lista as habilidades exigidas** (`habilidadesExigidasNaFase`): `DISTINCT habilidade` das **etapas** da fase. As habilidades do projeto gerado pela IA não são gravadas, então não entram.
5. **Busca os sinais** em `skills.github_signals`, com `name IN (habilidades)`. Entram só habilidades com nome **idêntico** a uma skill e com sinais cadastrados.
6. **Pontua cada habilidade no repositório** (`verificarHabilidadesNoRepo`): mesma fórmula da seção 1, com teto 100. A habilidade é encontrada se a confiança for maior que 0.
7. **Decide:**
   - Nenhuma faltando → `projeto_status = 'verificado'`, `verificado_em = NOW()`. Se havia habilidades com sinais, chama `registrarProjetoVerificadoNoPerfil`, que acrescenta o registro em `perfil_tecnico_ia.boas_praticas`.
   - Alguma faltando → `projeto_status = 'em_revisao'` e devolve a lista `faltando[]`.

Se nenhuma habilidade da fase tiver sinais cadastrados, a lista de faltantes fica vazia e o projeto é **aprovado**.

### Retornos e status

| Retorno | Quando | `roadmap_fases.projeto_status` |
| --- | --- | --- |
| `aprovado` | todas as habilidades verificáveis encontradas | `verificado` |
| `faltando` | ao menos uma não encontrada | `em_revisao` |
| `erro` | link inválido, repositório inexistente ou privado | grava `projeto_repo_url`; o inventário não diz se o status muda |
| `nao_verificado` | usuário Free | `nao_verificado` |

Valores possíveis de `projeto_status`: `pendente`, `verificado`, `nao_verificado` e `em_revisao`. As chamadas ao GitHub usam o token da sessão do dono do roadmap.

## 5. Constantes e onde ficam

Todos os pesos e limiares estão escritos direto no código. A exceção são os sinais das skills, que ficam no banco, e os limites por plano, que ficam no `config/plans.js`. Para mudar um peso, é preciso editar o arquivo indicado.

| Constante | Valor | Onde |
| --- | --- | --- |
| Pontos por sinal nas linguagens | +40 | `githubAnalyzer.js` |
| Pontos por sinal no README | +20 | `githubAnalyzer.js` |
| Teto da confiança | 100 | `githubAnalyzer.js` |
| Grava a skill se | confiança > 0 | `githubAnalyzer.js` |
| Tamanho do lote de repositórios | 5 | `githubAnalyzer.js` |
| Repositórios lidos | 30 no login, 50 ao reanalisar | `authController.js`, `profileController.js` |
| Sinais por skill | lista por skill | banco: `skills.github_signals` (seed em `database/seed-skills.js`) |
| Confiança de skill manual | 70 (`GREATEST` com o valor atual) | `profileController.addSkill` |
| Faixas de `confidenceToNivel` | 1–40 iniciante, 41–70 intermediário, >70 avançado | `roadmapService.js:104` |
| `NIVEL_ORDER` (dev) | iniciante 0, intermediario 1, avancado 2 | `matchCalculator.js:23` e `roadmapService.js:32` (duplicada) |
| `LEVEL_ORDER` (vaga) | estagio 0, junior 1, pleno 2 | `matchCalculator.js:24` |
| Peso skills / senioridade | 85% / 15% | `matchCalculator.js:60` e `:117–120` (duplicado) |
| Peso por importância | obrigatória 2, desejável 1 | `matchCalculator.js:39` |
| Nota de senioridade | diferença ≤0 → 100; 1 → 55; ≥2 → 10 | `matchCalculator.js:53` |
| Pronto para a vaga (`readyFor`) | match ≥ 70 | `matchCalculator.js:125` |
| Confiança na projeção do roadmap | 100 | `matchCalculator.js:89` |
| Contexto da IA | até 20 skills e 10 repositórios | `userContextService.js` (`MAX_SKILLS`, `MAX_REPOS`) |
| Estrutura do roadmap | 3 a 5 fases, 3 a 6 etapas por fase | `roadmapService.js:24–27` |
| Verificação de projetos | Free não, PRO sim | `config/plans.js` (`verificacao_projetos`) |

## 6. Limitações conhecidas

São fatos observados no código pelo inventário, sem nenhuma correção aplicada. O impacto descreve o que cada um causa para o usuário ou para a equipe.

| # | Limitação | Impacto | Onde |
| --- | --- | --- | --- |
| 1 | A confiança soma por sinal × repositório, e o README é lido por trecho de texto. Sinais curtos do seed (`go`, `py`, `js`, `api`, `rest`, `cache`, `next`, `sql`) casam dentro de outras palavras | Falso positivo: a skill ganha pontos sem ser usada, e um sinal repetido em vários repositórios infla a confiança | `githubAnalyzer.js`, `database/seed-skills.js` |
| 2 | O endpoint de linguagens só devolve linguagens (javascript, css, html…) | Sinais de framework (`express`, `react`, `django`) nunca ganham +40, só +20 pelo README | `githubAnalyzer.js` |
| 3 | Erros da API do GitHub viram lista vazia ou texto vazio | Limite de taxa ou token inválido produz confiança 0. Na verificação de projeto, aparece como "habilidade faltando", sem diferença de uma ausência real | `fetchRepoLanguages`, `fetchRepoReadme` |
| 4 | `getUserId(req)` usa `github_id ?? user.id`, mas `montarGap` só lê `user_dev_profiles.github_id` | Conta sem GitHub com skills manuais recebe gap de "aprender tudo" | `profileController.js`, `roadmapService.montarGap` |
| 5 | A análise usa os 30 ou 50 repositórios mais recentes da conta, não os importados em `user_repositories` | O que o dev escolhe exibir não influencia as skills detectadas | `authController.js`, `profileController.reanalyze` |
| 6 | O `nivel` é declarado (padrão `iniciante`) e fica na sessão | 15% do match depende só do que o dev declarou | `user_dev_profiles.nivel`, `req.session.user.nivel` |
| 7 | A fórmula do match está em dois lugares, e `NIVEL_ORDER` também | Mudar o peso em um lugar só faz dev e empresa verem percentuais diferentes para o mesmo par | `computeMatch` e `calculateJobMatch`; `matchCalculator.js:23` e `roadmapService.js:32` |
| 8 | `match_ia_cache` não é invalidado | A explicação da IA pode descrever um match antigo depois que skills ou nível mudam | `matchCalculator.getMatchExplanation` |
| 9 | `perfil_tecnico_ia` ficou sem leitor; só `registrarProjetoVerificadoNoPerfil` escreve nela, sem preencher `proficiencia_estimada` | A spec e o diagnóstico ainda a tratam como fonte do perfil técnico, o que pode confundir quem lê esses docs | `roadmapService.js`, `docs/roadmap-spec.md`, `docs/roadmap-diagnostico.md` |
| 10 | A verificação usa as habilidades das etapas, com correspondência exata de nome em `skills` | Habilidade sem skill de mesmo nome ou sem sinais é ignorada; se nenhuma tiver sinais, o projeto é aprovado sem checagem | `roadmapService.habilidadesExigidasNaFase` |
| 11 | A interface chama a verificação de "Verificação por IA (PRO)" | O rótulo promete IA, mas a checagem é por sinais | card do dashboard |

## 7. Testes

As fórmulas centrais não têm teste direto: a de confiança do GitHub e as três funções puras do match só aparecem mockadas ou de forma indireta.

| Parte | Coberto por | Sem teste direto |
| --- | --- | --- |
| Análise do GitHub | indireto: `tests/userContextService.test.js`, `tests/bug-perfil-dev-catalog-shape.test.js` | `matchSkillsFromGitHub`, `fetchRepoLanguages`, `fetchRepoReadme` (o `githubAnalyzer` só aparece mockado) |
| Autodiagnóstico e gap | `tests/roadmapService.test.js` (via `gerarRoadmap`), `tests/bug-perfil-dev-catalog-shape.test.js` | `addSkill`, `removeSkill`, `updateProfile`, `confidenceToNivel`, `montarGap` isolado |
| Compatibilidade | `tests/matchCalculator.test.js` (`calculateJobMatch`, banco mockado), `tests/matchProjetado.test.js` | `computeSkillsScore`, `computeSeniorityScore`, `computeMatch`, `getMatchExplanation` |
| Verificação de projetos | `tests/verificarProjeto.test.js` (link inválido, repositório inexistente ou privado, aprovado, faltando, Free), `tests/trilha.test.js` (rota e plano) | `verificarRepoPublico`, `verificarHabilidadesNoRepo` (só mockados) |

Os exemplos numéricos das seções 1 e 3 podem virar os primeiros casos de teste dessas funções.
