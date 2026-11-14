// Registra o uso da plataforma por devs e empresas (tabela usage_events), usado no
// relatório Admin → Relatórios → Uso da plataforma.
//
// Para não pesar no banco, grava no máximo um evento por sessão e módulo a cada
// INTERVAL_MS (controle em memória, por processo). O evento só guarda o id do
// usuário, o tipo, uma chave de sessão com hash (nunca o id real da sessão), o
// módulo e a hora em UTC. Falhas do banco nunca derrubam a requisição.
const crypto = require("crypto");
const db = require("../database/db");

const INTERVAL_MS = 5 * 60 * 1000;
const ultimo = new Map();

// Módulos exibidos no relatório; o resto vira "outros" (só mantém a sessão viva).
const MODULOS = [
  ["roadmap", /^\/(roadmap|trilha|meu-progresso|repositorios)(\/|$)|^\/api\/(roadmap|trilha|user\/repos|user\/skills)(\/|$)/],
  ["vagas",   /^\/vagas(\/|$)|^\/api\/vagas(\/|$)/],
  ["chat",    /^\/(mensagens|empresa\/mensagens|empresa\/matchs)(\/|$)|^\/api\/(messages|empresa\/matchs)(\/|$)/],
  ["mentor",  /^\/(mentor|entrevista)(\/|$)|^\/api\/ai\/(mentor|entrevista)(\/|$)/],
];

// Caminhos que não são "uso" (verificação de sessão, login, saúde).
const IGNORADOS = /^\/(health|favicon\.ico)$|^\/api\/(auth|user)$|^\/api\/auth\//;

function moduloDe(caminho) {
  if (IGNORADOS.test(caminho)) return null;
  for (const [nome, re] of MODULOS) if (re.test(caminho)) return nome;
  return "outros";
}

const chaveDeSessao = (id) => crypto.createHash("sha256").update(String(id)).digest("hex").slice(0, 16);

function trackUsage(req, res, next) {
  const u = req.session?.user;
  if (u && (u.type === "dev" || u.type === "empresa") && req.sessionID) {
    const modulo = moduloDe(String(req.originalUrl).split("?")[0]);
    if (modulo) {
      const sessao = chaveDeSessao(req.sessionID);
      const k = `${sessao}|${modulo}`, agora = Date.now();
      if (agora - (ultimo.get(k) ?? 0) >= INTERVAL_MS) {
        ultimo.set(k, agora);
        if (ultimo.size > 5000) for (const [chave, t] of ultimo) if (agora - t >= INTERVAL_MS) ultimo.delete(chave);
        Promise.resolve(db.query(
          "INSERT INTO usage_events (user_id, user_type, session_key, module, created_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP())",
          [u.id, u.type, sessao, modulo]
        )).catch(err => console.error("[usageTracker]", err.message));
      }
    }
  }
  next();
}

module.exports = { trackUsage, moduloDe, chaveDeSessao, INTERVAL_MS, _ultimo: ultimo };
