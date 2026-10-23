# Plano de melhorias da análise de perfil

São 10 etapas pequenas, no mesmo formato do roadmap: cada uma tem o prompt para colar no Claude Code, a forma de conferir e um commit próprio. A ordem importa. Primeiro vêm os testes, depois o que impede erros silenciosos, depois a precisão e por fim a explicação para o usuário.

## Regras de segurança (valem para todas as etapas)

1. **Uma etapa por vez.** Cole só o prompt da etapa atual. Quando ela estiver conferida, faça o commit e use `/clear` no Claude Code antes da próxima.
2. **Nada é alterado na `main`.** Todo o trabalho acontece no branch `feat/analise-perfil`, e a `main` só recebe o merge na Etapa 9.
3. **Teste antes de mudar a fórmula.** Toda etapa que muda um cálculo começa com um teste que falha e termina com ele passando.
4. **Mostrar o diff antes de salvar** qualquer arquivo que já existia.
5. **Conferir antes do commit:** `npm test` passa, o site sobe com `npm start` e as páginas `/perfil`, `/vagas` e `/trilha` abrem.
6. **Se algo quebrar:** `git restore .` descarta o que não foi salvo, e `git reset --hard HEAD~1` desfaz o último commit.

## Etapa 0 — Preparação

Esta etapa é feita por você, no terminal do VS Code. Antes de tudo, resolva as mudanças não commitadas que o inventário encontrou: a remoção do `aiProfileAnalyzer.js` precisa ser commitada ou desfeita, porque o branch novo parte de uma `main` limpa.

```bash
git status            # precisa aparecer "nothing to commit"
git checkout main && git pull
git checkout -b feat/analise-perfil
mysqldump -u <usuario> -p <banco> > backup-antes-analise-perfil.sql
npm test && npm start # confirme que tudo passa e o site sobe
```

Copie as duas abas deste documento para `docs/analise-perfil.md` (a aba principal) e `docs/analise-perfil-plano.md` (esta aba). Os prompts seguintes mandam o Claude Code ler esses arquivos.

**Conferência:** o branch existe, o backup foi gerado e `npm test` passa.

**Commit:** `git add docs/ && git commit -m "docs: análise de perfil e plano de melhorias"`

## Etapa 1 — Rede de segurança (somente testes)

Antes de mexer em qualquer fórmula, os testes registram como o cálculo funciona hoje. Assim, toda mudança posterior que alterar um número sem querer é pega na hora. Esta etapa também confirma os três pontos que a documentação deixou em aberto.

```text
Leia docs/analise-perfil.md. NESTA ETAPA NÃO ALTERE NENHUM ARQUIVO DE CÓDIGO, só crie testes.

1. tests/matchFormula.test.js — testes diretos de computeSkillsScore, computeSeniorityScore e computeMatch
   (services/matchCalculator.js), incluindo o exemplo da seção 3 do doc:
   vaga junior; JavaScript obrigatória 80, React obrigatória 80, SQL desejável 0, Git desejável 70; dev iniciante
   → skills 65, senioridade 55, match 64. Com SQL = 100 → match 78.
   Casos de borda: vaga sem skills, nível desconhecido, diferença de senioridade 0/1/2, teto 100.
2. tests/githubAnalyzer.test.js — matchSkillsFromGitHub com a API do GitHub e o db MOCKADOS, incluindo o exemplo
   da seção 1 (React 80). Cubra: sinal nas linguagens (+40), sinal no README (+20), teto 100,
   confiança 0 não grava, erro da API vira lista vazia.
3. tests/confidenceToNivel.test.js — faixas 0, 1, 40, 41, 70, 71.

Se algum teste mostrar que o comportamento real difere do doc, NÃO ajuste o teste para passar:
me diga a diferença. Responda também, citando a linha do código:
(a) a nota de skills sai de 0 a 100 ou de 0 a 1?
(b) o +40 compara o sinal com o nome da linguagem de forma exata?
(c) quando verificarProjeto dá erro (link inválido, repo privado), o projeto_status muda?
```

**Conferência:** `npm test` passa com os testes novos. Leve as respostas (a), (b) e (c) para a aba principal do doc. Se o Claude Code apontar alguma diferença entre o código e o doc, corrija o doc antes de seguir.

**Commit:** `git add tests/ && git commit -m "test(analise-perfil): testes das fórmulas atuais"`

