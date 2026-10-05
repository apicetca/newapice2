// ============================================
// services/roadmapService.js
// Núcleo do sistema de Roadmap (docs/roadmap-spec.md): monta o gap entre
// o perfil do usuário e um objetivo (vaga ou área), gera a trilha via IA
// (com fallback pro roadmap-modelo estático) e grava tudo no banco.
//
// Usa o client de IA já existente (services/geminiClient.js — Gemini com
// fallback multi-provedor embutido) — este arquivo não abre nenhuma
// conexão própria com IA nem com o banco além do pool/transação padrão
// do projeto (database/db.js).
//
// Sem rotas/controllers ainda — só o serviço. A próxima etapa expõe isso
// via routes/controllers.
// ============================================
const fs   = require("fs");
const path = require("path");
const db   = require("../database/db");
const { askGeminiJSON } = require("./geminiClient");

const HABILIDADES_REFERENCIA_PATH = path.join(__dirname, "..", "data", "habilidades-referencia.json");
const ROADMAPS_MODELO_DIR         = path.join(__dirname, "..", "data", "roadmaps-modelo");

const FASES_MIN  = 3;
const FASES_MAX  = 5;
const ETAPAS_MIN = 3;
const ETAPAS_MAX = 6;

// Mesma ordinalização usada em services/matchCalculator.js (NIVEL_ORDER) —
// duplicada aqui porque matchCalculator não exporta a constante; manter os
// dois em sincronia se a lista de níveis mudar algum dia.
const NIVEL_ORDER = { iniciante: 0, intermediario: 1, avancado: 2 };

// ──────────────────────────────────────────────────────────
// Leitura dos dados estáticos (data/*.json)
// ──────────────────────────────────────────────────────────

function carregarHabilidadesReferencia() {
  const bruto = fs.readFileSync(HABILIDADES_REFERENCIA_PATH, "utf8");
  return JSON.parse(bruto);
}

// Último recurso: se por algum motivo nenhuma área foi resolvida (nem
// informada, nem inferida), cai no modelo mais genérico disponível. Em uso
// normal, gerarRoadmap/regenerarRoadmap sempre resolvem uma área antes de
// chegar aqui (ver inferirAreaDaVaga) — isso é só uma rede de segurança.
function carregarRoadmapModelo(area) {
  const areaResolvida = area || "full-stack";
  const caminho = path.join(ROADMAPS_MODELO_DIR, `${areaResolvida}.json`);
  const bruto = fs.readFileSync(caminho, "utf8");
  const json = JSON.parse(bruto);
  json.origem = "modelo"; // garantido, independente do que o arquivo diga
  return json;
}

/**
 * jobs/job_skills não têm uma coluna de área (ver docs/roadmap-diagnostico.md)
 * — então, quando o objetivo é uma vaga, infere a área comparando as
 * habilidades da vaga (job_skills) com as listas de
 * data/habilidades-referencia.json. Escolhe a área com mais habilidades em
 * comum; empate entre áreas, ou nenhuma habilidade em comum, cai em
 * "full-stack". Não altera nenhum schema — é só uma heurística de leitura,
 * usada para escolher qual roadmap-modelo servir no fallback.
 */
async function inferirAreaDaVaga(vagaId) {
  const [jobSkills] = await db.query(
    `SELECT s.name AS habilidade
     FROM job_skills js
     JOIN skills s ON s.id = js.skill_id
     WHERE js.job_id = ?`,
    [vagaId]
  );
  const habilidadesDaVaga = new Set(jobSkills.map(r => r.habilidade));
  if (habilidadesDaVaga.size === 0) return "full-stack";

  const referencia = carregarHabilidadesReferencia();

  let melhorArea     = "full-stack";
  let melhorContagem = 0;
  let empatada       = false;

  for (const [area, lista] of Object.entries(referencia)) {
    if (!Array.isArray(lista)) continue; // ignora chaves de metadado, ex. "_comentario"
    const contagem = lista.reduce((acc, item) => acc + (habilidadesDaVaga.has(item.habilidade) ? 1 : 0), 0);
    if (contagem > melhorContagem) {
      melhorContagem = contagem;
      melhorArea     = area;
      empatada       = false;
    } else if (contagem === melhorContagem && contagem > 0) {
      empatada = true;
    }
  }

  if (melhorContagem === 0 || empatada) return "full-stack";
  return melhorArea;
}

