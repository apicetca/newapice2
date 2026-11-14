// ============================================
// services/relatorioDesempenho.js
// Relatório "Desempenho das vagas" (Admin → Relatórios).
//
// Definições (o banco não tem um status "preenchida"/"fechada"):
//   - vaga preenchida  = vaga ativa com ao menos um match aceito pela empresa;
//   - taxa de match    = matchs aceitos ÷ candidaturas no período (máx. 100%);
//   - tempo de fechamento = média de dias entre a criação e a saída do ar das
//     vagas pausadas no período (jobs.closed_at, preenchido a partir da
//     migração — vagas pausadas antes dela não entram na média);
//   - candidaturas, matchs e taxa de match seguem o período escolhido; vagas
//     ativas e taxa de preenchimento são o retrato de hoje.
// calcular() é pura; só carregarDados() fala com o banco.
// ============================================
const { resolverPeriodo, hojeSP } = require("./relatorioCrescimento");

const MS_DIA = 86400000;
const toDate = (iso) => new Date(`${iso}T00:00:00Z`);
const toIso = (d) => d.toISOString().slice(0, 10);
const addDays = (iso, n) => toIso(new Date(toDate(iso).getTime() + n * MS_DIA));
const diffDias = (a, b) => Math.round((toDate(b) - toDate(a)) / MS_DIA);

const AREAS = { "front-end": "Front-end", "back-end": "Back-end", "full-stack": "Full-stack", dados: "Dados" };
const NIVEIS = { estagio: "Estágio", junior: "Júnior", pleno: "Pleno" };

const arred1 = (n) => Math.round(n * 10) / 10;
const pct = (fim, ini) => (ini > 0 ? Math.round(((fim - ini) / ini) * 100) : null);

// soma n das linhas { job_id, d, n } com d no intervalo e job aceito pelo filtro
function somar(rows, from, to, jobIds) {
  return rows.reduce((s, r) => (r.d >= from && r.d <= to && (!jobIds || jobIds.has(r.job_id)) ? s + Number(r.n) : s), 0);
}

// dados: { jobs:[{id,title,company,level,area,active,created,closed}], candidaturas:[{job_id,d,n}], matchs:[{job_id,d,n}] }
function calcular(dados, { from, to }) {
  const { jobs, candidaturas, matchs } = dados;
  const dias = diffDias(from, to) + 1;
  const antesTo = addDays(from, -1), antesFrom = addDays(from, -dias);

  const ativas = jobs.filter(j => j.active);
  const comMatch = new Set(matchs.map(m => m.job_id)); // ao menos um aceito (histórico)
  const preenchidas = ativas.filter(j => comMatch.has(j.id)).length;

  const criadasAte = (iso) => jobs.filter(j => j.created <= iso).length;

  const cand = somar(candidaturas, from, to), candAntes = somar(candidaturas, antesFrom, antesTo);
  const mAcc = somar(matchs, from, to), mAccAntes = somar(matchs, antesFrom, antesTo);
  const taxa = (m, c) => (c > 0 ? arred1(Math.min((m / c) * 100, 100)) : null);
  const taxaAtual = taxa(mAcc, cand), taxaAntes = taxa(mAccAntes, candAntes);

  const fechadas = jobs.filter(j => !j.active && j.closed && j.created && j.closed >= from && j.closed <= to && Number.isFinite(diffDias(j.created, j.closed)));
  const tempoMedio = fechadas.length
    ? arred1(fechadas.reduce((s, j) => s + Math.max(diffDias(j.created, j.closed), 0), 0) / fechadas.length)
    : null;

  const chavesArea = [...Object.keys(AREAS), ...(jobs.some(j => !AREAS[j.area]) ? [null] : [])];
  const stacks = chavesArea.map(area => {
    const doGrupo = jobs.filter(j => (AREAS[j.area] ? j.area : null) === area);
    const ids = new Set(doGrupo.map(j => j.id));
    return {
      area: area ?? "nao-informada", label: area ? AREAS[area] : "Não informada",
      vagas: doGrupo.filter(j => j.active).length, candidaturas: somar(candidaturas, from, to, ids),
    };
  });

  const preenchimento = Object.keys(NIVEIS).map(level => {
    const doNivel = ativas.filter(j => j.level === level);
    const ok = doNivel.filter(j => comMatch.has(j.id)).length;
    return { level, label: NIVEIS[level], total: doNivel.length, preenchidas: ok,
      taxa: doNivel.length ? Math.round((ok / doNivel.length) * 100) : null };
  });

  const ranking = jobs
    .map(j => {
      const ids = new Set([j.id]);
      return { id: j.id, title: j.title, company: j.company, candidatos: somar(candidaturas, from, to, ids), matchs: somar(matchs, from, to, ids) };
    })
    .filter(j => j.candidatos > 0 || j.matchs > 0)
    .sort((a, b) => b.candidatos - a.candidatos || b.matchs - a.matchs || a.id - b.id)
    .slice(0, 10);

  return {
    periodo: { from, to },
    kpis: {
      vagas_ativas: { total: ativas.length, preenchidas, abertas: ativas.length - preenchidas,
        variacao_pct: pct(criadasAte(to), criadasAte(antesTo)) },
      candidatos_por_vaga: { media: ativas.length ? arred1(cand / ativas.length) : 0, total: cand, variacao_pct: pct(cand, candAntes) },
      taxa_match: { taxa: taxaAtual, variacao_pp: taxaAtual != null && taxaAntes != null ? arred1(taxaAtual - taxaAntes) : null },
      tempo_fechamento: { dias: tempoMedio, amostra: fechadas.length },
    },
    stacks, preenchimento, ranking,
  };
}

