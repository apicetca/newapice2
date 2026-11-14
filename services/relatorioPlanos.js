// ============================================
// services/relatorioPlanos.js
// Relatório "Planos e assinaturas" (Admin → Relatórios).
//
// Fonte: subscriptions (mensal, Mercado Pago), annual_payments (anual, pago de uma
// vez) e user_subscriptions (plano liberado à mão pelo admin, sem cobrança).
// Definições:
//   - receita mensal recorrente (MRR) = mensalidades das assinaturas pagas ativas +
//     o pagamento anual dividido por 12 dos planos anuais vigentes; planos manuais
//     não geram receita;
//   - assinantes PRO ativos = contas ativas com plano pago ou manual vigente (mesma
//     conta do relatório de crescimento, de onde vêm também a conversão FREE→PRO e
//     a divisão devs/empresas);
//   - cancelamentos = assinaturas mensais canceladas no período ÷ assinantes PRO no
//     início do período;
//   - evolução do faturamento = MRR ao fim de cada ponto, a partir das datas de
//     criação/cancelamento/pagamento; o ponto de hoje usa o estado real do banco.
// calcular() é pura; só carregarDados() fala com o banco.
// ============================================
const { MP_ACCESS_CONDITION, ANNUAL_ACCESS_CONDITION } = require("./subscriptionService");
const { getPlan } = require("../config/plans");
const crescimento = require("./relatorioCrescimento");

const { resolverPeriodo, gerarBuckets, hojeSP } = crescimento;
const MS_DIA = 86400000;
const PLANOS_PRO = { dev_pro: "dev", empresa_premium: "empresa" };
const CODIGOS_PRO = Object.keys(PLANOS_PRO);

const toDate = (iso) => new Date(`${iso}T00:00:00Z`);
const toIso = (d) => d.toISOString().slice(0, 10);
const addDays = (iso, n) => toIso(new Date(toDate(iso).getTime() + n * MS_DIA));
const diffDias = (a, b) => Math.round((toDate(b) - toDate(a)) / MS_DIA);
const arred1 = (n) => Math.round(n * 10) / 10;
const pct = (fim, ini) => (ini > 0 ? Math.round(((fim - ini) / ini) * 100) : null);
const dif = (a, b) => (a != null && b != null ? arred1(a - b) : null);
const cents = (reais) => Math.round(Number(reais) * 100);

// Registros de cobrança normalizados: { user_id, tipo, ciclo, centavos_mes, de, ate, ativa }
//   de/ate: primeiro e último dia (inclusive) em que contam; ate = null → sem fim conhecido
function normalizar(dados) {
  const regs = [];
  for (const s of dados.subs) {
    const plano = getPlan(s.plan_id);
    regs.push({ user_id: s.user_id, tipo: PLANOS_PRO[s.plan_id], ciclo: "mensal", centavos_mes: plano?.price_cents ?? 0,
      de: s.created, ate: s.cancelled ? addDays(s.cancelled, -1) : null, ativa: Boolean(s.ativa), pago: true });
  }
  for (const a of dados.anuais) {
    const plano = getPlan(a.plan_id);
    const total = a.amount != null ? cents(a.amount) : (plano?.annual_price_cents ?? 0);
    regs.push({ user_id: a.user_id, tipo: PLANOS_PRO[a.plan_id], ciclo: "anual", centavos_mes: Math.round(total / 12), centavos_total: total,
      de: a.pago, ate: a.ate, ativa: Boolean(a.ativa), pago: true });
  }
  for (const m of dados.manuais) {
    regs.push({ user_id: m.user_id, tipo: PLANOS_PRO[m.plan_code], ciclo: "manual", centavos_mes: 0,
      de: m.created, ate: null, ativa: m.status === "active", pago: false });
  }
  return regs;
}

