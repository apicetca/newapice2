function requireAuth(req, res, next) {
  if (!req.session?.user) return res.redirect("/login");
  next();
}


function requireCompany(req, res, next) {
  if (!req.session?.user) return res.redirect("/login");
  if (req.session.user.type !== "empresa") return res.redirect("/dashboard");
  next();
}

function redirectIfAuth(req, res, next) {
  if (!req.session?.user) return next();
  if (req.session.user.type === "empresa") return res.redirect("/empresa/dashboard");
  return res.redirect("/dashboard");
}

function isAuth(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: "Não autenticado." });
  next();
}

function isEmpresa(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: "Não autenticado" });
  if (req.session.user.type !== "empresa") return res.status(403).json({ error: "Acesso restrito a empresas" });
  next();
}

function csrfProtect(req, res, next) {
  const SAFE = ["GET", "HEAD", "OPTIONS"];
  if (SAFE.includes(req.method)) return next();
  const header = req.headers["x-requested-with"];
  if (header === "XMLHttpRequest") return next();
  return res.status(403).json({ error: "Requisição inválida (CSRF)." });
}

module.exports = { requireAuth, requireCompany, redirectIfAuth, isAuth, isEmpresa, csrfProtect };
