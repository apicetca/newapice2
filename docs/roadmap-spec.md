# Sistema de Roadmap — Projeto Ápice

Especificação de funcionamento · 30/09/2026 · @Apice

## Visão geral

O roadmap do Ápice é uma trilha de estudos personalizada. A IA a gera a partir da diferença (gap) entre o perfil técnico do usuário e o que uma vaga ou área exige.

A trilha é dividida em fases. Cada fase tem etapas de estudo e termina num projeto prático publicado no GitHub. Esse projeto volta para a análise de repositórios, e o ciclo se fecha: estudar, construir, ser verificado e subir a compatibilidade com vagas.

Todas as decisões deste documento foram aprovadas em 30/09/2026.

## Fluxo do usuário

1. O usuário escolhe o objetivo: uma vaga (botão "Gerar roadmap para esta vaga") ou uma área.
2. O sistema monta o gap entre o perfil técnico (ou autodiagnóstico) e os requisitos do objetivo.
3. A IA gera o roadmap (fases → etapas → projeto prático); recursos vêm da tabela curada.
4. O usuário estuda e marca as etapas como concluídas.
5. Ao fim de cada fase, entrega o projeto prático (link do GitHub).
6. PRO: a análise de repositório verifica o projeto → fase verificada (ou volta com a lista do que falta). Free: a fase fecha com o selo "não verificada".

O ciclo de estudar, entregar o projeto e verificar se repete a cada fase. No PRO, um projeto não aprovado volta para a entrega com a lista do que falta. No Free, a fase fecha sem verificação.

## Entradas

O roadmap usa três entradas.

| Entrada | Origem | Se não existir |
| --- | --- | --- |
| Perfil técnico | Análise dos repositórios do GitHub (tabela `perfil_tecnico_ia`) | O usuário faz um autodiagnóstico rápido: marca as tecnologias que já usa e o nível de cada uma |
| Objetivo | Uma **vaga** (botão "Gerar roadmap para esta vaga", na tela de compatibilidade) **ou** uma **área**: Front-end, Back-end, Full-stack ou Dados | Obrigatório |
| Disponibilidade | Horas por semana: 5, 10 ou 20+ | Padrão: 10 h |

Quando o objetivo é uma vaga, os requisitos vêm da própria vaga. Quando é uma área, vêm de uma lista de habilidades de referência dessa área, mantida no sistema.

## Geração pela IA

A IA devolve **JSON estruturado**, nunca texto livre, e só escreve o conteúdo da trilha. Os links de estudo são escolhidos depois, na tabela de recursos.

- **Fases**: de 3 a 5. Cada uma tem nome e objetivo em uma linha.
- **Etapas**: de 3 a 6 por fase. Cada etapa traz título, descrição curta, a habilidade que resolve (ligada ao gap) e as horas estimadas.
- **Projeto prático**: um por fase, com enunciado e as habilidades que ele deve demonstrar no código.

A sequência de processamento é esta:

1. O servidor valida o JSON: formato, quantidade de fases e etapas, e habilidades existentes.
2. Se o JSON for inválido, o servidor pede uma nova geração uma vez.
3. Se falhar de novo, usa o **roadmap-modelo estático** da área. A página nunca fica vazia.
4. Para cada etapa, o sistema associa um recurso da tabela curada (próxima seção).
5. As horas das etapas, somadas e divididas pela disponibilidade semanal, dão a previsão de conclusão de cada fase.

## Recursos de estudo

Os links vêm de uma **tabela curada** mantida pela equipe do Ápice. A IA nunca escreve URLs. Isso evita links inventados ou quebrados.

- **Seed inicial**: cerca de 3 recursos para cada uma das ~20 habilidades mais comuns. A prioridade é para conteúdo em português e gratuito.
- **Escolha**: para cada etapa, o sistema filtra os recursos ativos da habilidade e ordena por nível compatível, depois idioma PT e depois gratuito.
- **Sem recurso cadastrado**: o site mostra um link de busca gerado a partir do tema da etapa. A habilidade entra numa lista de pendências para a equipe cadastrar recursos.
- **Manutenção**: um recurso quebrado é marcado como inativo e deixa de ser sugerido, sem precisar ser apagado.

## Progresso e verificação

O usuário marca as **etapas** como concluídas. A **fase** só fecha com o projeto prático.

- **Etapas**: os status são pendente, em andamento e concluída. O usuário muda o status com um clique e vê o percentual por fase e no total.
- **Projeto da fase (PRO)**: o usuário informa o link do repositório. A análise de repositório confere se as habilidades da fase aparecem no código.
  - Se aprovado, a fase fica **verificada** e o perfil técnico é atualizado.
  - Se ainda não aprovado, a fase continua aberta e o sistema mostra o que falta. Nunca aparece como reprovação.
