// ============================================
// services/relatorioUso.js
// Relatório "Uso da plataforma" (Admin → Relatórios).
//
// Fonte: usage_events (middlewares/usageTracker.js), que só existe a partir da
// data em que a coleta foi ligada — períodos anteriores aparecem incompletos e o
// relatório avisa disso (`coleta.desde`). Definições:
//   - sessão          = uma sessão de login (chave com hash) com ao menos um evento;
//   - sessões diárias = sessões iniciadas no período ÷ dias do período;
//   - tempo por sessão= (último − primeiro evento) + 5 min (o intervalo de coleta),
//     já que um evento representa uma janela de atividade, não um instante;
//   - horários de pico= sessões iniciadas em cada faixa de 2h (fuso de São Paulo);
//   - módulos         = % dos usuários ativos no período que usaram o módulo;
//   - mentor          = devs que mandaram mensagem ao mentor ÷ devs ativos (dado
//     histórico de mentor_conversas, não depende da coleta);
//   - retenção de 30 dias = contas criadas de (início − 30 dias) a (fim − 30 dias),
//     depois do início da coleta, vistas de novo 30+ dias após o cadastro.
// calcular() é pura; só carregarDados() fala com o banco.
// ============================================
const { resolverPeriodo, hojeSP } = require("./relatorioCrescimento");

const MS_DIA = 86400000;
const SP_OFFSET_H = -3; // America/Sao_Paulo (sem horário de verão)
const INTERVALO_COLETA_S = 5 * 60;

const toDate = (iso) => new Date(`${iso}T00:00:00Z`);
const toIso = (d) => d.toISOString().slice(0, 10);
const addDays = (iso, n) => toIso(new Date(toDate(iso).getTime() + n * MS_DIA));
const diffDias = (a, b) => Math.round((toDate(b) - toDate(a)) / MS_DIA);

// "2026-11-02T14:30:00Z" (UTC) → data e hora em São Paulo
const emSP = (utcIso) => new Date(Date.parse(utcIso) + SP_OFFSET_H * 3600000);
const diaSP = (utcIso) => toIso(emSP(utcIso));
const horaSP = (utcIso) => emSP(utcIso).getUTCHours();
// meia-noite de um dia de São Paulo, em UTC ("YYYY-MM-DD HH:MM:SS")
const inicioDoDiaUtc = (iso) => `${iso} ${String(-SP_OFFSET_H).padStart(2, "0")}:00:00`;

const MODULOS = [
  ["vagas", "Busca de vagas"], ["roadmap", "Roadmap & GitHub"], ["mentor", "Mentor"], ["chat", "Chat & match"],
];
const arred1 = (n) => Math.round(n * 10) / 10;
const pct = (fim, ini) => (ini > 0 ? Math.round(((fim - ini) / ini) * 100) : null);
const dif = (a, b) => (a != null && b != null ? arred1(a - b) : null);
const media = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