// dados: { subs:[{user_id,plan_id,created,cancelled,ativa}], anuais:[{user_id,plan_id,amount,pago,ate,ativa}],
//          manuais:[{user_id,plan_code,status,created}], pessoas:[{user_id,tipo,nome,doc,avatar_url}],
//          base: saída de crescimento.calcular (para conversão e contagem de PRO) }
function calcular(dados, { from, to }, hoje = hojeSP()) {
  const dias = diffDias(from, to) + 1;
  const antesTo = addDays(from, -1), antesFrom = addDays(from, -dias);
  const regs = normalizar(dados);

  // um registro conta em X se já começou e ainda não terminou; hoje vale o estado real
  const vigente = (r, x) => (x >= hoje ? r.ativa : r.de <= x && (r.ate == null || r.ate >= x));
  const mrrEm = (x, tipo) => regs.filter(r => r.pago && (!tipo || r.tipo === tipo) && vigente(r, x)).reduce((s, r) => s + r.centavos_mes, 0);
  const proEm = (x) => new Set(regs.filter(r => vigente(r, x)).map(r => r.user_id)).size;

  const noPeriodo = (d, f, t) => d != null && d >= f && d <= t;
  const cancelamentos = (f, t) => dados.subs.filter(s => noPeriodo(s.cancelled, f, t)).length;
  const ativacoes = (f, t) => regs.filter(r => noPeriodo(r.de, f, t)).length;

  const proAgora = dados.base.kpis.devs.pro + dados.base.kpis.empresas.pro;
  const proInicio = Math.max(proAgora - ativacoes(from, to) + cancelamentos(from, to), 0);
  const proInicioAnt = Math.max(proInicio - ativacoes(antesFrom, antesTo) + cancelamentos(antesFrom, antesTo), 0);
  const taxaCancel = (c, base) => (base > 0 ? arred1((c / base) * 100) : null);
  const cAtual = taxaCancel(cancelamentos(from, to), proInicio);
  const cAnt = taxaCancel(cancelamentos(antesFrom, antesTo), proInicioAnt);

  const mrrAgora = mrrEm(hoje), mrrInicio = mrrEm(antesTo);
  const { buckets } = gerarBuckets(from, to);
  const faturamento = buckets.map(b => ({
    label: b.label, inicio: b.inicio, fim: b.fim,
    devs: mrrEm(b.fim, "dev") / 100, empresas: mrrEm(b.fim, "empresa") / 100,
  }));

  const pessoa = new Map(dados.pessoas.map(p => [`${p.tipo}:${p.user_id}`, p]));
  const assinaturas = regs.filter(r => noPeriodo(r.de, from, to))
    .map(r => {
      const p = pessoa.get(`${r.tipo}:${r.user_id}`);
      return { user_id: r.user_id, tipo: r.tipo, nome: p?.nome ?? "—", doc: p?.doc ?? null, avatar_url: p?.avatar_url ?? null,
        plano: "PRO", ciclo: r.ciclo, centavos: r.ciclo === "anual" ? (r.centavos_total ?? r.centavos_mes * 12) : r.centavos_mes, data: r.de };
    })
    .sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : b.user_id - a.user_id))
    .slice(0, 10);

  const k = dados.base.kpis;
  return {
    periodo: { from, to },
    kpis: {
      mrr: { centavos: mrrAgora, devs: mrrEm(hoje, "dev"), empresas: mrrEm(hoje, "empresa"), variacao_pct: pct(mrrAgora, mrrInicio) },
      pro: { total: proAgora, devs: k.devs.pro, empresas: k.empresas.pro, variacao_pct: pct(proAgora, proInicio) },
      conversao: { ...k.conversao, devs: k.devs.total ? arred1((k.devs.pro / k.devs.total) * 100) : null,
        empresas: k.empresas.total ? arred1((k.empresas.pro / k.empresas.total) * 100) : null },
      cancelamentos: { taxa: cAtual, cancelados: cancelamentos(from, to), variacao_pp: dif(cAtual, cAnt) },
    },
    faturamento, assinaturas,
  };
}

async function carregarDados(db, periodo) {
  const base = crescimento.calcular(await crescimento.carregarDados(db), periodo);

  const [subs] = await db.query(`
    SELECT user_id, plan_id, DATE_FORMAT(created_at, '%Y-%m-%d') AS created, DATE_FORMAT(cancelled_at, '%Y-%m-%d') AS cancelled,
           (${MP_ACCESS_CONDITION}) AS ativa
    FROM subscriptions WHERE plan_id IN (?) AND status <> 'pending'`, [CODIGOS_PRO]);
  const [anuais] = await db.query(`
    SELECT user_id, plan_id, amount, DATE_FORMAT(COALESCE(paid_at, created_at), '%Y-%m-%d') AS pago,
           DATE_FORMAT(valid_until, '%Y-%m-%d') AS ate, (${ANNUAL_ACCESS_CONDITION}) AS ativa
    FROM annual_payments WHERE plan_id IN (?) AND status = 'approved'`, [CODIGOS_PRO]);
  const [manuais] = await db.query(`
    SELECT user_id, plan_code, status, DATE_FORMAT(created_at, '%Y-%m-%d') AS created
    FROM user_subscriptions WHERE plan_code IN (?)`, [CODIGOS_PRO]);

  const ids = [...new Set([...subs, ...anuais, ...manuais].map(r => r.user_id))];
  let pessoas = [];
  if (ids.length) {
    const [devs] = await db.query(
      "SELECT user_id, nome, sobrenome, github_login, avatar_url FROM user_dev_profiles WHERE user_id IN (?)", [ids]);
    const [empresas] = await db.query(
      "SELECT user_id, nome_fantasia, razao_social, cnpj FROM user_company_profiles WHERE user_id IN (?)", [ids]);
    pessoas = [
      ...devs.map(d => ({ user_id: d.user_id, tipo: "dev", nome: `${d.nome ?? ""} ${d.sobrenome ?? ""}`.trim() || "Desenvolvedor",
        doc: d.github_login ? `@${d.github_login}` : null, avatar_url: d.avatar_url })),
      ...empresas.map(e => ({ user_id: e.user_id, tipo: "empresa", nome: e.nome_fantasia || e.razao_social || "Empresa", doc: e.cnpj, avatar_url: null })),
    ];
  }
  return { subs, anuais, manuais, pessoas, base };
}