async function carregarDados(db) {
  const [jobs] = await db.query(`
    SELECT id, title, company, level, area, active,
           DATE_FORMAT(created_at, '%Y-%m-%d') AS created, DATE_FORMAT(closed_at, '%Y-%m-%d') AS closed
    FROM jobs`);
  const [candidaturas] = await db.query(`
    SELECT job_id, DATE_FORMAT(created_at, '%Y-%m-%d') AS d, COUNT(*) AS n
    FROM job_applications GROUP BY job_id, d`);
  const [matchs] = await db.query(`
    SELECT job_id, DATE_FORMAT(created_at, '%Y-%m-%d') AS d, COUNT(*) AS n
    FROM company_match_actions WHERE action = 'aceito' GROUP BY job_id, d`);
  return {
    jobs: jobs.map(j => ({ ...j, active: Boolean(j.active) })),
    candidaturas, matchs,
  };
}

async function gerar(db, query, hoje = hojeSP()) {
  const periodo = resolverPeriodo(query, hoje); // valida antes de tocar no banco
  return calcular(await carregarDados(db), periodo);
}

// ── Exportação (PDF/Excel via services/relatorioExport) ──
const dataBr = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const sinal = (v, suf) => (v == null ? "—" : `${v > 0 ? "+" : ""}${String(v).replace(".", ",")}${suf}`);
const num1 = (n) => (n == null ? "—" : String(n).replace(".", ","));

function paraExport(r) {
  const k = r.kpis;
  return {
    titulo: "Desempenho das vagas",
    descricao: "Vagas por categoria e modalidade.",
    periodo: `${dataBr(r.periodo.from)} a ${dataBr(r.periodo.to)}`,
    nota: "Vaga preenchida = vaga ativa com ao menos um match aceito. Taxa de match = matchs aceitos / candidaturas no período. Vagas ativas e taxa de preenchimento são o retrato de hoje.",
    secoes: [
      {
        titulo: "Indicadores", colunas: ["Indicador", "Valor", "Detalhe"], larguras: [0.3, 0.14, 0.56], esquerda: [2],
        linhas: [
          ["Total de vagas ativas", k.vagas_ativas.total, `${k.vagas_ativas.preenchidas} preenchidas / ${k.vagas_ativas.abertas} abertas · variação ${sinal(k.vagas_ativas.variacao_pct, "%")}`],
          ["Média de candidatos por vaga", num1(k.candidatos_por_vaga.media), `${k.candidatos_por_vaga.total} candidaturas · variação ${sinal(k.candidatos_por_vaga.variacao_pct, "%")}`],
          ["Taxa de match por vaga", k.taxa_match.taxa == null ? "—" : `${num1(k.taxa_match.taxa)}%`, `variação ${sinal(k.taxa_match.variacao_pp, " p.p.")}`],
          ["Tempo médio de fechamento", k.tempo_fechamento.dias == null ? "—" : `${num1(k.tempo_fechamento.dias)} dias`, `${k.tempo_fechamento.amostra} vaga(s) fechada(s) no período`],
        ],
      },
      { titulo: "Vagas e candidaturas por stack", colunas: ["Stack", "Vagas ativas", "Candidaturas"],
        linhas: r.stacks.map(s => [s.label, s.vagas, s.candidaturas]) },
      { titulo: "Taxa de preenchimento por nível", colunas: ["Nível", "Vagas ativas", "Preenchidas", "Taxa"],
        linhas: r.preenchimento.map(p => [p.label, p.total, p.preenchidas, p.taxa == null ? "—" : `${p.taxa}%`]) },
      { titulo: "Vagas com maior engajamento", colunas: ["Vaga", "Empresa", "Candidatos", "Matchs"],
        linhas: r.ranking.map(v => [v.title, v.company || "—", v.candidatos, v.matchs]) },
    ],
  };
}

const nomeArquivo = (r, ext) => `relatorio-desempenho-das-vagas_${r.periodo.from}_a_${r.periodo.to}.${ext}`;

module.exports = { calcular, carregarDados, gerar, paraExport, nomeArquivo, AREAS, NIVEIS };