// ──────────────────────────────────────────────────────────
// Gap: compara o que o usuário já sabe com o que o objetivo exige
// ──────────────────────────────────────────────────────────

// confidence (0-100, de user_skills) → nível aproximado. null = não tem a
// skill detectada/declarada ainda.
function confidenceToNivel(confidence) {
  if (!confidence || confidence <= 0) return null;
  if (confidence <= 40) return "iniciante";
  if (confidence <= 70) return "intermediario";
  return "avancado";
}

/**
 * Compara o perfil do usuário com os requisitos do objetivo (vaga ou área).
 *
 * "O que já sabe" vem de `user_skills` (detectado via GitHub ou marcado
 * manualmente — a mesma tabela que o roadmap atual já usa). `perfil_tecnico_ia`
 * não entra aqui: é texto livre (boas_praticas/pontos_melhoria), não dá pra
 * usar num cálculo de gap por habilidade/nível. Sem github_id (perfil não
 * conectado) e sem autodiagnóstico implementado ainda, o gap vira "precisa
 * aprender tudo" — equivalente ao caso que a spec descreve como
 * autodiagnóstico ainda não feito.
 */
async function montarGap(usuarioId, objetivo) {
  if (!objetivo || !["vaga", "area"].includes(objetivo.tipo)) {
    throw new Error("objetivo.tipo deve ser 'vaga' ou 'area'.");
  }

  const [devProfileRows] = await db.query(
    "SELECT github_id, nivel FROM user_dev_profiles WHERE user_id = ?",
    [usuarioId]
  );
  const githubId = devProfileRows[0]?.github_id ?? null;

  let userSkillMap = {};
  if (githubId) {
    const [rows] = await db.query(
      "SELECT skill_id, confidence FROM user_skills WHERE github_id = ?",
      [githubId]
    );
    for (const r of rows) userSkillMap[r.skill_id] = r.confidence;
  }

  if (objetivo.tipo === "vaga") {
    if (!objetivo.vagaId) throw new Error("objetivo.vagaId é obrigatório quando tipo='vaga'.");

    const [jobSkills] = await db.query(
      `SELECT js.skill_id, js.importance, s.name AS habilidade
       FROM job_skills js
       JOIN skills s ON s.id = js.skill_id
       WHERE js.job_id = ?
       ORDER BY js.importance DESC, js.learn_order`,
      [objetivo.vagaId]
    );

    const requisitos = jobSkills.map(js => {
      const confidence = userSkillMap[js.skill_id] ?? 0;
      return {
        habilidade:     js.habilidade,
        importancia:    js.importance,
        nivel_atual:    confidenceToNivel(confidence),
        // job_skills não guarda um nível esperado por skill (só o nível
        // geral da vaga, em jobs.level) — o gap aqui é binário: tem ou não.
        nivel_esperado: null,
        tem_gap:        confidence <= 0,
      };
    });

    return { tipo: "vaga", vagaId: objetivo.vagaId, area: objetivo.area ?? null, requisitos };
  }

  // tipo === "area"
  const referencia = carregarHabilidadesReferencia();
  const lista = referencia[objetivo.area];
  if (!lista) {
    throw new Error(`Área desconhecida: "${objetivo.area}". Use uma de: ${Object.keys(referencia).join(", ")}.`);
  }

  const [skillRows] = await db.query("SELECT id, name FROM skills");
  const skillIdByName = {};
  for (const s of skillRows) skillIdByName[s.name] = s.id;

  const requisitos = lista.map(req => {
    const skillId     = skillIdByName[req.habilidade];
    const confidence  = skillId != null ? (userSkillMap[skillId] ?? 0) : 0;
    const nivelAtual  = confidenceToNivel(confidence);
    const temGap      = nivelAtual == null || NIVEL_ORDER[nivelAtual] < NIVEL_ORDER[req.nivel_esperado];
    return {
      habilidade:     req.habilidade,
      nivel_atual:    nivelAtual,
      nivel_esperado: req.nivel_esperado,
      tem_gap:        temGap,
    };
  });

  return { tipo: "area", area: objetivo.area, requisitos };
}