async function gerar(db, query, hoje = hojeSP()) {
  const periodo = resolverPeriodo(query, hoje); // valida antes de tocar no banco
  return calcular(await carregarDados(db, periodo), periodo, hoje);
}

// ── Exportação (PDF/Excel via services/relatorioExport) ──
const dataBr = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const sinal = (v, suf) => (v == null ? "—" : `${v > 0 ? "+" : ""}${String(v).replace(".", ",")}${suf}`);
const num1 = (n, suf = "") => (n == null ? "—" : `${String(n).replace(".", ",")}${suf}`);
const brl = (centavos) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(centavos / 100);
const CICLO = { mensal: "Mensal", anual: "Anual", manual: "Manual" };
const TIPOS = { dev: "Devs", empresa: "Empresas" };

function tipoDe(query) {
  const t = query?.tipo;
  if (t == null || t === "" || t === "todos") return null;
  if (!TIPOS[t]) throw Object.assign(new Error("Tipo de plano inválido. Use dev ou empresa."), { status: 400 });
  return t;
}

function paraExport(r, query) {
  const tipo = tipoDe(query), k = r.kpis;
  const proTipo = tipo === "dev" ? k.pro.devs : tipo === "empresa" ? k.pro.empresas : k.pro.total;
  const mrrTipo = tipo === "dev" ? k.mrr.devs : tipo === "empresa" ? k.mrr.empresas : k.mrr.centavos;
  const conv = tipo === "dev" ? k.conversao.devs : tipo === "empresa" ? k.conversao.empresas : k.conversao.taxa;
  const colunasSerie = tipo ? [tipo === "dev" ? "devs" : "empresas"] : ["devs", "empresas"];
  const nomesSerie = colunasSerie.map(c => (c === "devs" ? "Devs" : "Empresas"));

  return {
    titulo: `Planos e assinaturas${tipo ? ` — ${TIPOS[tipo]}` : ""}`,
    descricao: "Acompanhe os planos utilizados na Ápice.",
    periodo: `${dataBr(r.periodo.from)} a ${dataBr(r.periodo.to)}`,
    nota: "Receita mensal recorrente = mensalidades pagas ativas + planos anuais vigentes divididos por 12; planos liberados pelo admin não geram receita. A evolução reconstrói o faturamento pelas datas de cobrança e cancelamento.",
    secoes: [
      {
        titulo: "Indicadores", colunas: ["Indicador", "Valor", "Detalhe"], larguras: [0.3, 0.16, 0.54], esquerda: [2],
        linhas: [
          ["Receita mensal recorrente", brl(mrrTipo), tipo ? `variação do total ${sinal(k.mrr.variacao_pct, "%")}` : `${brl(k.mrr.devs)} devs / ${brl(k.mrr.empresas)} empresas · variação ${sinal(k.mrr.variacao_pct, "%")}`],
          ["Assinantes PRO ativos", proTipo, tipo ? `variação do total ${sinal(k.pro.variacao_pct, "%")}` : `${k.pro.devs} devs PRO / ${k.pro.empresas} empresas PRO · variação ${sinal(k.pro.variacao_pct, "%")}`],
          ["Conversão de FREE para PRO", num1(conv, "%"), tipo ? "" : `variação ${sinal(k.conversao.variacao_pp, " p.p.")}`],
          ["Taxa de cancelamentos", num1(k.cancelamentos.taxa, "%"), `${k.cancelamentos.cancelados} cancelamento(s) no período · variação ${sinal(k.cancelamentos.variacao_pp, " p.p.")}`],
        ],
      },
      { titulo: "Evolução do faturamento (R$)", colunas: ["Ponto", ...nomesSerie],
        linhas: r.faturamento.map(f => [f.label, ...colunasSerie.map(c => brl(Math.round(f[c] * 100)))]) },
      { titulo: "Últimas assinaturas e upgrades", colunas: ["Nome", "Plano", "Ciclo", "Valor", "Data"], larguras: [0.32, 0.12, 0.14, 0.22, 0.2],
        linhas: r.assinaturas.filter(a => !tipo || a.tipo === tipo)
          .map(a => [a.nome, a.plano, CICLO[a.ciclo], a.ciclo === "manual" ? "—" : `${brl(a.centavos)}${a.ciclo === "anual" ? "/ano" : "/mês"}`, dataBr(a.data)]) },
    ],
  };
}

const nomeArquivo = (r, ext) => `relatorio-planos-e-assinaturas_${r.periodo.from}_a_${r.periodo.to}.${ext}`;

module.exports = { calcular, carregarDados, gerar, paraExport, nomeArquivo, tipoDe, normalizar };
