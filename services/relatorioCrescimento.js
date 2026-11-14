// ============================================
// services/relatorioCrescimento.js
// Relatório "Crescimento de usuários" (Admin → Relatórios).
//
// A parte de cálculo (resolverPeriodo, gerarBuckets, calcular, toCsv) é pura e
// recebe os dados já lidos; só carregarDados() fala com o banco.
//
// Sobre o histórico de planos: o banco guarda o plano ATUAL de cada conta, não
// uma linha do tempo. Para a evolução FREE × PRO, cada conta conta como PRO a
// partir da data do primeiro registro de plano pago dela (cancelamentos
// posteriores não são descontados nos pontos antigos). O ponto de "hoje" usa
// sempre o número real de assinantes PRO ativos no momento.
// ============================================
const { MP_ACCESS_CONDITION, ANNUAL_ACCESS_CONDITION } = require("./subscriptionService");

const MS_DIA = 86400000;
const PLANOS_PRO = ["dev_pro", "empresa_premium"];
const MAX_DIAS = 730;
const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

const toDate = (iso) => new Date(`${iso}T00:00:00Z`);
const toIso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * MS_DIA);
const diffDias = (a, b) => Math.round((toDate(b) - toDate(a)) / MS_DIA);
const dm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

function erro(message) { return Object.assign(new Error(message), { status: 400 }); }

// "Hoje" no fuso do produto (o servidor pode rodar em UTC).
function hojeSP(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
}

const ISO_OK = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && toIso(toDate(s)) === s;

// { periodo: "7"|"30"|"90" } ou { from, to } → { from, to } (ISO, inclusivos).
function resolverPeriodo({ periodo, from, to } = {}, hoje = hojeSP()) {
  if (["7", "30", "90"].includes(String(periodo))) {
    return { from: toIso(addDays(toDate(hoje), -(Number(periodo) - 1))), to: hoje };
  }
  if (!ISO_OK(from) || !ISO_OK(to)) throw erro("Informe um período válido (7, 30, 90 ou datas AAAA-MM-DD).");
  if (from > to) throw erro("A data inicial não pode ser depois da final.");
  if (to > hoje) throw erro("A data final não pode estar no futuro.");
  if (diffDias(from, to) + 1 > MAX_DIAS) throw erro(`O período pode ter no máximo ${MAX_DIAS} dias.`);
  return { from, to };
}

// Até 14 dias → um ponto por dia; até 120 → por semana; acima → por mês.
function gerarBuckets(from, to) {
  const dias = diffDias(from, to) + 1;
  const out = [];
  if (dias <= 14) {
    for (let i = 0; i < dias; i++) { const d = toIso(addDays(toDate(from), i)); out.push({ inicio: d, fim: d, label: dm(d) }); }
    return { granularidade: "dia", buckets: out };
  }
  if (dias <= 120) {
    for (let i = 0; i < dias; i += 7) {
      const inicio = toIso(addDays(toDate(from), i));
      const fim = toIso(addDays(toDate(from), Math.min(i + 6, dias - 1)));
      out.push({ inicio, fim, label: dm(inicio) });
    }
    return { granularidade: "semana", buckets: out };
  }
  let cur = toDate(`${from.slice(0, 7)}-01`);
  while (toIso(cur) <= to) {
    const proximo = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
    const fimMes = toIso(addDays(proximo, -1));
    out.push({
      inicio: toIso(cur) < from ? from : toIso(cur),
      fim: fimMes > to ? to : fimMes,
      label: `${MESES[cur.getUTCMonth()]} ${cur.getUTCFullYear()}`,
    });
    cur = proximo;
  }
  return { granularidade: "mes", buckets: out };
}

// Soma n das linhas { d, type, n } do tipo dado até a data (inclusive).
const acumulado = (rows, type, ate) =>
  rows.reduce((s, r) => (r.type === type && r.d <= ate ? s + Number(r.n) : s), 0);

const pct = (fim, ini) => (ini > 0 ? Math.round(((fim - ini) / ini) * 100) : null);
const arred1 = (n) => Math.round(n * 10) / 10;