// dados: { sessoes:[{session_key,user_id,user_type,inicio,fim}], modulos:[{module,usuarios}],
//          mentor:{atual,anterior}, devsAtivos, retencao:{atual:{coorte,retidos},anterior:{coorte,retidos}}, coletaDesde }
function calcular(dados, { from, to }) {
  const dias = diffDias(from, to) + 1;
  const antesTo = addDays(from, -1), antesFrom = addDays(from, -dias);
  const noPeriodo = (s, f, t) => { const d = diaSP(s.inicio); return d >= f && d <= t; };
  const atual = dados.sessoes.filter(s => noPeriodo(s, from, to));
  const anterior = dados.sessoes.filter(s => noPeriodo(s, antesFrom, antesTo));

  const porDia = (lista) => {
    const m = new Map();
    for (const s of lista) { const d = diaSP(s.inicio); (m.get(d) ?? m.set(d, new Set()).get(d)).add(s.user_id); }
    return m;
  };
  const diarias = (lista) => lista.length / dias;
  const unicosDia = (lista) => media([...porDia(lista).values()].map(set => set.size)) ?? 0;
  const duracao = (lista) => media(lista.map(s => Math.max((Date.parse(s.fim) - Date.parse(s.inicio)) / 1000, 0) + INTERVALO_COLETA_S));

  const dAtual = duracao(atual), dAnt = duracao(anterior);
  const mentorPct = (n) => (dados.devsAtivos > 0 ? arred1((n / dados.devsAtivos) * 100) : null);
  const retPct = (r) => (r.coorte > 0 ? arred1((r.retidos / r.coorte) * 100) : null);
  const mAtual = mentorPct(dados.mentor.atual), mAnt = mentorPct(dados.mentor.anterior);
  const rAtual = retPct(dados.retencao.atual), rAnt = retPct(dados.retencao.anterior);

  const horarios = Array.from({ length: 12 }, (_, i) => ({ label: `${i * 2}h`, devs: 0, empresas: 0 }));
  for (const s of atual) horarios[Math.floor(horaSP(s.inicio) / 2)][s.user_type === "empresa" ? "empresas" : "devs"]++;

  const ativos = new Set(atual.map(s => s.user_id)).size;
  const usuariosPorModulo = Object.fromEntries(dados.modulos.map(m => [m.module, Number(m.usuarios)]));
  const modulos = MODULOS.map(([chave, label]) => {
    const usuarios = usuariosPorModulo[chave] ?? 0;
    return { chave, label, usuarios, taxa: ativos ? Math.round((usuarios / ativos) * 100) : null };
  }).sort((a, b) => (b.taxa ?? -1) - (a.taxa ?? -1));

  return {
    periodo: { from, to },
    coleta: { desde: dados.coletaDesde ?? null, parcial: !dados.coletaDesde || dados.coletaDesde > from },
    kpis: {
      sessoes_diarias: { media: arred1(diarias(atual)), total: atual.length, usuarios_dia: arred1(unicosDia(atual)),
        variacao_pct: pct(diarias(atual), diarias(anterior)) },
      tempo_sessao: { segundos: dAtual == null ? null : Math.round(dAtual), variacao_pct: dAtual != null && dAnt != null ? pct(dAtual, dAnt) : null },
      mentor: { taxa: mAtual, usuarios: dados.mentor.atual, devs_ativos: dados.devsAtivos, variacao_pp: dif(mAtual, mAnt) },
      retencao: { taxa: rAtual, coorte: dados.retencao.atual.coorte, retidos: dados.retencao.atual.retidos, variacao_pp: dif(rAtual, rAnt) },
    },
    horarios, modulos, usuarios_ativos: ativos,
  };
}

async function carregarDados(db, { from, to }) {
  const dias = diffDias(from, to) + 1;
  const desde = addDays(from, -dias);
  const ateUtc = inicioDoDiaUtc(addDays(to, 1));      // exclusivo
  const deUtc = inicioDoDiaUtc(desde);

  const [sessoes] = await db.query(`
    SELECT session_key, user_id, user_type,
           DATE_FORMAT(MIN(created_at), '%Y-%m-%dT%H:%i:%sZ') AS inicio,
           DATE_FORMAT(MAX(created_at), '%Y-%m-%dT%H:%i:%sZ') AS fim
    FROM usage_events WHERE created_at >= ? AND created_at < ?
    GROUP BY session_key, user_id, user_type`, [deUtc, ateUtc]);

  const [modulos] = await db.query(`
    SELECT module, COUNT(DISTINCT user_id) AS usuarios FROM usage_events
    WHERE created_at >= ? AND created_at < ? AND module <> 'outros' GROUP BY module`, [inicioDoDiaUtc(from), ateUtc]);

  const [[inicio]] = await db.query("SELECT DATE_FORMAT(MIN(created_at), '%Y-%m-%d') AS d FROM usage_events");
  const coletaDesde = inicio?.d ? diaSP(`${inicio.d}T12:00:00Z`) : null; // dia (SP) da primeira coleta

  const [[devs]] = await db.query("SELECT COUNT(*) AS n FROM users WHERE type = 'dev' AND active = 1");
  const mentor = async (f, t) => {
    const [[r]] = await db.query(`
      SELECT COUNT(DISTINCT user_id) AS n FROM mentor_conversas
      WHERE role = 'user' AND created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)`, [f, t]);
    return Number(r.n);
  };

  // Coorte da retenção: contas criadas 30 dias antes do período, depois do início da coleta.
  const retencao = async (f, t) => {
    if (!coletaDesde) return { coorte: 0, retidos: 0 };
    const ini = addDays(f, -30) < coletaDesde ? coletaDesde : addDays(f, -30), fim = addDays(t, -30);
    if (ini > fim) return { coorte: 0, retidos: 0 };
    const [[r]] = await db.query(`
      SELECT COUNT(*) AS coorte, COALESCE(SUM(last_seen_at >= DATE_ADD(created_at, INTERVAL 30 DAY)), 0) AS retidos
      FROM users WHERE type IN ('dev', 'empresa') AND created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)`, [ini, fim]);
    return { coorte: Number(r.coorte), retidos: Number(r.retidos) };
  };

  return {
    sessoes, modulos, coletaDesde,
    devsAtivos: Number(devs.n),
    mentor: { atual: await mentor(from, to), anterior: await mentor(desde, addDays(from, -1)) },
    retencao: { atual: await retencao(from, to), anterior: await retencao(desde, addDays(from, -1)) },
  };
}