// ──────────────────────────────────────────────────────────
// Geração via IA (JSON estruturado) + validação + fallback
// ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Você é um gerador de trilhas de estudo técnicas (roadmaps de carreira).
Responda SEMPRE em JSON puro (sem markdown, sem texto fora do JSON), no formato exato:
{
  "fases": [
    {
      "nome": "string curta",
      "objetivo": "string em uma frase",
      "etapas": [
        { "titulo": "string", "descricao": "string curta", "habilidade": "string", "horas_estimadas": <inteiro positivo> }
      ],
      "projeto": { "enunciado": "string", "habilidades": ["string", "..."] }
    }
  ]
}
Regras obrigatórias: entre 3 e 5 fases; entre 3 e 6 etapas por fase; cada fase tem exatamente
1 projeto prático; nunca inclua URLs ou links (os recursos de estudo são escolhidos por outro
sistema, a partir de uma tabela curada); use preferencialmente as habilidades informadas no gap.`;

function montarPromptGap(gap, horasSemana) {
  // LGPD: só habilidade/nível entram aqui — nunca nome, e-mail, currículo
  // ou qualquer outro dado pessoal do usuário.
  const requisitos = gap.requisitos.map(r => ({
    habilidade:     r.habilidade,
    nivel_atual:    r.nivel_atual,
    nivel_esperado: r.nivel_esperado,
    tem_gap:        r.tem_gap,
  }));
  const objetivoDescricao = gap.tipo === "area"
    ? `a área de ${gap.area}`
    : `uma vaga específica (id interno ${gap.vagaId})`;

  return `Gere uma trilha de estudo para ${objetivoDescricao}, com disponibilidade de `
       + `${horasSemana}h/semana.\nGap de habilidades do candidato:\n${JSON.stringify(requisitos)}`;
}

function isStringNaoVazia(v) {
  return typeof v === "string" && v.trim().length > 0;
}

/** Validação manual do JSON devolvido pela IA (zod não é dependência do projeto). */
function validarEstruturaRoadmap(json) {
  if (!json || typeof json !== "object" || !Array.isArray(json.fases)) {
    return { valido: false, erro: "campo 'fases' ausente ou não é um array." };
  }
  if (json.fases.length < FASES_MIN || json.fases.length > FASES_MAX) {
    return { valido: false, erro: `esperado entre ${FASES_MIN} e ${FASES_MAX} fases, recebido ${json.fases.length}.` };
  }

  for (let i = 0; i < json.fases.length; i++) {
    const fase = json.fases[i];
    const p = `fases[${i}]`;

    if (!isStringNaoVazia(fase?.nome))     return { valido: false, erro: `${p}.nome ausente ou vazio.` };
    if (!isStringNaoVazia(fase?.objetivo)) return { valido: false, erro: `${p}.objetivo ausente ou vazio.` };

    if (!Array.isArray(fase.etapas) || fase.etapas.length < ETAPAS_MIN || fase.etapas.length > ETAPAS_MAX) {
      return { valido: false, erro: `${p}.etapas deve ter entre ${ETAPAS_MIN} e ${ETAPAS_MAX} itens.` };
    }

    for (let j = 0; j < fase.etapas.length; j++) {
      const etapa = fase.etapas[j];
      const p2 = `${p}.etapas[${j}]`;
      if (!isStringNaoVazia(etapa?.titulo))     return { valido: false, erro: `${p2}.titulo ausente ou vazio.` };
      if (!isStringNaoVazia(etapa?.descricao))  return { valido: false, erro: `${p2}.descricao ausente ou vazio.` };
      if (!isStringNaoVazia(etapa?.habilidade)) return { valido: false, erro: `${p2}.habilidade ausente ou vazia.` };
      if (!Number.isFinite(etapa?.horas_estimadas) || etapa.horas_estimadas <= 0) {
        return { valido: false, erro: `${p2}.horas_estimadas deve ser um número positivo.` };
      }
    }

    if (!fase.projeto || typeof fase.projeto !== "object") {
      return { valido: false, erro: `${p}.projeto ausente.` };
    }
    if (!isStringNaoVazia(fase.projeto.enunciado)) {
      return { valido: false, erro: `${p}.projeto.enunciado ausente ou vazio.` };
    }
    if (!Array.isArray(fase.projeto.habilidades) || fase.projeto.habilidades.length === 0
        || !fase.projeto.habilidades.every(isStringNaoVazia)) {
      return { valido: false, erro: `${p}.projeto.habilidades deve ser um array não vazio de strings.` };
    }
  }

  return { valido: true };
}

// Erros de "a IA respondeu, mas o JSON não é o que pedimos" valem uma nova
// tentativa (a própria askGeminiJSON já lança essa mensagem quando nem o
// Gemini nem o fallback multi-provedor conseguem devolver JSON parseável).
// Qualquer outro erro — 429, timeout, indisponibilidade — vai direto pro
// roadmap-modelo: insistir numa chamada que já falhou por cota/rede só
// atrasa a resposta sem chance real de sucesso.
function classificarErroIA(err) {
  const msg = err?.message || String(err);
  if (/JSON inv[aá]lid|n[ãa]o (veio|retornou) em JSON|resposta vazia|n[ãa]o cont[eé]m JSON/i.test(msg)) {
    return "json_invalido";
  }
  return "indisponivel";
}

async function chamarIA(gap, horasSemana) {
  return askGeminiJSON({
    system: SYSTEM_PROMPT,
    prompt: montarPromptGap(gap, horasSemana),
    maxTokens: 4096,
  });
}

/**
 * Gera o conteúdo da trilha (fases/etapas/projetos), sem gravar nada ainda.
 * Até 2 tentativas na IA (a 2ª só quando a 1ª devolveu um JSON que não
 * passou a validação de estrutura) — qualquer erro de chamada (429,
 * timeout, fora do ar) interrompe as tentativas e cai direto no modelo.
 */
async function gerarConteudoRoadmap(gap, horasSemana, area) {
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      const resultado = await chamarIA(gap, horasSemana);
      const validacao = validarEstruturaRoadmap(resultado);
      if (validacao.valido) {
        return { conteudo: resultado, origem: "ia" };
      }
      console.error(`[roadmapService] JSON da IA inválido na tentativa ${tentativa}: ${validacao.erro}`);
    } catch (err) {
      const tipo = classificarErroIA(err);
      console.error(`[roadmapService] Falha ao chamar a IA na tentativa ${tentativa} (${tipo}): ${err.message}`);
      if (tipo === "indisponivel") break; // sem retry — cai direto pro modelo
    }
  }

  return { conteudo: carregarRoadmapModelo(area), origem: "modelo" };
}

// ──────────────────────────────────────────────────────────
// Associação de recursos (tabela `recursos`) + recursos_pendentes
// ──────────────────────────────────────────────────────────

/**
 * Escolhe o recurso ativo mais adequado para uma habilidade: nível
 * compatível com o nível atual do usuário nessa habilidade, depois
 * idioma pt, depois gratuito. Sem nenhum recurso ativo cadastrado,
 * registra/incrementa `recursos_pendentes` e devolve null.
 */
async function escolherRecurso(executor, habilidade, nivelAtual) {
  const nivelBusca = nivelAtual || "iniciante";

  const [rows] = await executor.query(
    `SELECT id FROM recursos
     WHERE habilidade = ? AND ativo = 1
     ORDER BY (nivel = ?) DESC, (idioma = 'pt') DESC, gratuito DESC, id ASC
     LIMIT 1`,
    [habilidade, nivelBusca]
  );
  if (rows.length) return rows[0].id;

  await executor.query(
    `INSERT INTO recursos_pendentes (habilidade, vezes_solicitada, ultima_solicitacao)
     VALUES (?, 1, NOW())
     ON DUPLICATE KEY UPDATE
       vezes_solicitada   = vezes_solicitada + 1,
       ultima_solicitacao = NOW()`,
    [habilidade]
  );
  return null;
}

// ──────────────────────────────────────────────────────────
// Persistência (transação única: roadmaps + roadmap_fases + roadmap_etapas)
// ──────────────────────────────────────────────────────────

/**
 * Grava fases/etapas de um roadmap já existente, na conexão/transação
 * `executor` passada pelo chamador. `etapasConcluidasPorHabilidade` (usado
 * pela regeneração) preserva status/concluida_em de etapas já finalizadas
 * cuja habilidade reaparece na trilha nova.
 */
async function salvarFasesEEtapas(executor, roadmapId, fases, etapasConcluidasPorHabilidade = {}) {
  const fasesSalvas = [];

  for (let i = 0; i < fases.length; i++) {
    const fase = fases[i];
    const [faseResult] = await executor.query(
      `INSERT INTO roadmap_fases (roadmap_id, ordem, nome, objetivo, projeto_enunciado, projeto_status)
       VALUES (?, ?, ?, ?, ?, 'pendente')`,
      [roadmapId, i + 1, fase.nome, fase.objetivo, fase.projeto.enunciado]
    );
    const faseId = faseResult.insertId;

    const etapasSalvas = [];
    for (let j = 0; j < fase.etapas.length; j++) {
      const etapa = fase.etapas[j];
      const recursoId = await escolherRecurso(executor, etapa.habilidade, etapa.nivel_atual ?? null);

      const concluida    = etapasConcluidasPorHabilidade[etapa.habilidade];
      const status        = concluida ? "concluida" : "pendente";
      const concluidaEm   = concluida ? concluida.concluida_em : null;

      const [etapaResult] = await executor.query(
        `INSERT INTO roadmap_etapas
           (fase_id, ordem, titulo, descricao, habilidade, horas_estimadas, recurso_id, status, concluida_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [faseId, j + 1, etapa.titulo, etapa.descricao, etapa.habilidade, etapa.horas_estimadas, recursoId, status, concluidaEm]
      );

      etapasSalvas.push({
        id: etapaResult.insertId,
        titulo: etapa.titulo,
        descricao: etapa.descricao,
        habilidade: etapa.habilidade,
        horas_estimadas: etapa.horas_estimadas,
        recurso_id: recursoId,
        status,
        concluida_em: concluidaEm,
      });
    }

    fasesSalvas.push({
      id: faseId,
      nome: fase.nome,
      objetivo: fase.objetivo,
      projeto: fase.projeto,
      etapas: etapasSalvas,
    });
  }

  return fasesSalvas;
}