// dados: { cadastros:[{d,type,n}], primeiroPro:[{d,type,n}], atual:{dev:{ativos,pro}, empresa:{ativos,pro}} }
function calcular(dados, { from, to }, hoje = hojeSP()) {
  const { cadastros, primeiroPro, atual } = dados;
  const { granularidade, buckets } = gerarBuckets(from, to);
  const antes = toIso(addDays(toDate(from), -1));

  const serieCadastros = buckets.map(b => ({
    label: b.label, inicio: b.inicio, fim: b.fim,
    devs:     acumulado(cadastros, "dev", b.fim)     - acumulado(cadastros, "dev", antes),
    empresas: acumulado(cadastros, "empresa", b.fim) - acumulado(cadastros, "empresa", antes),
  }));

  const seriePlanos = buckets.map(b => {
    const linha = { label: b.label, inicio: b.inicio, fim: b.fim };
    for (const [chave, tipo] of [["devs", "dev"], ["empresas", "empresa"]]) {
      const total = acumulado(cadastros, tipo, b.fim);
      let pro = Math.min(acumulado(primeiroPro, tipo, b.fim), total);
      if (b.fim >= hoje) pro = Math.min(atual[tipo].pro, total); // ponto de hoje: número real
      linha[`${chave}_pro`] = pro;
      linha[`${chave}_free`] = Math.max(total - pro, 0);
    }
    return linha;
  });

  const ativos = (t) => atual[t].ativos;
  const proAtual = (t) => Math.min(atual[t].pro, atual[t].ativos);
  const card = (tipo) => ({
    total: ativos(tipo), pro: proAtual(tipo), free: Math.max(ativos(tipo) - proAtual(tipo), 0),
    variacao_pct: pct(acumulado(cadastros, tipo, to), acumulado(cadastros, tipo, antes)),
  });

  const totalContas = ativos("dev") + ativos("empresa");
  const taxa = totalContas > 0 ? arred1(((proAtual("dev") + proAtual("empresa")) / totalContas) * 100) : 0;
  const contasAntes = acumulado(cadastros, "dev", antes) + acumulado(cadastros, "empresa", antes);
  const proAntes = acumulado(primeiroPro, "dev", antes) + acumulado(primeiroPro, "empresa", antes);
  const taxaAntes = contasAntes > 0 ? (proAntes / contasAntes) * 100 : null;

  return {
    periodo: { from, to, granularidade },
    kpis: {
      devs: card("dev"),
      empresas: card("empresa"),
      conversao: { taxa, variacao_pp: taxaAntes == null ? null : arred1(taxa - taxaAntes) },
      proporcao: { devs: ativos("dev"), empresas: ativos("empresa"),
        razao: ativos("empresa") > 0 ? Math.round(ativos("dev") / ativos("empresa")) : null },
    },
    cadastros: serieCadastros,
    planos: seriePlanos,
  };
}