## Etapa 2 — Falha da API não é "não encontrado"

Hoje, um limite de uso ou um token expirado no GitHub vira confiança 0, e na verificação aparece como "habilidade faltando" (limitação 3). Depois desta etapa, o sistema avisa que não conseguiu ler o GitHub, em vez de dar um resultado errado.

```text
Leia docs/analise-perfil.md (seções 1, 4 e limitação 3).

1. Em services/githubAnalyzer.js, faça a leitura do GitHub distinguir três casos:
   - sucesso;
   - "não existe" normal (ex.: repositório sem README → 404) → continua valendo "" / [];
   - falha (401, 403 de limite de uso, 429, 5xx, timeout, erro de rede) → sinalizada como falha.
   Antes de mudar a assinatura de fetchRepoLanguages/fetchRepoReadme, liste TODOS os chamadores
   (inclusive portfolioDescriber.js) e mantenha-os funcionando. Mostre o diff.
2. matchSkillsFromGitHub: repositório com falha de leitura fica de fora da conta e NÃO reduz a confiança
   que já existe em user_skills. Se TODOS falharem, não grava nada e devolve status "indisponivel".
   O botão Reanalisar mostra: "Não conseguimos ler seu GitHub agora. Tente de novo em alguns minutos."
3. verificarProjeto: falha de leitura → novo retorno {status: "indisponivel"}, sem mudar projeto_status,
   com a mesma mensagem. Nunca devolver "faltando" quando a causa foi falha da API.
4. Registre a falha no log (status HTTP e repositório), sem o token.
5. Testes (API mockada): 403 de limite → indisponivel; README 404 → conta como sem README;
   1 de 3 repos falhando → os outros 2 contam; verificarProjeto com falha → indisponivel e status inalterado.
```

**Conferência:** `npm test` passa. No site, clique em Reanalisar e confira que as skills continuam aparecendo. Para simular a falha, troque temporariamente o token da sessão por um inválido: a mensagem amigável tem que aparecer e as skills não podem sumir.

**Commit:** `feat(analise-perfil): falha do GitHub não vira "não encontrado"`

## Etapa 3 — Projeto que não dá para verificar e o rótulo "por IA"

Hoje, se nenhuma habilidade da fase tem sinais cadastrados, o projeto é aprovado sem checagem (limitação 10), e a tela promete uma verificação "por IA" que não existe (limitação 11). As duas coisas tiram valor do PRO.

```text
Leia docs/analise-perfil.md (seção 4, limitações 10 e 11).

1. Em verificarProjeto, separe as habilidades da fase em "verificáveis" (com skill de mesmo nome e github_signals)
   e "não verificáveis".
   - Nenhuma verificável → NÃO aprovar. Retorne {status: "nao_verificavel"}, grave projeto_status = 'nao_verificado'
     (valor que já existe; não crie valor novo no banco) e mostre: "Não conseguimos verificar este projeto
     automaticamente. A fase foi concluída com o selo 'não verificada'."
   - Algumas verificáveis → decida só por elas, como hoje, e liste no resultado as que não puderam ser checadas.
2. Crie scripts/habilidades-sem-sinais.js (somente leitura): lista as habilidades de roadmap_etapas que não têm
   skill de mesmo nome ou não têm github_signals, com a contagem de etapas. É a lista para o admin cadastrar sinais.
3. Troque o rótulo "Verificação por IA (PRO)" por "Verificação automática (PRO)" em todas as views onde aparece.
   Mostre o diff de cada arquivo.
4. Testes: fase sem habilidades verificáveis → nao_verificavel e status 'nao_verificado';
   fase com 2 verificáveis encontradas + 1 não verificável → aprovado, com a não verificável listada.
```

**Conferência:** `npm test` passa. Rode `node scripts/habilidades-sem-sinais.js` e cadastre, pelo admin, os sinais das habilidades que mais aparecem. Procure no site pelo texto "por IA" na tela do roadmap: ele não pode mais aparecer.

**Commit:** `feat(analise-perfil): projeto sem habilidades verificáveis não é aprovado`

## Etapa 4 — Palavra inteira no README e sinônimos contados uma vez

Hoje `py` casa dentro de "happy", e "reactjs" no README conta como dois sinais de React (limitação 1). Esta etapa muda a fórmula, então **os números dos usuários vão mudar**, em geral para baixo. Isso é esperado, mas confira o antes e o depois.

