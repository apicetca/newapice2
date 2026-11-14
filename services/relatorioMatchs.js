// ============================================
// services/relatorioMatchs.js
// Relatório "Compatibilidade de matchs" (Admin → Relatórios).
//
// "Match realizado" = uma decisão da empresa sobre um dev para uma vaga
// (company_match_actions: aceito ou recusado). Definições:
//   - taxa de aceitação  = aceitos ÷ decisões no período;
//   - compatibilidade    = % de match de HOJE do par dev × vaga (mesma conta de
//     services/matchCalculator: skills 85% + senioridade 15%), média das decisões;
//   - tempo para aceitar = dias entre a candidatura do dev e o aceite, só das
//     decisões em que o dev se candidatou à vaga;
//   - perfil × requisitos: para cada decisão, o que o dev tem contra o que a vaga
//     pede. Skills técnicas, soft skills e progresso do roadmap usam 100 como
//     requisito (vaga atendida por completo); senioridade compara o nível do dev
//     (33/67/100) com o nível da vaga (33/67/100).
// calcular() é pura; só carregarDados() fala com o banco.
// ============================================
const { computeMatch, computeSkillsScore } = require("./matchCalculator");
const { NIVEL_ORDER, LEVEL_ORDER } = require("./niveis");
const { resolverPeriodo, hojeSP } = require("./relatorioCrescimento");

const MS_DIA = 86400000;
const toDate = (iso) => new Date(`${iso}T00:00:00Z`);
const toIso = (d) => d.toISOString().slice(0, 10);
const addDays = (iso, n) => toIso(new Date(toDate(iso).getTime() + n * MS_DIA));
const diffDias = (a, b) => Math.round((toDate(b) - toDate(a)) / MS_DIA);

