// Registra a última atividade do usuário logado (users.last_seen_at), usada
// na coluna "Atividade" de Admin → Usuários. Grava no máximo uma vez a cada
// INTERVAL_MS por usuário (em memória, por processo) e nunca bloqueia nem
// derruba a requisição se o banco falhar.
const db = require("../database/db");

const INTERVAL_MS = 5 * 60 * 1000;
const lastWrite = new Map();

function trackLastSeen(req, res, next) {
  const id = req.session?.user?.id;
  if (id) {
    const now = Date.now();
    if (now - (lastWrite.get(id) ?? 0) >= INTERVAL_MS) {
      lastWrite.set(id, now);
      Promise.resolve(db.query("UPDATE users SET last_seen_at = NOW() WHERE id = ?", [id]))
        .catch(err => console.error("[lastSeen]", err.message));
    }
  }
  next();
}

module.exports = { trackLastSeen, INTERVAL_MS, _lastWrite: lastWrite };