Nova regra, por skill e por repositório: **+40** se algum sinal da skill está nas linguagens e **+20** se algum sinal aparece no README como palavra inteira. Os sinônimos deixam de somar entre si, e o teto continua 100.

```text
Leia docs/analise-perfil.md (seção 1 e limitação 1) e os testes de tests/githubAnalyzer.test.js.

1. Em services/githubAnalyzer.js:
   - README: troque readme.includes(sinal) por busca de palavra inteira. Escape os caracteres especiais
     (c++, c#, node.js) e use como limite "não é letra nem número" antes e depois, em vez de \b,
     porque \b falha com + e #.
   - Pontuação por skill e por repositório: +40 se QUALQUER sinal da skill está nas linguagens, +20 se QUALQUER
     sinal aparece no README. Sinônimos (react, reactjs, jsx) não somam entre si. Teto 100, como hoje.
   - Aplique a mesma regra em verificarHabilidadesNoRepo.
2. Antes de alterar, rode o cálculo atual e o novo para o exemplo do doc e para 5 READMEs de teste
   (crie fixtures em tests/fixtures/) e me mostre uma tabela antes × depois. Espere meu ok para continuar.
3. Atualize os testes da Etapa 1 cujo valor muda DE PROPÓSITO, com um comentário explicando a nova regra.
   Novos casos: "happy" não casa com py; "c++" casa com C++; "reactjs" conta uma vez só.
```

**Conferência:** leia a tabela antes × depois. Uma queda em skills de framework é esperada. Uma skill que zerou num perfil real é sinal de problema. Clique em Reanalisar no seu próprio perfil e veja se o resultado faz sentido. Depois, atualize o exemplo da seção 1 da aba principal: React passa de 80 para 40.

**Commit:** `feat(analise-perfil): README por palavra inteira, sinônimos contam uma vez`

## Etapa 5 — Forks e arquivos de dependências

Dois ganhos de precisão. Primeiro, não contar código que o dev não escreveu: o inventário não diz se forks entram na conta, então a etapa começa verificando isso. Segundo, ler `package.json`, `requirements.txt` e similares, que mostram com segurança se o projeto usa React, Express ou Django (limitação 2).

```text
Leia docs/analise-perfil.md (seção 1, limitação 2).

PARTE A — diagnóstico, sem alterar arquivos. Responda citando a linha:
1. A lista de GET /user/repos usada no login e no Reanalisar inclui forks? Inclui repositórios de organizações
   ou em que o dev é só colaborador (parâmetro affiliation)?
2. Quantas chamadas à API do GitHub uma análise de 50 repositórios faz hoje?
Pare e espere meu ok.

PARTE B — implementação:
1. Ignore repositórios com fork = true. Para repositórios de organização ou colaboração, siga o que eu decidir
   na Parte A.
2. Arquivos de dependências: para cada repositório, liste a raiz com UMA chamada (GET /repos/{r}/contents/) e baixe
   só os arquivos que existirem entre: package.json, requirements.txt, pyproject.toml, pom.xml, build.gradle,
   composer.json, Gemfile, go.mod. Extraia os nomes dos pacotes.
3. Nova evidência: sinal igual ao nome de um pacote conta como "dependência" e vale +40, como as linguagens
   (por skill e por repositório, sem somar duas vezes linguagem + dependência). README continua +20. Teto 100.
4. Falha ao ler esses arquivos segue a regra da Etapa 2 (não vira "não encontrado").
5. Mostre a tabela antes × depois com as fixtures da Etapa 4 + 2 package.json de exemplo. Espere meu ok.
6. Testes: fork ignorado; React em package.json → +40; package.json inválido não quebra a análise.
```

**Conferência:** na Parte A, decida se repositórios de organização contam. A sugestão é contar só os do próprio dev. Na Parte B, clique em Reanalisar no seu perfil: frameworks que você usa devem subir. Confira também que a análise não ficou lenta demais, já que ela roda em segundo plano no login.

**Commit:** `feat(analise-perfil): ignora forks e lê arquivos de dependências`

## Etapa 6 — Mostrar de onde veio cada skill e usar os repositórios escolhidos

O dev passa a ver o motivo de cada número, por exemplo "React 40: dependência em loja-front, README de portfolio". A análise passa a respeitar os repositórios que ele importou em `/repositorios` (limitação 5). É a etapa que mais aumenta a confiança do usuário no resultado.

