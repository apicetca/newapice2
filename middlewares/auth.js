// Expõe `req.session.user` como `res.locals.user` para os templates EJS,
// sem o `accessToken` do GitHub (QA-004) — a sessão inteira nunca deve
// chegar a um template.
function exposeUser(req, res, next) {
  if (!req.session?.user) {
    res.locals.user = null;
    return next();
  }
  const { accessToken, ...safeUser } = req.session.user;
  res.locals.user = safeUser;
  next();
}

// Página inicial de cada tipo de conta — usada pra nunca jogar alguém no fluxo errado.
function homeFor(type) {
  if (type === "admin")   return "/admin/dashboard";
  if (type === "empresa") return "/empresa/dashboard";
  return "/dashboard";
}

function requireAuth(req, res, next) {
  if (!req.session?.user) return res.redirect("/login");
  next();
}


function requireCompany(req, res, next) {
  if (!req.session?.user) return res.redirect("/login");
  if (req.session.user.type !== "empresa") return res.redirect(homeFor(req.session.user.type));
  next();
}

function requireDev(req, res, next) {
  if (!req.session?.user) return res.redirect("/login");
  if (req.session.user.type !== "dev") return res.redirect(homeFor(req.session.user.type));
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session?.user) return res.redirect("/login");
  if (req.session.user.type !== "admin") return res.redirect(homeFor(req.session.user.type));
  next();
}

function redirectIfAuth(req, res, next) {
  if (!req.session?.user) return next();
  return res.redirect(homeFor(req.session.user.type));
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

function isAdmin(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: "Não autenticado" });
  if (req.session.user.type !== "admin") return res.status(403).json({ error: "Acesso restrito a administradores" });
  next();
}

module.exports = { exposeUser, requireAuth, requireCompany, requireDev, requireAdmin, redirectIfAuth, homeFor, isAuth, isEmpresa, isAdmin };
