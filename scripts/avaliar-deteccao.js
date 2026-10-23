// ============================================
// scripts/avaliar-deteccao.js
// Compara o que a análise do GitHub detecta com um gabarito feito à mão
// (docs/analise-perfil-plano.md, Etapa 9). Só para desenvolvimento.
//
// Para cada github_login do gabarito: busca os repositórios PÚBLICOS do
// próprio usuário (GET /users/{login}/repos?type=owner), ignora forks, roda a
// MESMA função de pontuação do githubAnalyzer (pontuarSkillNoRepo) e compara
// com o gabarito. Saída por skill: acertos, falsos positivos (detectou e não
// tem) e falsos negativos (tem e não detectou).
//
// NÃO grava nada no banco: os sinais das skills são lidos com uma conexão
// própria, só com SELECT.
//
// Uso:  node scripts/avaliar-deteccao.js [caminho do gabarito]
//       (padrão: docs/gabarito-skills.csv)
// Precisa de GITHUB_TOKEN_DEV no .env: um token pessoal do GitHub, sem
// nenhum escopo marcado (basta para ler repositórios públicos).
// ============================================
const fs   = require("fs");
const path = require("path");

const MAX_REPOS = 50; // o mesmo do botão "Reanalisar"

// ── Partes puras (testadas em tests/avaliarDeteccao.test.js) ─────────────

/** Lê o CSV github_login,skill,tem (sim/não). Ignora linhas vazias e "#". */
function lerGabarito(texto) {
  const linhas = String(texto).split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("#"));
  const erros = [];
  const itens = [];
  linhas.forEach((linha, i) => {
    const partes = linha.split(",").map(p => p.trim());
    if (i === 0 && /^github_login$/i.test(partes[0])) return; // cabeçalho
    const [login, skill, tem] = partes;
    const valor = String(tem ?? "").toLowerCase();
    if (!login || !skill || !["sim", "não", "nao", "s", "n"].includes(valor)) {
      erros.push(`linha ${i + 1}: "${linha}" (esperado: github_login,skill,sim|não)`);
      return;
    }
    itens.push({ login, skill, tem: valor === "sim" || valor === "s" });
  });
  return { itens, erros };
}

/**
 * Compara detecções com o gabarito.
 * detectadas: Map(login → Map(nomeSkillMinúsculo → confiança))
 * Retorna por skill { skill, acertos, falsosPositivos, falsosNegativos, casos }.
 */
function compararComGabarito(itens, detectadas) {
  const porSkill = new Map();
  for (const { login, skill, tem } of itens) {
    const conf = detectadas.get(login)?.get(skill.toLowerCase()) ?? 0;
    const detectou = conf > 0;
    const chave = skill.toLowerCase();
    if (!porSkill.has(chave)) porSkill.set(chave, { skill, acertos: 0, falsosPositivos: 0, falsosNegativos: 0, casos: [] });
    const linha = porSkill.get(chave);
    if (detectou === tem) linha.acertos++;
    else if (detectou) { linha.falsosPositivos++; linha.casos.push(`${login}: detectou ${conf}% e não tem`); }
    else { linha.falsosNegativos++; linha.casos.push(`${login}: tem e não detectou`); }
  }
  return [...porSkill.values()].sort((a, b) =>
    (b.falsosPositivos + b.falsosNegativos) - (a.falsosPositivos + a.falsosNegativos) || a.skill.localeCompare(b.skill)
  );
}

// ── Execução ──────────────────────────────────────────────────────────────

