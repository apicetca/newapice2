// ============================================
// services/relatorioEmpresas.js
// Relatório "Atividade das empresas" (Admin → Relatórios).
//
// Definições:
//   - empresas ativas  = contas de empresa não suspensas hoje (FREE/PRO pelo plano atual);
//     a variação compara a base de contas ao fim e ao início do período;
//   - vagas publicadas = vagas criadas no período (com a divisão por modalidade);
//   - candidaturas     = candidaturas recebidas no período;
//   - conexões         = matchs aceitos pelas empresas no período; a média divide
//     pelas empresas ativas;
//   - ranking          = empresas com vagas publicadas, matchs ou candidaturas no
//     período, ordenadas por vagas publicadas, depois matchs e candidaturas.
// Os números de período são comparados com o período anterior de mesmo tamanho.
// calcular() é pura; só carregarDados() fala com o banco.
// ============================================
const { MP_ACCESS_CONDITION, ANNUAL_ACCESS_CONDITION } = require("./subscriptionService");
const { resolverPeriodo, hojeSP } = require("./relatorioCrescimento");

const MS_DIA = 86400000;
const toDate = (iso) => new Date(`${iso}T00:00:00Z`);
const toIso = (d) => d.toISOString().slice(0, 10);
const addDays = (iso, n) => toIso(new Date(toDate(iso).getTime() + n * MS_DIA));
const diffDias = (a, b) => Math.round((toDate(b) - toDate(a)) / MS_DIA);

const arred1 = (n) => Math.round(n * 10) / 10;
const pct = (fim, ini) => (ini > 0 ? Math.round(((fim - ini) / ini) * 100) : null);
const nomeDe = (e) => e.nome_fantasia || e.razao_social || "Empresa";

// dados: { empresas:[{id,active,created,nome_fantasia,razao_social,cnpj}], proIds:[id],
//          jobs:[{id,company_id,modality,created}], candidaturas:[{job_id,d,n}], matchs:[{company_id,d,n}] }
function calcular(dados, { from, to }) {
  const dias = diffDias(from, to) + 1;
  const antesTo = addDays(from, -1), antesFrom = addDays(from, -dias);
  const noPeriodo = (d, f, t) => d >= f && d <= t;

  const pro = new Set(dados.proIds);
  const ativas = dados.empresas.filter(e => e.active);
  const proAtivas = ativas.filter(e => pro.has(e.id)).length;
  const base = (ate) => dados.empresas.filter(e => e.created <= ate).length;

  const jobDe = new Map(dados.jobs.map(j => [j.id, j]));
  const vagas = (f, t) => dados.jobs.filter(j => noPeriodo(j.created, f, t));
  const vAtual = vagas(from, to), vAnt = vagas(antesFrom, antesTo);
  const modal = (lista, m) => lista.filter(j => j.modality === m).length;

  const candEm = (f, t) => dados.candidaturas.filter(c => noPeriodo(c.d, f, t) && jobDe.has(c.job_id));
  const somaN = (rows) => rows.reduce((s, r) => s + Number(r.n), 0);
  const cAtual = candEm(from, to), cAnt = candEm(antesFrom, antesTo);

  const matchsEm = (f, t) => dados.matchs.filter(m => noPeriodo(m.d, f, t));
  const mAtual = matchsEm(from, to), mAnt = matchsEm(antesFrom, antesTo);

  // por empresa (período atual)
  const porEmpresa = new Map(dados.empresas.map(e => [e.id, { id: e.id, nome: nomeDe(e), cnpj: e.cnpj ?? null, plano: pro.has(e.id) ? "PRO" : "FREE", vagas: 0, matchs: 0, candidaturas: 0 }]));
  for (const j of vAtual) { const e = porEmpresa.get(j.company_id); if (e) e.vagas++; }
  for (const m of mAtual) { const e = porEmpresa.get(m.company_id); if (e) e.matchs += Number(m.n); }
  for (const c of cAtual) { const e = porEmpresa.get(jobDe.get(c.job_id).company_id); if (e) e.candidaturas += Number(c.n); }
  const comAtividade = [...porEmpresa.values()].filter(e => e.vagas || e.matchs || e.candidaturas);

  const grafico = comAtividade.filter(e => e.candidaturas > 0)
    .sort((a, b) => b.candidaturas - a.candidaturas || a.id - b.id).slice(0, 6)
    .map(e => ({ id: e.id, nome: e.nome, candidaturas: e.candidaturas, vagas: e.vagas }));

  const ranking = comAtividade
    .sort((a, b) => b.vagas - a.vagas || b.matchs - a.matchs || b.candidaturas - a.candidaturas || a.id - b.id)
    .slice(0, 10);

  const media = (matchs) => (ativas.length ? arred1(matchs / ativas.length) : 0);
  const totalM = somaN(mAtual);

  return {
    periodo: { from, to },
    kpis: {
      empresas: { total: ativas.length, pro: proAtivas, free: ativas.length - proAtivas, variacao_pct: pct(base(to), base(antesTo)) },
      vagas: { total: vAtual.length, presenciais: modal(vAtual, "presencial"), hibridas: modal(vAtual, "hibrido"), remotas: modal(vAtual, "remoto"),
        variacao_pct: pct(vAtual.length, vAnt.length) },
      candidaturas: { total: somaN(cAtual), variacao_pct: pct(somaN(cAtual), somaN(cAnt)) },
      conexoes: { media: media(totalM), total: totalM, variacao_pct: pct(totalM, somaN(mAnt)) },
    },
    grafico, ranking,
  };
}