const NIVEIS = { estagio: "Estágio", junior: "Júnior", pleno: "Pleno" };
const arred1 = (n) => Math.round(n * 10) / 10;
const pct = (fim, ini) => (ini > 0 ? Math.round(((fim - ini) / ini) * 100) : null);
const media = (xs) => (xs.length ? arred1(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
const dif = (a, b) => (a != null && b != null ? arred1(a - b) : null);
const nivelPct = (rank) => Math.round(((rank + 1) / 3) * 100);

// dados: { actions:[{job_id, dev, action, d}], jobs:[{id,title,company,level}],
//          jobSkills:[{job_id,skill_id,importance,type}], devs:[{chave,user_id,nome,sobrenome,github_login,avatar_url,nivel}],
//          skills:[{github_id,skill_id,confidence}], progresso:[{github_id,job_id,status}],
//          candidaturas:[{job_id,dev,d}] }
function calcular(dados, { from, to }) {
  const dias = diffDias(from, to) + 1;
  const antesTo = addDays(from, -1), antesFrom = addDays(from, -dias);

  const jobs = new Map(dados.jobs.map(j => [j.id, j]));
  const devs = new Map(dados.devs.map(d => [String(d.chave), d]));
  const skillsDoJob = {};
  for (const s of dados.jobSkills) (skillsDoJob[s.job_id] ??= []).push(s);
  const skillsDoDev = {};
  for (const s of dados.skills) (skillsDoDev[String(s.github_id)] ??= {})[s.skill_id] = s.confidence;
  const concluidos = {};
  for (const p of dados.progresso) if (p.status === "concluido") concluidos[`${p.job_id}:${p.github_id}`] = (concluidos[`${p.job_id}:${p.github_id}`] ?? 0) + 1;
  const candidatouEm = {};
  for (const c of dados.candidaturas) { const k = `${c.job_id}:${c.dev}`; if (!candidatouEm[k] || c.d < candidatouEm[k]) candidatouEm[k] = c.d; }

  // métricas de um par (decisão); null quando a vaga não tem skills cadastradas
  const metricas = (a) => {
    const job = jobs.get(a.job_id), dev = devs.get(String(a.dev)), js = skillsDoJob[a.job_id] ?? [];
    if (!job || !js.length) return { score: null };
    const mapa = skillsDoDev[String(a.dev)] ?? {};
    const hard = js.filter(s => s.type !== "soft"), soft = js.filter(s => s.type === "soft");
    const nivelDev = dev?.nivel, rankJob = LEVEL_ORDER[job.level];
    return {
      score: computeMatch(mapa, js, nivelDev, job.level),
      hard: hard.length ? computeSkillsScore(mapa, hard) : null,
      soft: soft.length ? computeSkillsScore(mapa, soft) : null,
      senioridade: NIVEL_ORDER[nivelDev] != null && rankJob != null
        ? { perfil: nivelPct(NIVEL_ORDER[nivelDev]), requisito: nivelPct(rankJob) } : null,
      roadmap: Math.min(100, Math.round(((concluidos[`${a.job_id}:${a.dev}`] ?? 0) / js.length) * 100)),
    };
  };

  const resumo = (lista) => {
    const aceitos = lista.filter(a => a.action === "aceito");
    const scores = lista.map(a => metricas(a).score).filter(s => s != null);
    const tempos = aceitos
      .map(a => (candidatouEm[`${a.job_id}:${a.dev}`] ? diffDias(candidatouEm[`${a.job_id}:${a.dev}`], a.d) : null))
      .filter(t => t != null && t >= 0);
    return {
      total: lista.length, aceitos: aceitos.length, recusados: lista.length - aceitos.length,
      taxa: lista.length ? arred1((aceitos.length / lista.length) * 100) : null,
      compat: media(scores), tempo: media(tempos),
    };
  };

  const noPeriodo = (f, t) => dados.actions.filter(a => a.d >= f && a.d <= t);
  const atual = noPeriodo(from, to), anterior = noPeriodo(antesFrom, antesTo);
  const r = resumo(atual), ant = resumo(anterior);

  const pares = atual.map(metricas);
  const cat = (chave, label, perfilFn, requisitoFn) => {
    const itens = pares.map((m, i) => ({ m, i })).filter(({ m }) => m.score != null).map(({ m }) => ({ p: perfilFn(m), q: requisitoFn(m) })).filter(x => x.p != null);
    return { chave, label, perfil: media(itens.map(x => x.p)), requisito: media(itens.map(x => x.q)), amostra: itens.length };
  };
  const categorias = [
    cat("skills", "Skills técnicas", m => m.hard, m => (m.hard != null ? 100 : null)),
    cat("senioridade", "Senioridade", m => m.senioridade?.perfil ?? null, m => m.senioridade?.requisito ?? null),
    cat("roadmap", "Progresso do roadmap", m => m.roadmap, () => 100),
    cat("soft", "Soft skills", m => m.soft, m => (m.soft != null ? 100 : null)),
  ];

  const porNivel = Object.keys(NIVEIS).map(level => {
    const doNivel = atual.filter(a => jobs.get(a.job_id)?.level === level);
    const ok = doNivel.filter(a => a.action === "aceito").length;
    return { level, label: NIVEIS[level], total: doNivel.length, aceitos: ok, taxa: doNivel.length ? Math.round((ok / doNivel.length) * 100) : null };
  });

  const ranking = atual.filter(a => a.action === "aceito")
    .map(a => ({ a, score: metricas(a).score })).filter(x => x.score != null)
    .sort((x, y) => y.score - x.score || (y.a.d > x.a.d ? 1 : -1))
    .slice(0, 10)
    .map(({ a, score }) => {
      const dev = devs.get(String(a.dev)), job = jobs.get(a.job_id);
      const nome = dev ? `${dev.nome ?? ""} ${dev.sobrenome ?? ""}`.trim() : "";
      return { dev_user_id: dev?.user_id ?? null, nome: nome || "Desenvolvedor", github_login: dev?.github_login ?? null,
        avatar_url: dev?.avatar_url ?? null, company: job?.company ?? null, job_id: a.job_id, job_title: job?.title ?? "—", score, data: a.d };
    });

  return {
    periodo: { from, to },
    kpis: {
      total: { total: r.total, aceitos: r.aceitos, recusados: r.recusados, variacao_pct: pct(r.total, ant.total) },
      aceitacao: { taxa: r.taxa, variacao_pp: dif(r.taxa, ant.taxa) },
      compatibilidade: { media: r.compat, variacao_pp: dif(r.compat, ant.compat) },
      tempo_aceite: { dias: r.tempo, variacao_dias: dif(r.tempo, ant.tempo) },
    },
    categorias, por_nivel: porNivel, ranking,
  };
}

async function carregarDados(db, { from, to }) {
  const dias = diffDias(from, to) + 1;
  const desde = addDays(from, -dias); // inclui o período anterior, usado na comparação

  const [actions] = await db.query(`
    SELECT job_id, dev_github_id AS dev, action, DATE_FORMAT(created_at, '%Y-%m-%d') AS d
    FROM company_match_actions WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)`, [desde, to]);
  if (!actions.length) return { actions: [], jobs: [], jobSkills: [], devs: [], skills: [], progresso: [], candidaturas: [] };

  const jobIds = [...new Set(actions.map(a => a.job_id))];
  const devKeys = [...new Set(actions.map(a => String(a.dev)))];

  const [jobs] = await db.query("SELECT id, title, company, level FROM jobs WHERE id IN (?)", [jobIds]);
  const [jobSkills] = await db.query(`
    SELECT js.job_id, js.skill_id, js.importance, s.type
    FROM job_skills js JOIN skills s ON s.id = js.skill_id WHERE js.job_id IN (?)`, [jobIds]);
  const [devs] = await db.query(`
    SELECT user_id, COALESCE(github_id, user_id) AS chave, nome, sobrenome, github_login, nivel, avatar_url
    FROM user_dev_profiles WHERE COALESCE(github_id, user_id) IN (?)`, [devKeys]);
  const [skills] = await db.query("SELECT github_id, skill_id, confidence FROM user_skills WHERE github_id IN (?)", [devKeys]);
  const [progresso] = await db.query(
    "SELECT github_id, job_id, status FROM user_roadmap_progress WHERE github_id IN (?) AND job_id IN (?)", [devKeys, jobIds]);
  const [candidaturas] = await db.query(`
    SELECT job_id, dev_github_id AS dev, DATE_FORMAT(created_at, '%Y-%m-%d') AS d
    FROM job_applications WHERE dev_github_id IN (?) AND job_id IN (?)`, [devKeys, jobIds]);

  return { actions, jobs, jobSkills, devs, skills, progresso, candidaturas };
}

async function gerar(db, query, hoje = hojeSP()) {
  const periodo = resolverPeriodo(query, hoje); // valida antes de tocar no banco
  return calcular(await carregarDados(db, periodo), periodo);
}

// ── Exportação (PDF/Excel via services/relatorioExport) ──
const dataBr = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const sinal = (v, suf) => (v == null ? "—" : `${v > 0 ? "+" : ""}${String(v).replace(".", ",")}${suf}`);
const num1 = (n, suf = "") => (n == null ? "—" : `${String(n).replace(".", ",")}${suf}`);

function paraExport(r) {
  const k = r.kpis;
  return {
    titulo: "Compatibilidade de matchs",
    descricao: "Percentuais de compatibilidade.",
    periodo: `${dataBr(r.periodo.from)} a ${dataBr(r.periodo.to)}`,
    nota: "Match realizado = decisão da empresa (aceito ou recusado) sobre um dev para uma vaga. A compatibilidade é o % de match de hoje do par dev x vaga. O tempo para aceite considera só devs que se candidataram à vaga.",
    secoes: [
      {
        titulo: "Indicadores", colunas: ["Indicador", "Valor", "Detalhe"], larguras: [0.3, 0.14, 0.56], esquerda: [2],
        linhas: [
          ["Total de matchs realizados", k.total.total, `${k.total.aceitos} aceitos / ${k.total.recusados} recusados · variação ${sinal(k.total.variacao_pct, "%")}`],
          ["Taxa geral de aceitação", num1(k.aceitacao.taxa, "%"), `variação ${sinal(k.aceitacao.variacao_pp, " p.p.")}`],
          ["Compatibilidade média", num1(k.compatibilidade.media, "%"), `variação ${sinal(k.compatibilidade.variacao_pp, " p.p.")}`],
          ["Tempo médio para match aceito", num1(k.tempo_aceite.dias, " dias"), `variação ${sinal(k.tempo_aceite.variacao_dias, " dias")}`],
        ],
      },
      { titulo: "Perfil do dev vs requisitos da vaga", colunas: ["Categoria", "Perfil dev", "Requisitos vaga", "Pares"],
        linhas: r.categorias.map(c => [c.label, c.perfil == null ? "—" : `${num1(c.perfil)}%`, c.requisito == null ? "—" : `${num1(c.requisito)}%`, c.amostra]) },
      { titulo: "Matchs aceitos por nível de senioridade", colunas: ["Nível", "Decisões", "Aceitos", "Taxa"],
        linhas: r.por_nivel.map(n => [n.label, n.total, n.aceitos, n.taxa == null ? "—" : `${n.taxa}%`]) },
      { titulo: "Top matchs do período", colunas: ["Dev", "Empresa", "Vaga", "Compatibilidade"], larguras: [0.26, 0.2, 0.34, 0.2],
        linhas: r.ranking.map(m => [m.nome, m.company || "—", m.job_title, `${m.score}%`]) },
    ],
  };
}

const nomeArquivo = (r, ext) => `relatorio-compatibilidade-de-matchs_${r.periodo.from}_a_${r.periodo.to}.${ext}`;

module.exports = { calcular, carregarDados, gerar, paraExport, nomeArquivo, NIVEIS };