```text
Leia docs/analise-perfil.md (seção 1, limitação 5) e o padrão de migrations/ criado no roadmap.

1. Migração nova (mesmo padrão do roadmap, com up e down, CREATE TABLE IF NOT EXISTS):
   user_skill_evidencias (id, github_id, skill_id, repo_full_name, tipo ENUM('linguagem','dependencia','readme'),
   pontos, created_at), com índice em (github_id, skill_id). Não altere tabelas existentes.
   Script npm "migrate:analise-perfil".
2. matchSkillsFromGitHub grava as evidências de cada skill numa TRANSAÇÃO: apaga as evidências antigas do dev
   e insere as novas junto com a atualização de user_skills.
3. Repositórios usados: se o dev tem repositórios em user_repositories, a análise usa só esses; se não tem,
   continua com os mais recentes (30 no login, 50 no Reanalisar). Forks continuam fora (Etapa 5).
4. Em perfil-dev.ejs, cada skill detectada ganha um "por quê?" que abre a lista de evidências
   (repositório + tipo + pontos). Skills manuais mostram "adicionada por você". Escape todo texto com <%= %>.
   Mostre o diff da view antes de salvar.
5. Na página /repositorios, um aviso curto: "Os repositórios desta lista são os que contam na análise do seu perfil."
6. Testes: evidências gravadas e substituídas a cada análise; dev com repositórios importados → só eles contam;
   dev sem repositórios importados → os mais recentes.
```

**Conferência:** rode `npm run migrate:analise-perfil` duas vezes; a segunda não pode dar erro. Importe 2 repositórios em `/repositorios`, clique em Reanalisar e abra o "por quê?" de uma skill: só esses 2 podem aparecer.

**Commit:** `feat(analise-perfil): evidências por skill e repositórios escolhidos`

## Etapa 7 — Autodiagnóstico com nível por skill

Hoje toda skill manual vale 70, ou seja, "intermediário", seja qual for o nível real do dev. Esta etapa entrega o autodiagnóstico que a spec do roadmap previa e deixa claro, para o dev e para a empresa, o que foi declarado e o que foi detectado.

Os níveis viram confianças dentro das faixas que `confidenceToNivel` já usa: iniciante **30**, intermediário **60**, avançado **85**.

```text
Leia docs/analise-perfil.md (seção 2) e docs/roadmap-spec.md (Entradas).

PARTE A — diagnóstico, sem alterar arquivos: hoje, quando a análise do GitHub encontra uma skill que o dev
já tinha adicionado manualmente, o que acontece com source e confidence em user_skills? Cite a linha.
Pare e espere meu ok.

PARTE B:
1. Em perfil-dev.ejs, ao adicionar uma skill manual, o dev escolhe o nível: iniciante (30), intermediário (60)
   ou avançado (85). profileController.addSkill recebe o nível e grava a confiança correspondente.
   Skills manuais antigas (70) continuam como estão.
2. Regra quando GitHub e declaração falam da mesma skill: vale a MAIOR confiança, e source = a origem
   desse maior valor (assim o selo nunca diz "detectada" para um número que veio da declaração). Ajuste conforme a resposta da Parte A, mostrando o diff.
3. Selos "detectada no GitHub" e "declarada" nas skills do perfil do dev e nas telas da empresa que mostram skills
   (empresa-desenvolvedores, perfil-dev-empresa). Mostre o diff de cada view.
4. Em /trilha/novo, quando o dev não tem skills, o aviso ganha um link "Fazer autodiagnóstico" para /perfil.
5. Testes: addSkill com cada nível; skill manual 30 + GitHub 60 → 60 e source github;
   skill manual 85 + GitHub 20 → 85 e source manual.
```

**Conferência:** adicione uma skill como avançado e veja o selo "declarada". Abra o seu perfil pela visão da empresa e confira os selos. Gere um roadmap por área: uma skill declarada como avançado não pode aparecer como gap.

**Commit:** `feat(analise-perfil): autodiagnóstico com nível por skill`

## Etapa 8 — Arrumação: fórmula única, cache e gap sem GitHub

Três correções que não mudam nenhum número para o usuário, mas evitam bugs futuros (limitações 4, 7 e 8). Os testes da Etapa 1 provam que o match continua igual.