- **Projeto da fase (Free)**: o projeto vale por autodeclaração. A fase fecha com o selo "não verificada".

## Regeneração

A regeneração **preserva as etapas concluídas** e refaz só o que falta.

- Serve para quando o gap muda, por exemplo depois de uma nova análise do GitHub ou de uma mudança de disponibilidade.
- Cada regeneração aumenta a `versao` do roadmap. As etapas antigas que ainda não foram concluídas são substituídas.
- O limite de regenerações depende do plano (próxima seção).

## Planos Free e PRO

| Recurso | Free | PRO |
| --- | --- | --- |
| Roadmaps ativos | 1 | até 5 |
| Regenerações | 1 por mês | 1 por semana |
| Objetivo por vaga ou área | sim | sim |
| Recursos da tabela curada | sim | sim |
| Verificação de projetos | não (fase fica "não verificada") | sim |
| Mentor usa o roadmap como contexto | não | sim |

O bloqueio usa o plano resolvido via `services/subscriptionService.js::getUserPlan()` (consulta `user_subscriptions` a cada chamada — o plano não fica guardado na sessão; `req.session.user` não carrega esse dado hoje, confirmado em `docs/roadmap-diagnostico.md`). Ao atingir um limite, o usuário vê uma mensagem clara com a opção de upgrade, nunca uma tela de erro.

## Integrações

- **Mentor de carreira (PRO)**: recebe o roadmap ativo e a etapa atual como contexto. Assim, ele responde perguntas como "estou travado na etapa X" sabendo onde o usuário está.
- **Compatibilidade com vagas**: na tela da vaga, mostra "sua compatibilidade sobe para ~Y% ao concluir este roadmap". O cálculo considera as habilidades do roadmap como se já estivessem adquiridas.
- **Análise de repositório**: é reaproveitada na verificação do projeto de cada fase. Quando um projeto é aprovado, o perfil técnico é atualizado.

## Modelo de dados

| Tabela | Colunas |
| --- | --- |
| `roadmaps` | id, usuario\_id, tipo\_objetivo (vaga/area), vaga\_id (nulo quando é área), area, horas\_semana, status (ativo/arquivado), versao, gerado\_em, origem (ia/modelo) |
| `roadmap_fases` | id, roadmap\_id, ordem, nome, objetivo, projeto\_enunciado, projeto\_repo\_url, projeto\_status (pendente/verificado/nao\_verificado/em\_revisao), verificado\_em |
| `roadmap_etapas` | id, fase\_id, ordem, titulo, descricao, habilidade, horas\_estimadas, recurso\_id (nulo quando usa busca), status (pendente/em\_andamento/concluida), concluida\_em |
| `recursos` | id, habilidade, titulo, url, tipo (doc/video/curso/exercicio), idioma, gratuito, nivel, ativo |
| `recursos_pendentes` | habilidade, vezes\_solicitada, ultima\_solicitacao |

Esta versão acrescenta a tabela `roadmap_fases` à proposta original. Ela guarda o projeto e a verificação de cada fase.

## Falhas e casos-limite

| Situação | Comportamento |
| --- | --- |
| IA fora do ar ou limite de uso excedido (erro 429) | Usa o roadmap-modelo da área e registra `origem = modelo`. Permite regenerar depois sem gastar o limite |
| JSON inválido duas vezes | Usa o roadmap-modelo da área |
| Usuário sem análise do GitHub | Faz o autodiagnóstico antes de gerar |
| Vaga removida ou encerrada | O roadmap continua ativo, com o aviso "vaga encerrada" e a sugestão de trocar para a área |
| Repositório privado ou link inválido | A fase continua aberta, com instruções para tornar o repositório público ou corrigir o link |
| Limite do plano atingido | Mostra uma mensagem com a data da próxima regeneração e a opção de upgrade |

Por LGPD, a IA recebe só as habilidades e os níveis do usuário. Nome, e-mail e currículo nunca são enviados.

## Decisões aprovadas e próximos passos

| Decisão | Escolha |
| --- | --- |
| Objetivo | Por vaga e por área (Front-end, Back-end, Full-stack, Dados) |
| Links de estudo | Opção (b): tabela curada, com busca como reserva |
| Progresso | Etapas autodeclaradas; projeto da fase verificado no PRO |
| Limites | Free: 1 roadmap e 1 regeneração por mês. PRO: até 5 roadmaps e 1 regeneração por semana |

- [ ] Montar o seed da tabela `recursos`, com cerca de 20 habilidades e 3 recursos em cada
- [ ] Escrever os roadmaps-modelo das 4 áreas
- [ ] Gerar o prompt de implementação para o Claude Code