/**
 * Monta o gap, gera a trilha (IA ou modelo) e grava roadmap + fases +
 * etapas numa única transação. objetivo = { tipo: 'vaga'|'area', vagaId?,
 * area? } — `area` é opcional quando tipo='vaga' (serve só de dica pro
 * fallback estático, já que jobs/job_skills não têm uma coluna de área).
 */
async function gerarRoadmap(usuarioId, objetivo, horasSemana) {
  const gap  = await montarGap(usuarioId, objetivo);
  const area = objetivo.tipo === "area"
    ? objetivo.area
    : (objetivo.area ?? await inferirAreaDaVaga(objetivo.vagaId));

  const { conteudo, origem } = await gerarConteudoRoadmap(gap, horasSemana, area);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [roadmapResult] = await conn.query(
      `INSERT INTO roadmaps (usuario_id, tipo_objetivo, vaga_id, area, horas_semana, status, versao, origem)
       VALUES (?, ?, ?, ?, ?, 'ativo', 1, ?)`,
      [
        usuarioId,
        objetivo.tipo,
        objetivo.tipo === "vaga" ? objetivo.vagaId : null,
        area,
        horasSemana,
        origem,
      ]
    );
    const roadmapId = roadmapResult.insertId;

    const fasesSalvas = await salvarFasesEEtapas(conn, roadmapId, conteudo.fases);

    await conn.commit();
    return { roadmapId, origem, versao: 1, fases: fasesSalvas };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Regenera um roadmap existente: refaz o gap (perfil pode ter mudado),
 * gera uma trilha nova (IA ou modelo), preserva etapas já concluídas
 * (casadas por nome de habilidade) e substitui o resto. versao + 1.
 * `novaHorasSemana` é opcional — sem ela, mantém a disponibilidade atual
 * do roadmap.
 */
async function regenerarRoadmap(roadmapId, novaHorasSemana) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [roadmapRows] = await conn.query("SELECT * FROM roadmaps WHERE id = ?", [roadmapId]);
    const roadmap = roadmapRows[0];
    if (!roadmap) throw new Error(`Roadmap ${roadmapId} não encontrado.`);

    const horasSemana = novaHorasSemana ?? roadmap.horas_semana;

    const [etapasAntigas] = await conn.query(
      `SELECT re.habilidade, re.concluida_em
       FROM roadmap_etapas re
       JOIN roadmap_fases rf ON rf.id = re.fase_id
       WHERE rf.roadmap_id = ? AND re.status = 'concluida'`,
      [roadmapId]
    );
    const concluidasPorHabilidade = {};
    for (const e of etapasAntigas) concluidasPorHabilidade[e.habilidade] = { concluida_em: e.concluida_em };

    // roadmap.area já deveria estar resolvido desde a criação (gerarRoadmap
    // persiste a área inferida mesmo pra objetivo=vaga) — recalcula só como
    // rede de segurança para roadmaps antigos criados antes dessa inferência.
    const area = roadmap.tipo_objetivo === "area"
      ? roadmap.area
      : (roadmap.area || await inferirAreaDaVaga(roadmap.vaga_id));

    const objetivo = { tipo: roadmap.tipo_objetivo, vagaId: roadmap.vaga_id, area };
    const gap = await montarGap(roadmap.usuario_id, objetivo);
    const { conteudo, origem } = await gerarConteudoRoadmap(gap, horasSemana, area);

    // ON DELETE CASCADE de roadmap_fases já leva roadmap_etapas junto.
    await conn.query("DELETE FROM roadmap_fases WHERE roadmap_id = ?", [roadmapId]);

    const novaVersao = roadmap.versao + 1;
    // gerado_em sempre reflete quando o conteúdo foi de fato (re)gerado —
    // mesmo quando cai no modelo, é real que a tentativa aconteceu agora.
    // "Fallback não conta no limite" é aplicado só em middlewares/
    // roadmapLimites.js (checando roadmaps.origem), não aqui: a data
    // mostrada ao usuário precisa ser verdadeira independente da regra de
    // limite, senão a UI mentiria sobre quando o roadmap foi gerado.
    await conn.query(
      `UPDATE roadmaps SET horas_semana = ?, versao = ?, origem = ?, gerado_em = NOW() WHERE id = ?`,
      [horasSemana, novaVersao, origem, roadmapId]
    );

    const fasesSalvas = await salvarFasesEEtapas(conn, roadmapId, conteudo.fases, concluidasPorHabilidade);

    await conn.commit();
    return { roadmapId, origem, versao: novaVersao, fases: fasesSalvas };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  montarGap,
  gerarRoadmap,
  regenerarRoadmap,
  inferirAreaDaVaga,
  // Exportados à parte para facilitar teste unitário isolado (sem precisar
  // passar pela transação inteira pra validar só a estrutura do JSON).
  validarEstruturaRoadmap,
  classificarErroIA,
};