```text
Leia docs/analise-perfil.md (seções 2 e 3, limitações 4, 7 e 8).

1. Fórmula única: calculateJobMatch passa a chamar computeMatch (e computeSkillsScore/computeSeniorityScore)
   em vez de repetir 0.85/0.15. NIVEL_ORDER fica num lugar só e é importado por matchCalculator.js
   e roadmapService.js. Os testes de tests/matchFormula.test.js e tests/matchCalculator.test.js NÃO podem mudar.
2. Cache da explicação: a explicação em match_ia_cache só vale se o percentual guardado for igual ao match
   calculado agora; se for diferente, gera de novo e substitui. Não altere a tabela.
3. Gap sem GitHub: montarGap passa a usar o mesmo identificador que getUserId(req) usa (github_id ?? user.id),
   para que contas sem GitHub com skills manuais tenham o gap calculado de verdade.
   Mostre o diff de montarGap antes de salvar.
4. Testes: match igual antes e depois; cache com percentual diferente → nova explicação;
   conta sem github_id com skills manuais → gap considera essas skills.
```

**Conferência:** `npm test` passa **sem alterar nenhum teste antigo de match**. Abra uma vaga como dev e a mesma vaga na visão da empresa: o percentual tem que ser igual. Mude uma skill, volte à vaga e confira que a explicação mudou junto.

**Commit:** `refactor(analise-perfil): fórmula do match única, cache e gap sem GitHub`

## Etapa 9 — Validação com perfis reais e deploy

Antes de publicar, compare o que o algoritmo detecta com a realidade em 10 perfis. É isso que mostra se os pesos +40/+20 fazem sentido.

**Gabarito (feito por você):** escolha 10 perfis públicos do GitHub, de colegas que autorizem, e monte um `docs/gabarito-skills.csv` com as colunas `github_login,skill,tem` (sim/não). Anote o que cada pessoa realmente usa.

```text
Leia docs/analise-perfil.md e docs/gabarito-skills.csv.

1. Crie scripts/avaliar-deteccao.js (só para desenvolvimento, não grava nada no banco):
   para cada github_login do gabarito, busca os repositórios públicos do próprio usuário
   (GET /users/{login}/repos?type=owner) com um token pessoal lido de GITHUB_TOKEN_DEV no .env,
   roda a MESMA função de pontuação do githubAnalyzer e compara com o gabarito.
   Saída: por skill, quantos acertos, falsos positivos (detectou e não tem) e falsos negativos (tem e não detectou).
2. Depois, faça a revisão final do branch (git diff main...feat/analise-perfil): arquivos existentes alterados
   e por quê, segredos, console.log esquecidos, texto sem escape nas views, npm test,
   e os comandos para rodar a migração em produção. NÃO faça merge nem push.
```

**Conferência:** leia o resultado da avaliação. Se uma skill tem muitos falsos positivos, revise os sinais dela no admin. Se tem muitos falsos negativos, faltam sinais. Rode a avaliação de novo até o resultado ficar aceitável para você.

**Deploy, nesta ordem:**

1. Faça backup do banco de produção.
2. Rode `npm run migrate:analise-perfil` no banco de produção. A tabela é nova e não afeta o site atual.
3. Faça o merge: `git checkout main && git merge feat/analise-perfil && git push`.
4. No Render, clique em **Manual Deploy** e acompanhe os logs.
5. No site publicado, entre com a sua conta, clique em Reanalisar e confira as skills e o "por quê?".

**Atenção:** o token do GitHub não fica guardado, então a fórmula nova só vale para cada usuário no próximo login ou Reanalisar. Até lá, ele continua vendo os números antigos. Vale um aviso no perfil: "Melhoramos a análise do seu perfil. Clique em Reanalisar para atualizar."

**Se o deploy quebrar:** no Render, use **Rollback**. A tabela nova pode ficar no banco.

**Depois do deploy:** atualize a aba principal deste documento (fórmula, exemplos, constantes e limitações resolvidas).

- [ ] Etapa 0 — Preparação
- [ ] Etapa 1 — Testes das fórmulas atuais
- [ ] Etapa 2 — Falha da API
- [ ] Etapa 3 — Projeto não verificável
- [ ] Etapa 4 — Palavra inteira e sinônimos
- [ ] Etapa 5 — Forks e dependências
- [ ] Etapa 6 — Evidências e repositórios escolhidos
- [ ] Etapa 7 — Autodiagnóstico
- [ ] Etapa 8 — Arrumação
- [ ] Etapa 9 — Validação e deploy