async function gerar(db, query, hoje = hojeSP()) {
  const periodo = resolverPeriodo(query, hoje); // valida antes de tocar no banco
  return calcular(await carregarDados(db, periodo), periodo);
}

// ── Exportação (PDF/Excel via services/relatorioExport) ──
const dataBr = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const sinal = (v, suf) => (v == null ? "—" : `${v > 0 ? "+" : ""}${String(v).replace(".", ",")}${suf}`);
const num1 = (n, suf = "") => (n == null ? "—" : `${String(n).replace(".", ",")}${suf}`);
const duracaoTexto = (s) => (s == null ? "—" : `${Math.floor(s / 60)}min${String(s % 60).padStart(2, "0")}s`);

function paraExport(r) {
  const k = r.kpis;
  return {
    titulo: "Uso da plataforma",
    descricao: "Acessos e pesquisas realizadas.",
    periodo: `${dataBr(r.periodo.from)} a ${dataBr(r.periodo.to)}`,
    nota: (r.coleta.parcial
      ? `A coleta de uso começou em ${r.coleta.desde ? dataBr(r.coleta.desde) : "—"}; antes disso os números são parciais. ` : "")
      + "Tempo por sessão = último menos primeiro evento + 5 min. Horários em São Paulo.",
    secoes: [
      {
        titulo: "Indicadores", colunas: ["Indicador", "Valor", "Detalhe"], larguras: [0.3, 0.14, 0.56], esquerda: [2],
        linhas: [
          ["Sessões ativas diárias", num1(k.sessoes_diarias.media), `${k.sessoes_diarias.total} sessões · ${num1(k.sessoes_diarias.usuarios_dia)} usuários únicos por dia · variação ${sinal(k.sessoes_diarias.variacao_pct, "%")}`],
          ["Tempo médio por sessão", duracaoTexto(k.tempo_sessao.segundos), `variação ${sinal(k.tempo_sessao.variacao_pct, "%")}`],
          ["Utilização do Mentor", num1(k.mentor.taxa, "%"), `${k.mentor.usuarios} de ${k.mentor.devs_ativos} devs ativos · variação ${sinal(k.mentor.variacao_pp, " p.p.")}`],
          ["Taxa de retenção de 30 dias", num1(k.retencao.taxa, "%"), `${k.retencao.retidos} de ${k.retencao.coorte} contas · variação ${sinal(k.retencao.variacao_pp, " p.p.")}`],
        ],
      },
      { titulo: "Picos de acesso por horário", colunas: ["Faixa", "Devs", "Empresas"], linhas: r.horarios.map(h => [h.label, h.devs, h.empresas]) },
      { titulo: "Módulos mais acessados", colunas: ["Módulo", "Usuários", "% dos ativos"],
        linhas: r.modulos.map(m => [m.label, m.usuarios, m.taxa == null ? "—" : `${m.taxa}%`]) },
    ],
  };
}

const nomeArquivo = (r, ext) => `relatorio-uso-da-plataforma_${r.periodo.from}_a_${r.periodo.to}.${ext}`;

module.exports = { calcular, carregarDados, gerar, paraExport, nomeArquivo, duracaoTexto, MODULOS };
