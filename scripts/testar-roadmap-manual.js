// ============================================
// scripts/testar-roadmap-manual.js
// Teste manual de fumaça pro services/roadmapService.js: gera um roadmap
// REAL (chama a IA de verdade, grava no banco de verdade) para um usuário
// de teste, mostra o resultado formatado no terminal e, por padrão, limpa
// o que criou — isso usa o mesmo banco de produção (Clever Cloud), não um
// banco de teste separado, então não deixa lixo lá por padrão.
//
// Uso:
//   node scripts/testar-roadmap-manual.js                      → área front-end, 10h/semana
//   node scripts/testar-roadmap-manual.js area back-end 20     → área back-end, 20h/semana
//   node scripts/testar-roadmap-manual.js vaga <jobId> 10      → objetivo = vaga específica
//   node scripts/testar-roadmap-manual.js vaga                 → objetivo = primeira vaga ativa encontrada
//
// Flags:
//   --manter   não deleta o roadmap (nem o usuário de teste, se foi criado agora) no final
// ============================================
require("dotenv").config();
const db = require("../database/db");
const { gerarRoadmap } = require("../services/roadmapService");

const EMAIL_USUARIO_TESTE = "roadmap.teste@apice.dev";

function parseArgs(argv) {
  const manter = argv.includes("--manter");
  const posicionais = argv.filter(a => !a.startsWith("--"));
  const [tipo = "area", seg, terceiro] = posicionais;

  if (tipo === "vaga") {
    return { tipo: "vaga", vagaId: seg ? Number(seg) : null, horasSemana: Number(terceiro) || 10, manter };
  }
  return { tipo: "area", area: seg || "front-end", horasSemana: Number(terceiro) || 10, manter };
}

async function obterOuCriarUsuarioTeste() {
  const [existentes] = await db.query("SELECT id FROM users WHERE email = ?", [EMAIL_USUARIO_TESTE]);
  if (existentes.length) return { id: existentes[0].id, criadoAgora: false };

  const [result] = await db.query(
    "INSERT INTO users (email, password_hash, type) VALUES (?, 'teste-sem-senha-nao-faz-login', 'dev')",
    [EMAIL_USUARIO_TESTE]
  );
  const usuarioId = result.insertId;
  await db.query(
    "INSERT INTO user_dev_profiles (user_id, nome, nivel) VALUES (?, 'Usuário de Teste (roadmap)', 'iniciante')",
    [usuarioId]
  );
  return { id: usuarioId, criadoAgora: true };
}

async function resolverVagaId(vagaIdInformado) {
  if (vagaIdInformado) return vagaIdInformado;
  const [[job]] = await db.query("SELECT id, title FROM jobs WHERE active = 1 ORDER BY id LIMIT 1");
  if (!job) throw new Error("Nenhuma vaga ativa encontrada no banco pra usar como objetivo de teste.");
  console.log(`(nenhum vagaId informado — usando a primeira vaga ativa: #${job.id} "${job.title}")\n`);
  return job.id;
}

async function buscarTitulosDosRecursos(recursoIds) {
  const idsUnicos = [...new Set(recursoIds.filter(id => id != null))];
  if (!idsUnicos.length) return {};
  const [rows] = await db.query(
    `SELECT id, titulo, url FROM recursos WHERE id IN (${idsUnicos.map(() => "?").join(",")})`,
    idsUnicos
  );
  const mapa = {};
  for (const r of rows) mapa[r.id] = r;
  return mapa;
}

function imprimirRoadmap(resultado, mapaRecursos) {
  console.log("═".repeat(70));
  console.log(`ROADMAP #${resultado.roadmapId} — origem: ${resultado.origem.toUpperCase()} — versão: ${resultado.versao}`);
  console.log("═".repeat(70));

  resultado.fases.forEach((fase, i) => {
    console.log(`\nFase ${i + 1}: ${fase.nome}`);
    console.log(`  Objetivo: ${fase.objetivo}`);
    console.log(`  Etapas:`);
    fase.etapas.forEach((etapa, j) => {
      const recurso = etapa.recurso_id != null ? mapaRecursos[etapa.recurso_id] : null;
      const recursoLabel = recurso
        ? `${recurso.titulo} (${recurso.url})`
        : "— sem recurso cadastrado (registrado em recursos_pendentes) —";
      console.log(`    ${j + 1}. [${etapa.habilidade}] ${etapa.titulo} (~${etapa.horas_estimadas}h) — status: ${etapa.status}`);
      console.log(`       descrição: ${etapa.descricao}`);
      console.log(`       recurso:   ${recursoLabel}`);
    });
    console.log(`  Projeto prático: ${fase.projeto.enunciado}`);
    console.log(`    Habilidades demonstradas: ${fase.projeto.habilidades.join(", ")}`);
  });

  console.log("\n" + "═".repeat(70));
}

async function limpar(roadmapId, usuario) {
  await db.query("DELETE FROM roadmaps WHERE id = ?", [roadmapId]);
  if (usuario.criadoAgora) {
    await db.query("DELETE FROM users WHERE id = ?", [usuario.id]); // cascade remove user_dev_profiles
  }
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  await db.ready;

  const usuario = await obterOuCriarUsuarioTeste();
  console.log(`Usuário de teste: id=${usuario.id} (${usuario.criadoAgora ? "criado agora" : "já existia"})`);

  const objetivo = args.tipo === "vaga"
    ? { tipo: "vaga", vagaId: await resolverVagaId(args.vagaId) }
    : { tipo: "area", area: args.area };

  console.log(`Objetivo: ${JSON.stringify(objetivo)} — ${args.horasSemana}h/semana`);
  console.log("Gerando roadmap (chamada real à IA — pode levar alguns segundos)...\n");

  const inicio = Date.now();
  const resultado = await gerarRoadmap(usuario.id, objetivo, args.horasSemana);
  const duracaoSegundos = ((Date.now() - inicio) / 1000).toFixed(1);

  const todosRecursoIds = resultado.fases.flatMap(f => f.etapas.map(e => e.recurso_id));
  const mapaRecursos = await buscarTitulosDosRecursos(todosRecursoIds);

  imprimirRoadmap(resultado, mapaRecursos);
  console.log(`(gerado em ${duracaoSegundos}s)`);

  if (args.manter) {
    console.log(`\n--manter passado: roadmap #${resultado.roadmapId} e o usuário de teste (se criado agora) ficaram no banco.`);
  } else {
    await limpar(resultado.roadmapId, usuario);
    console.log(`\nLimpeza: roadmap #${resultado.roadmapId}${usuario.criadoAgora ? " e o usuário de teste" : ""} removido(s) do banco.`);
  }

  process.exit(0);
}

run().catch(err => {
  console.error("❌ Erro no teste manual do roadmap:", err.message);
  console.error(err.stack);
  process.exit(1);
});
