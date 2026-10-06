// ============================================
// controllers/trilhaController.js
// Sistema de Roadmap novo (fases/etapas via IA — docs/roadmap-spec.md),
// montado em /trilha pra não colidir com o roadmap antigo (gap de skills
// por vaga, já em produção em /roadmap e routes/roadmap.js — ver
// docs/roadmap-diagnostico.md).
// ============================================
const db = require("../database/db");
const { gerarRoadmap, regenerarRoadmap } = require("../services/roadmapService");

const STATUS_ETAPA_VALIDOS = ["pendente", "em_andamento", "concluida"];

const AREA_LABELS = {
  "front-end":  "Front-end",
  "back-end":   "Back-end",
  "full-stack": "Full-stack",
  "dados":      "Dados",
};

function objetivoLabel(roadmap) {
  if (roadmap.tipo_objetivo === "area") return AREA_LABELS[roadmap.area] ?? roadmap.area;
  return roadmap.vaga_title ? `Vaga: ${roadmap.vaga_title}` : `Vaga #${roadmap.vaga_id}`;
}

/**
 * Carrega o roadmap do :id da rota, já filtrado pelo usuário logado — uma
 * linha não encontrada (não existe OU é de outro usuário) vira 404 sem
 * distinção, pra não revelar a um usuário que o id pertence a outra conta.
 * Middleware: usado em toda rota com :id; deixa o roadmap em req.roadmap.
 */
async function carregarRoadmap(req, res, next) {
  const roadmapId = Number(req.params.id);
  if (!Number.isInteger(roadmapId) || roadmapId <= 0) {
    return res.status(404).render("404");
  }

  try {
    const [rows] = await db.query(
      "SELECT * FROM roadmaps WHERE id = ? AND usuario_id = ?",
      [roadmapId, req.session.user.id]
    );
    if (!rows.length) return res.status(404).render("404");
    req.roadmap = rows[0];
    next();
  } catch (err) {
    console.error("[carregarRoadmap]", err.message);
    res.status(500).render("500");
  }
}

/** GET /trilha — lista os roadmaps do usuário logado. */
async function listar(req, res) {
  try {
    const [roadmaps] = await db.query(
      `SELECT r.*, j.title AS vaga_title,
              COALESCE(t.total, 0)     AS total_etapas,
              COALESCE(c.concluidas, 0) AS etapas_concluidas
       FROM roadmaps r
       LEFT JOIN jobs j ON j.id = r.vaga_id
       LEFT JOIN (
         SELECT rf.roadmap_id, COUNT(*) AS total
         FROM roadmap_etapas re JOIN roadmap_fases rf ON rf.id = re.fase_id
         GROUP BY rf.roadmap_id
       ) t ON t.roadmap_id = r.id
       LEFT JOIN (
         SELECT rf.roadmap_id, COUNT(*) AS concluidas
         FROM roadmap_etapas re JOIN roadmap_fases rf ON rf.id = re.fase_id
         WHERE re.status = 'concluida'
         GROUP BY rf.roadmap_id
       ) c ON c.roadmap_id = r.id
       WHERE r.usuario_id = ?
       ORDER BY (r.status = 'ativo') DESC, r.gerado_em DESC`,
      [req.session.user.id]
    );

    const roadmapsComPct = roadmaps.map(r => ({
      ...r,
      label: objetivoLabel(r),
      pct: r.total_etapas > 0 ? Math.round((r.etapas_concluidas / r.total_etapas) * 100) : 0,
    }));

    res.render("roadmap/index", { currentPage: "trilha", roadmaps: roadmapsComPct });
  } catch (err) {
    console.error("[GET /trilha]", err.message);
    res.status(500).render("500");
  }
}

/** GET /trilha/novo — formulário de criação. */
async function formularioNovo(req, res) {
  try {
    const [[perfil]] = await db.query(
      "SELECT id FROM perfil_tecnico_ia WHERE user_id = ?",
      [req.session.user.id]
    );
    const [vagas] = await db.query(
      "SELECT id, title, company FROM jobs WHERE active = 1 ORDER BY title LIMIT 200"
    );

    res.render("roadmap/novo", {
      currentPage: "trilha",
      temPerfilTecnico: Boolean(perfil),
      vagas,
      areas: AREA_LABELS,
      prefill: {
        tipo:  req.query.tipo === "vaga" ? "vaga" : "area",
        area:  req.query.area ?? "front-end",
        vagaId: req.query.vagaId ? Number(req.query.vagaId) : null,
      },
      erro: null,
    });
  } catch (err) {
    console.error("[GET /trilha/novo]", err.message);
    res.status(500).render("500");
  }
}

/** POST /trilha — gera um roadmap novo. */
async function criar(req, res) {
  const { tipo, area, vagaId, horasSemana } = req.body ?? {};

  if (tipo !== "area" && tipo !== "vaga") {
    return res.status(400).render("roadmap/novo", {
      currentPage: "trilha", temPerfilTecnico: true, vagas: [], areas: AREA_LABELS,
      prefill: { tipo: "area", area: "front-end", vagaId: null },
      erro: "Escolha um objetivo: área ou vaga.",
    });
  }

  const objetivo = tipo === "area"
    ? { tipo: "area", area }
    : { tipo: "vaga", vagaId: Number(vagaId) };
  const horas = Number(horasSemana) || 10;

  try {
    const resultado = await gerarRoadmap(req.session.user.id, objetivo, horas);
    res.redirect(`/trilha/${resultado.roadmapId}`);
  } catch (err) {
    console.error("[POST /trilha]", err.message);
    const [[perfil]] = await db.query(
      "SELECT id FROM perfil_tecnico_ia WHERE user_id = ?", [req.session.user.id]
    );
    const [vagas] = await db.query(
      "SELECT id, title, company FROM jobs WHERE active = 1 ORDER BY title LIMIT 200"
    );
    res.status(400).render("roadmap/novo", {
      currentPage: "trilha",
      temPerfilTecnico: Boolean(perfil),
      vagas,
      areas: AREA_LABELS,
      prefill: { tipo, area: area ?? "front-end", vagaId: vagaId ? Number(vagaId) : null },
      erro: `Não foi possível gerar o roadmap: ${err.message}`,
    });
  }
}