async function main() {
  require("dotenv").config();
  const arquivo = path.resolve(process.argv[2] ?? path.join(__dirname, "..", "docs", "gabarito-skills.csv"));
  const token = process.env.GITHUB_TOKEN_DEV;

  if (!fs.existsSync(arquivo)) {
    console.error(`Gabarito não encontrado: ${arquivo}\nCopie docs/gabarito-skills.exemplo.csv para docs/gabarito-skills.csv e preencha.`);
    process.exit(1);
  }
  if (!token) {
    console.error("Defina GITHUB_TOKEN_DEV no .env (token pessoal do GitHub, sem escopos, só para ler repositórios públicos).");
    process.exit(1);
  }

  const { itens, erros } = lerGabarito(fs.readFileSync(arquivo, "utf8"));
  if (erros.length) {
    console.error("Linhas inválidas no gabarito:\n  " + erros.join("\n  "));
    process.exit(1);
  }
  if (!itens.length) {
    console.error("O gabarito está vazio.");
    process.exit(1);
  }

  // A pontuação vem do githubAnalyzer, que carrega database/db (e com ele as
  // migrações automáticas) ao ser importado. As funções usadas aqui não tocam
  // no banco, então database/db é trocado por um módulo vazio só neste script.
  const dbPath = require.resolve("../database/db");
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {} };
  const axios = require("axios");
  const { pontuarSkillNoRepo, lerLinguagens, lerReadme, lerDependencias } = require("../services/githubAnalyzer");

  // Sinais das skills: só leitura, conexão própria.
  const mysql = require("mysql2/promise");
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASS,
  });
  const [rows] = await conn.query("SELECT name, github_signals FROM skills WHERE github_signals IS NOT NULL AND github_signals <> ''");
  await conn.end();
  const skills = rows.map(r => ({ nome: r.name, sinais: r.github_signals.split(",") }));
  const nomesCatalogo = new Set(skills.map(s => s.nome.toLowerCase()));

  const desconhecidas = [...new Set(itens.map(i => i.skill).filter(s => !nomesCatalogo.has(s.toLowerCase())))];
  if (desconhecidas.length) {
    console.warn(`Aviso: skills do gabarito sem sinais no catálogo (vão contar como "não detectada"): ${desconhecidas.join(", ")}\n`);
  }

  const detectadas = new Map();
  for (const login of [...new Set(itens.map(i => i.login))]) {
    let repos;
    try {
      const res = await axios.get(`https://api.github.com/users/${encodeURIComponent(login)}/repos`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { type: "owner", sort: "updated", per_page: MAX_REPOS },
        timeout: 15000,
      });
      repos = res.data.filter(r => !r.fork);
    } catch (err) {
      console.error(`${login}: não foi possível listar os repositórios (${err.response?.status ?? err.code ?? err.message}). Perfil ignorado.`);
      continue;
    }

    const conf = new Map();
    let falhas = 0;
    for (const repo of repos) {
      const [l, r, d] = await Promise.all([
        lerLinguagens(token, repo.full_name), lerReadme(token, repo.full_name), lerDependencias(token, repo.full_name),
      ]);
      if (l.falha || r.falha || d.falha) { falhas++; continue; }
      for (const s of skills) {
        const pontos = pontuarSkillNoRepo(s.sinais, l.valor, r.valor, d.valor);
        if (pontos) conf.set(s.nome.toLowerCase(), Math.min(100, (conf.get(s.nome.toLowerCase()) ?? 0) + pontos));
      }
    }
    detectadas.set(login, conf);
    console.log(`${login}: ${repos.length} repositório(s) próprio(s) lido(s)${falhas ? `, ${falhas} com falha de leitura` : ""}.`);
  }

  const resultado = compararComGabarito(itens.filter(i => detectadas.has(i.login)), detectadas);
  console.log("\n| Skill | Acertos | Falsos positivos | Falsos negativos |\n|---|---|---|---|");
  for (const r of resultado) console.log(`| ${r.skill} | ${r.acertos} | ${r.falsosPositivos} | ${r.falsosNegativos} |`);

  const comErro = resultado.filter(r => r.casos.length);
  if (comErro.length) {
    console.log("\nDetalhe dos erros:");
    for (const r of comErro) console.log(`- ${r.skill}: ${r.casos.join("; ")}`);
  }

  const total = resultado.reduce((t, r) => ({
    acertos: t.acertos + r.acertos, fp: t.fp + r.falsosPositivos, fn: t.fn + r.falsosNegativos,
  }), { acertos: 0, fp: 0, fn: 0 });
  const n = total.acertos + total.fp + total.fn;
  console.log(`\nTotal: ${total.acertos}/${n} acertos (${n ? Math.round(100 * total.acertos / n) : 0}%), ${total.fp} falso(s) positivo(s), ${total.fn} falso(s) negativo(s).`);
  console.log("Muitos falsos positivos numa skill → revise os sinais dela no admin. Muitos falsos negativos → faltam sinais.");
  process.exit(0);
}

if (require.main === module) {
  main().catch(err => { console.error("Erro:", err.message); process.exit(1); });
}

module.exports = { lerGabarito, compararComGabarito };
