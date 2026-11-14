// Histórico de atividades do painel do administrador (tabela admin_audit_log).
//
// Registra, depois que a resposta sai com sucesso (status < 400), toda requisição
// que ALTERA algo em /api/admin (POST, PATCH, PUT, DELETE). Guarda um título curto
// ("Edição de empresa"), uma frase de detalhe e quem fez — nunca o corpo da
// requisição. Falhas do banco nunca derrubam a requisição.
const db = require("../database/db");

const METODOS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const somenteActive = (b) => "active" in b && Object.keys(b).length === 1;

// [método, padrão do caminho (relativo a /api/admin), título(body), detalhe(body, id)]
const REGRAS = [
  ["PATCH", /^\/users\/(\d+)\/plan$/, () => "Alteração de plano", (b, id) => `Alterou o plano do desenvolvedor #${id} para ${b.plan_code ?? "—"}`],
  ["PATCH", /^\/users\/(\d+)$/, (b) => (somenteActive(b) ? (b.active ? "Reativação de usuário" : "Suspensão de usuário") : "Edição de usuário"),
    (b, id) => (somenteActive(b) ? `${b.active ? "Reativou" : "Suspendeu"} o desenvolvedor #${id}` : `Editou os dados do desenvolvedor #${id}`)],
  ["DELETE", /^\/users\/(\d+)$/, () => "Exclusão de conta", (b, id) => `Excluiu a conta do desenvolvedor #${id}`],
  ["DELETE", /^\/empresas\/(\d+)$/, () => "Exclusão de conta", (b, id) => `Excluiu a conta da empresa #${id}`],
  ["POST", /^\/users\/(\d+)\/skills$/, () => "Edição de usuário", (b, id) => `Declarou uma habilidade para o desenvolvedor #${id}`],
  ["DELETE", /^\/users\/(\d+)\/skills\/\d+$/, () => "Edição de usuário", (b, id) => `Removeu uma habilidade declarada do desenvolvedor #${id}`],
  ["PATCH", /^\/empresas\/(\d+)\/plan$/, () => "Alteração de plano", (b, id) => `Alterou o plano da empresa #${id} para ${b.plan_code ?? "—"}`],
  ["PATCH", /^\/empresas\/(\d+)$/, (b) => (somenteActive(b) ? (b.active ? "Reativação de empresa" : "Suspensão de empresa") : "Edição de empresa"),
    (b, id) => (somenteActive(b) ? `${b.active ? "Reativou" : "Suspendeu"} a empresa #${id}` : `Editou os dados da empresa #${id}`)],
  ["PATCH", /^\/jobs\/(\d+)$/, (b) => (somenteActive(b) ? (b.active ? "Reativação de vaga" : "Pausa de vaga") : "Edição de vaga"),
    (b, id) => (somenteActive(b) ? `${b.active ? "Reativou" : "Pausou"} a vaga #${id}` : `Editou a vaga #${id}`)],
  ["DELETE", /^\/jobs\/(\d+)$/, () => "Exclusão de vaga", (b, id) => `Excluiu a vaga #${id}`],
  ["POST", /^\/job-categories$/, () => "Nova categoria", (b) => `Criou a categoria de vaga "${String(b.nome ?? "").trim().slice(0, 60)}"`],
  ["PATCH", /^\/job-categories\/(\d+)$/, (b) => (somenteActive(b) ? (b.active ? "Ativação de categoria" : "Desativação de categoria") : "Edição de categoria"),
    (b, id) => (somenteActive(b) ? `${b.active ? "Ativou" : "Desativou"} a categoria de vaga #${id}` : `Editou a categoria de vaga #${id}`)],
  ["POST", /^\/skills$/, () => "Catálogo de habilidades", (b) => `Criou a habilidade "${String(b.name ?? "").trim().slice(0, 60)}" no catálogo`],
  ["PATCH", /^\/skills\/(\d+)$/, () => "Catálogo de habilidades", (b, id) => `Editou a habilidade #${id} do catálogo`],
  ["DELETE", /^\/skills\/(\d+)$/, () => "Catálogo de habilidades", (b, id) => `Excluiu a habilidade #${id} do catálogo`],
  ["POST", /^\/skills\/(\d+)\/resources$/, () => "Catálogo de habilidades", (b, id) => `Adicionou um recurso à habilidade #${id}`],
  ["DELETE", /^\/skills\/(\d+)\/resources\/\d+$/, () => "Catálogo de habilidades", (b, id) => `Removeu um recurso da habilidade #${id}`],
  ["DELETE", /^\/admins\/(\d+)$/, () => "Remoção de administrador", (b, id) => `Removeu o administrador #${id}`],
];

function classificar(metodo, caminho, body = {}) {
  const b = body ?? {};
  for (const [m, re, titulo, detalhe] of REGRAS) {
    if (m !== metodo) continue;
    const hit = re.exec(caminho);
    if (hit) return { titulo: titulo(b), detalhe: detalhe(b, hit[1]) };
  }
  const bruto = `${metodo} ${caminho}`.slice(0, 255);
  return { titulo: "Alteração no painel", detalhe: bruto };
}

const descrever = (metodo, caminho, body) => classificar(metodo, caminho, body).detalhe;

function auditarAdmin(req, res, next) {
  if (!METODOS.has(req.method)) return next();
  res.on("finish", () => {
    if (res.statusCode >= 400) return;
    const admin = req.session?.user;
    if (!admin) return;
    const caminho = String(req.originalUrl).split("?")[0].replace(/^\/api\/admin/, "");
    const { titulo, detalhe } = classificar(req.method, caminho, req.body);
    Promise.resolve(db.query(
      "INSERT INTO admin_audit_log (admin_id, admin_nome, acao, titulo) VALUES (?, ?, ?, ?)",
      [admin.id, String(admin.name ?? admin.email ?? "Administrador").slice(0, 100), detalhe, titulo]
    )).catch(err => console.error("[adminAudit]", err.message));
  });
  next();
}

module.exports = { auditarAdmin, descrever, classificar };