/** GET /trilha/:id — detalhe. Espera req.roadmap (carregarRoadmap). */
async function detalhe(req, res) {
  const roadmap = req.roadmap;
  try {
    let job = null;
    if (roadmap.tipo_objetivo === "vaga" && roadmap.vaga_id) {
      const [rows] = await db.query("SELECT title, active FROM jobs WHERE id = ?", [roadmap.vaga_id]);
      job = rows[0] ?? null;
    }

    const [fases] = await db.query(
      "SELECT * FROM roadmap_fases WHERE roadmap_id = ? ORDER BY ordem",
      [roadmap.id]
    );
    const [etapas] = await db.query(
      `SELECT re.*, rec.titulo AS recurso_titulo, rec.url AS recurso_url
       FROM roadmap_etapas re
       JOIN roadmap_fases rf   ON rf.id = re.fase_id
       LEFT JOIN recursos rec ON rec.id = re.recurso_id
       WHERE rf.roadmap_id = ?
       ORDER BY rf.ordem, re.ordem`,
      [roadmap.id]
    );

    const etapasPorFase = {};
    for (const e of etapas) (etapasPorFase[e.fase_id] ??= []).push(e);

    let totalEtapas = 0, etapasConcluidas = 0, horasRestantes = 0;
    const fasesComEtapas = fases.map(f => {
      const etapasDaFase = etapasPorFase[f.id] ?? [];
      const concluidasFase = etapasDaFase.filter(e => e.status === "concluida").length;
      totalEtapas += etapasDaFase.length;
      etapasConcluidas += concluidasFase;
      horasRestantes += etapasDaFase
        .filter(e => e.status !== "concluida")
        .reduce((soma, e) => soma + Number(e.horas_estimadas), 0);

      return {
        ...f,
        etapas: etapasDaFase,
        pct: etapasDaFase.length ? Math.round((concluidasFase / etapasDaFase.length) * 100) : 0,
      };
    });

    const pctTotal = totalEtapas ? Math.round((etapasConcluidas / totalEtapas) * 100) : 0;
    const semanasRestantes = roadmap.horas_semana > 0 ? Math.ceil(horasRestantes / roadmap.horas_semana) : null;

    res.render("roadmap/detalhe", {
      currentPage: "trilha",
      roadmap,
      job,
      label: objetivoLabel({ ...roadmap, vaga_title: job?.title }),
      fases: fasesComEtapas,
      pctTotal,
      semanasRestantes,
    });
  } catch (err) {
    console.error("[GET /trilha/:id]", err.message);
    res.status(500).render("500");
  }
}

/** POST /trilha/:id/etapas/:etapaId — muda o status de uma etapa (responde JSON). */
async function atualizarEtapa(req, res) {
  const roadmap = req.roadmap;
  const etapaId = Number(req.params.etapaId);
  const { status } = req.body ?? {};

  if (!Number.isInteger(etapaId) || etapaId <= 0) {
    return res.status(404).json({ error: "Etapa não encontrada." });
  }
  if (!STATUS_ETAPA_VALIDOS.includes(status)) {
    return res.status(400).json({ error: `Status inválido. Use: ${STATUS_ETAPA_VALIDOS.join(", ")}.` });
  }

  try {
    const concluidaEm = status === "concluida" ? new Date() : null;
    const [result] = await db.query(
      `UPDATE roadmap_etapas re
       JOIN roadmap_fases rf ON rf.id = re.fase_id
       SET re.status = ?, re.concluida_em = ?
       WHERE re.id = ? AND rf.roadmap_id = ?`,
      [status, concluidaEm, etapaId, roadmap.id]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ error: "Etapa não encontrada neste roadmap." });
    }
    res.json({ success: true, status, concluida_em: concluidaEm });
  } catch (err) {
    console.error("[POST /trilha/:id/etapas/:etapaId]", err.message);
    res.status(500).json({ error: "Erro interno. Tente novamente." });
  }
}

/** POST /trilha/:id/regenerar — espera req.roadmap (carregarRoadmap) + limite já checado. */
async function regenerar(req, res) {
  const roadmap = req.roadmap;
  try {
    await regenerarRoadmap(roadmap.id);
    res.redirect(`/trilha/${roadmap.id}`);
  } catch (err) {
    console.error("[POST /trilha/:id/regenerar]", err.message);
    res.status(400).type("text/plain").send(`Não foi possível regenerar o roadmap: ${err.message}`);
  }
}

/** POST /trilha/:id/arquivar — espera req.roadmap (carregarRoadmap). */
async function arquivar(req, res) {
  const roadmap = req.roadmap;
  try {
    await db.query("UPDATE roadmaps SET status = 'arquivado' WHERE id = ?", [roadmap.id]);
    res.redirect("/trilha");
  } catch (err) {
    console.error("[POST /trilha/:id/arquivar]", err.message);
    res.status(500).render("500");
  }
}

module.exports = {
  carregarRoadmap,
  listar,
  formularioNovo,
  criar,
  detalhe,
  atualizarEtapa,
  regenerar,
  arquivar,
};