async function carregarDados(db, { from, to }) {
  const dias = diffDias(from, to) + 1;
  const desde = addDays(from, -dias); // inclui o período anterior, usado na comparação

  const [empresas] = await db.query(`
    SELECT u.id, u.active, DATE_FORMAT(u.created_at, '%Y-%m-%d') AS created, p.nome_fantasia, p.razao_social, p.cnpj
    FROM users u LEFT JOIN user_company_profiles p ON p.user_id = u.id WHERE u.type = 'empresa'`);

  const [pro] = await db.query(`
    SELECT DISTINCT p.user_id FROM (
      SELECT user_id FROM user_subscriptions WHERE status = 'active' AND plan_code = 'empresa_premium'
      UNION ALL SELECT user_id FROM subscriptions WHERE plan_id = 'empresa_premium' AND ${MP_ACCESS_CONDITION}
      UNION ALL SELECT user_id FROM annual_payments WHERE plan_id = 'empresa_premium' AND ${ANNUAL_ACCESS_CONDITION}
    ) p`);

  const [jobs] = await db.query(`
    SELECT id, company_id, modality, DATE_FORMAT(created_at, '%Y-%m-%d') AS created FROM jobs WHERE company_id IS NOT NULL`);

  const [candidaturas] = await db.query(`
    SELECT job_id, DATE_FORMAT(created_at, '%Y-%m-%d') AS d, COUNT(*) AS n
    FROM job_applications WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY) GROUP BY job_id, d`, [desde, to]);

  const [matchs] = await db.query(`
    SELECT company_id, DATE_FORMAT(created_at, '%Y-%m-%d') AS d, COUNT(*) AS n
    FROM company_match_actions WHERE action = 'aceito' AND created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
    GROUP BY company_id, d`, [desde, to]);

  return {
    empresas: empresas.map(e => ({ ...e, active: Boolean(e.active) })),
    proIds: pro.map(r => r.user_id), jobs, candidaturas, matchs,
  };
}

async function gerar(db, query, hoje = hojeSP()) {
  const periodo = resolverPeriodo(query, hoje); // valida antes de tocar no banco
  return calcular(await carregarDados(db, periodo), periodo);
}

// ── Exportação (PDF/Excel via services/relatorioExport) ──
const dataBr = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const sinal = (v, suf) => (v == null ? "—" : `${v > 0 ? "+" : ""}${String(v).replace(".", ",")}${suf}`);
const formatCnpj = (c) => { const d = String(c ?? "").replace(/\D/g, ""); return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : (c || "—"); };

function paraExport(r) {
  const k = r.kpis;
  return {
    titulo: "Atividade das empresas",
    descricao: "Empresas e oportunidades publicadas.",
    periodo: `${dataBr(r.periodo.from)} a ${dataBr(r.periodo.to)}`,
    nota: "Empresas ativas = contas não suspensas hoje. Vagas, candidaturas e matchs seguem o período escolhido. Conexões = matchs aceitos pelas empresas.",
    secoes: [
      {
        titulo: "Indicadores", colunas: ["Indicador", "Valor", "Detalhe"], larguras: [0.3, 0.14, 0.56], esquerda: [2],
        linhas: [
          ["Total de empresas ativas", k.empresas.total, `${k.empresas.free} FREE / ${k.empresas.pro} PRO · variação ${sinal(k.empresas.variacao_pct, "%")}`],
          ["Vagas publicadas", k.vagas.total, `${k.vagas.presenciais} presenciais / ${k.vagas.hibridas} híbridas / ${k.vagas.remotas} remotas · variação ${sinal(k.vagas.variacao_pct, "%")}`],
          ["Candidaturas enviadas", k.candidaturas.total, `variação ${sinal(k.candidaturas.variacao_pct, "%")}`],
          ["Média de conexões por empresa", String(k.conexoes.media).replace(".", ","), `${k.conexoes.total} matchs aceitos · variação ${sinal(k.conexoes.variacao_pct, "%")}`],
        ],
      },
      { titulo: "Candidaturas por empresa", colunas: ["Empresa", "Candidaturas", "Vagas publicadas"],
        linhas: r.grafico.map(e => [e.nome, e.candidaturas, e.vagas]) },
      { titulo: "Empresas mais ativas", colunas: ["Empresa", "CNPJ", "Vagas", "Matchs", "Plano"], larguras: [0.3, 0.26, 0.14, 0.14, 0.16],
        linhas: r.ranking.map(e => [e.nome, formatCnpj(e.cnpj), e.vagas, e.matchs, e.plano]) },
    ],
  };
}

const nomeArquivo = (r, ext) => `relatorio-atividade-das-empresas_${r.periodo.from}_a_${r.periodo.to}.${ext}`;

module.exports = { calcular, carregarDados, gerar, paraExport, nomeArquivo };