async function carregarDados(db) {
  const [cadastros] = await db.query(`
    SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS d, type, COUNT(*) AS n
    FROM users WHERE type IN ('dev', 'empresa') GROUP BY d, type`);

  const [primeiroPro] = await db.query(`
    SELECT t.d, t.type, COUNT(*) AS n FROM (
      SELECT x.user_id, u.type, DATE_FORMAT(MIN(x.dt), '%Y-%m-%d') AS d FROM (
        SELECT user_id, created_at AS dt FROM user_subscriptions WHERE plan_code IN (?)
        UNION ALL
        SELECT user_id, created_at FROM subscriptions WHERE plan_id IN (?) AND status <> 'pending'
        UNION ALL
        SELECT user_id, COALESCE(paid_at, created_at) FROM annual_payments WHERE plan_id IN (?) AND status = 'approved'
      ) x JOIN users u ON u.id = x.user_id
      WHERE u.type IN ('dev', 'empresa') GROUP BY x.user_id, u.type
    ) t GROUP BY t.d, t.type`, [PLANOS_PRO, PLANOS_PRO, PLANOS_PRO]);

  const [ativos] = await db.query(`
    SELECT type, COUNT(*) AS n FROM users WHERE active = 1 AND type IN ('dev', 'empresa') GROUP BY type`);

  const [pro] = await db.query(`
    SELECT u.type, COUNT(DISTINCT p.user_id) AS n FROM (
      SELECT user_id FROM user_subscriptions WHERE status = 'active' AND plan_code IN (?)
      UNION ALL
      SELECT user_id FROM subscriptions WHERE plan_id IN (?) AND ${MP_ACCESS_CONDITION}
      UNION ALL
      SELECT user_id FROM annual_payments WHERE plan_id IN (?) AND ${ANNUAL_ACCESS_CONDITION}
    ) p JOIN users u ON u.id = p.user_id AND u.active = 1
    WHERE u.type IN ('dev', 'empresa') GROUP BY u.type`, [PLANOS_PRO, PLANOS_PRO, PLANOS_PRO]);

  const pegar = (rows, tipo) => Number(rows.find(r => r.type === tipo)?.n ?? 0);
  return {
    cadastros, primeiroPro,
    atual: {
      dev:     { ativos: pegar(ativos, "dev"),     pro: pegar(pro, "dev") },
      empresa: { ativos: pegar(ativos, "empresa"), pro: pegar(pro, "empresa") },
    },
  };
}

async function gerar(db, query, hoje = hojeSP()) {
  const periodo = resolverPeriodo(query, hoje);
  return calcular(await carregarDados(db), periodo, hoje);
}

// ── Exportação (PDF/Excel via services/relatorioExport) ──
const dataBr = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const sinal = (v, suf) => (v == null ? "—" : `${v > 0 ? "+" : ""}${String(v).replace(".", ",")}${suf}`);

function paraExport(r) {
  const k = r.kpis;
  return {
    titulo: "Crescimento de usuários",
    descricao: "Cadastros e usuários ativos.",
    periodo: `${dataBr(r.periodo.from)} a ${dataBr(r.periodo.to)}`,
    nota: "Cada ponto passado da evolução FREE x PRO considera uma conta PRO a partir da data do primeiro plano pago dela; o último ponto usa os assinantes PRO ativos hoje.",
    secoes: [
      {
        titulo: "Indicadores", colunas: ["Indicador", "Valor", "Detalhe"], larguras: [0.3, 0.14, 0.56], esquerda: [2],
        linhas: [
          ["Desenvolvedores ativos", k.devs.total, `${k.devs.free} FREE / ${k.devs.pro} PRO · variação ${sinal(k.devs.variacao_pct, "%")}`],
          ["Empresas ativas", k.empresas.total, `${k.empresas.free} FREE / ${k.empresas.pro} PRO · variação ${sinal(k.empresas.variacao_pct, "%")}`],
          ["Conversão de FREE para PRO", `${String(k.conversao.taxa).replace(".", ",")}%`, `variação ${sinal(k.conversao.variacao_pp, " p.p.")}`],
          ["Proporção Dev/Empresa", k.proporcao.razao == null ? "—" : `${k.proporcao.razao}:1`, "desenvolvedores para cada empresa"],
        ],
      },
      { titulo: "Novos cadastros no período", colunas: ["Ponto", "Devs", "Empresas"],
        linhas: r.cadastros.map(c => [c.label, c.devs, c.empresas]) },
      { titulo: "Evolução FREE x PRO", colunas: ["Ponto", "Devs PRO", "Devs FREE", "Empresas PRO", "Empresas FREE"],
        linhas: r.planos.map(p => [p.label, p.devs_pro, p.devs_free, p.empresas_pro, p.empresas_free]) },
    ],
  };
}

const nomeArquivo = (r, ext) => `relatorio-crescimento-de-usuarios_${r.periodo.from}_a_${r.periodo.to}.${ext}`;

module.exports = {
  hojeSP, resolverPeriodo, gerarBuckets, calcular, carregarDados, gerar, paraExport, nomeArquivo,
};
