require("dotenv").config();

if (!process.env.APP_URL) {
  console.error(
    "[config] Variável de ambiente APP_URL não definida. Defina-a explicitamente " +
    "(ex.: http://localhost:3000 em dev, https://newapice22.onrender.com em produção) " +
    "— ela é usada para montar a redirect_uri do login GitHub OAuth."
  );
  process.exit(1);
}

const express      = require("express");
const session      = require("express-session");
const path         = require("path");
const MySQLStore   = require("express-mysql-session")(session);
const helmet       = require("helmet");
const rateLimit    = require("express-rate-limit");
const db           = require("./database/db");
const { getLatestInsights } = require("./services/marketInsights");

const app = express();
const isProd = process.env.NODE_ENV === "production";

if (isProd) app.set("trust proxy", 1);

// ── Segurança: cabeçalhos HTTP ────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'"],
      styleSrc:    ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc:     ["'self'", "https://fonts.gstatic.com"],
      imgSrc:      ["'self'", "data:", "https://avatars.githubusercontent.com"],
      connectSrc:  ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// ── Rate limiting: autenticação ───────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      20,
  message:  { error: "Muitas tentativas. Aguarde 15 minutos e tente novamente." },
  standardHeaders: true,
  legacyHeaders:   false,
});

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

app.use(express.static("public"));
app.use(express.json());
app.get("/favicon.ico", (req, res) => {
  res.type("image/webp").sendFile(path.join(__dirname, "public", "img", "principal-gradiente.webp"));
});

// ── Handler de JSON malformado ────────────────────────────
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "JSON inválido na requisição." });
  }
  next(err);
});

app.use(session({
  secret:            process.env.SESSION_SECRET,
  resave:            false,
  saveUninitialized: false,
  store:             new MySQLStore({}, db),
  cookie: {
    secure:   isProd,
    httpOnly: true,
    sameSite: "lax",
    maxAge:   24 * 60 * 60 * 1000,
  },
}));

// ── Middlewares de auth ───────────────────────────────────
const { exposeUser, requireAuth, requireCompany, requireAdmin, redirectIfAuth } = require("./middlewares/auth");

// Expõe `user` para todos os templates, sem o accessToken do GitHub (QA-004)
app.use(exposeUser);

// ── Páginas públicas ──────────────────────────────────────
app.get("/", async (req, res) => {
  let stats      = { devs: 0, jobs: 0, skills: 0 };
  let recentJobs = [];
  try {
    const [[d]] = await db.query("SELECT COUNT(*) AS n FROM users WHERE type = 'dev'");
    const [[j]] = await db.query("SELECT COUNT(*) AS n FROM jobs WHERE active = 1");
    const [[s]] = await db.query("SELECT COUNT(*) AS n FROM skills");
    const [jobs] = await db.query(
      "SELECT id, title, company, level, location, modality FROM jobs WHERE active = 1 ORDER BY created_at DESC LIMIT 6"
    );
    stats      = { devs: d.n, jobs: j.n, skills: s.n };
    recentJobs = jobs;
  } catch (_) {}
  res.render("index", { stats, recentJobs });
});

app.get("/login",    redirectIfAuth, (req, res) => res.render("login"));
app.get("/cadastro", redirectIfAuth, (req, res) => res.render("cadastro"));

app.get("/esqueci-senha",   redirectIfAuth, (req, res) => res.render("esqueci-senha"));
app.get("/redefinir-senha", redirectIfAuth, (req, res) => res.render("redefinir-senha"));

// Vagas — pública, mas mostra sidebar se autenticado
// SEO (QA-020): renderiza a lista inicial de vagas no servidor — sem isso,
// um crawler sem JS via um "Carregando..." em vez das vagas de verdade.
app.get("/vagas", async (req, res) => {
  let jobs = [];
  try {
    const [rows] = await db.query(
      "SELECT id, title, company, description, level FROM jobs WHERE active = 1 ORDER BY id LIMIT 500"
    );
    jobs = rows;
  } catch (_) {}
  res.render("vagas", { currentPage: "vagas", jobs });
});

// SEO (QA-020): renderiza o resumo já cacheado (se existir) no servidor,
// em vez de deixar a página inteira depender do fetch client-side.
app.get("/insights-mercado", async (req, res) => {
  let insights = null;
  try {
    insights = await getLatestInsights();
  } catch (_) {}
  res.render("insights-mercado", { currentPage: "insights-mercado", insights });
});

// ── Área do desenvolvedor ─────────────────────────────────
app.get("/dashboard", requireAuth, async (req, res) => {
  let jobs = [];
  try {
    const [rows] = await Promise.race([
      db.query("SELECT id, title, company, description, level FROM jobs WHERE active = 1 ORDER BY id"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000)),
    ]);
    jobs = rows;
  } catch (_) {}
  const { accessToken, ...safeUser } = req.session.user;
  res.render("dashboard", { currentPage: "dashboard", jobs, user: safeUser });
});

app.get("/meu-progresso", requireAuth, (req, res) => {
  res.render("progresso", { currentPage: "progresso" });
});

app.get("/repositorios", requireAuth, (req, res) => {
  if (req.session.user.type !== "dev") return res.redirect("/empresa/dashboard");
  res.render("repositorios", { currentPage: "repositorios" });
});

app.get("/roadmap", requireAuth, (req, res) => {
  res.render("roadmap", { currentPage: "roadmap" });
});

app.get("/mensagens", requireAuth, (req, res) => {
  if (req.session.user.type !== "dev") return res.redirect("/empresa/mensagens");
  res.render("mensagens", { currentPage: "mensagens" });
});

app.get("/mentor", requireAuth, (req, res) => {
  if (req.session.user.type !== "dev") return res.redirect("/empresa/dashboard");
  res.render("mentor", { currentPage: "mentor" });
});

app.get("/entrevista", requireAuth, (req, res) => {
  if (req.session.user.type !== "dev") return res.redirect("/empresa/dashboard");
  res.render("entrevista", { currentPage: "entrevista" });
});

// ── Área da empresa ───────────────────────────────────────
app.get("/empresa/dashboard", requireCompany, (req, res) => {
  res.render("empresa-dashboard", { currentPage: "empresa-dashboard" });
});

app.get("/empresa/vagas", requireCompany, (req, res) => {
  res.render("empresa-vagas", { currentPage: "empresa-vagas" });
});

app.get("/empresa/desenvolvedores", requireCompany, (req, res) => {
  res.render("empresa-desenvolvedores", { currentPage: "empresa-devs" });
});

app.get("/empresa/matchs", requireCompany, (req, res) => {
  res.render("empresa-matchs", { currentPage: "empresa-matchs" });
});

app.get("/empresa/mensagens", requireCompany, (req, res) => {
  res.render("empresa-mensagens", { currentPage: "empresa-mensagens" });
});

app.get("/empresa/dev/:id", requireCompany, (req, res) => {
  const devId = Number(req.params.id);
  if (!Number.isInteger(devId) || devId <= 0) return res.redirect("/empresa/desenvolvedores");
  res.render("perfil-dev-empresa", { currentPage: "empresa-devs", devId });
});

app.get("/empresa/vagas/nova", requireCompany, async (req, res) => {
  const [allSkills] = await db.query(
    "SELECT id, name, type, category FROM skills ORDER BY type, category, name"
  );
  res.render("empresa-vaga-form", {
    currentPage: "empresa-vagas", job: null, jobSkills: [], allSkills, isEdit: false,
  });
});

app.get("/empresa/vagas/:id/editar", requireCompany, async (req, res) => {
  const jobId = req.params.id;
  try {
    const [jobs] = await db.query(
      "SELECT * FROM jobs WHERE id = ? AND company_id = ?",
      [jobId, req.session.user.id]
    );
    if (!jobs.length) return res.redirect("/empresa/vagas");

    const [[allSkills], [jobSkills]] = await Promise.all([
      db.query("SELECT id, name, type, category FROM skills ORDER BY type, category, name"),
      db.query(`
        SELECT js.skill_id, js.importance, s.name, s.type, s.category
        FROM job_skills js JOIN skills s ON s.id = js.skill_id
        WHERE js.job_id = ? ORDER BY js.importance DESC, js.learn_order
      `, [jobId]),
    ]);

    res.render("empresa-vaga-form", {
      currentPage: "empresa-vagas", job: jobs[0], jobSkills, allSkills, isEdit: true,
    });
  } catch (err) {
    console.error(err.message);
    res.redirect("/empresa/vagas");
  }
});

// Vaga pública individual
// SEO (QA-020): busca título/descrição no servidor pra título, meta
// description, Open Graph e <h1> existirem no HTML inicial — o resto
// (match, skills, candidatura) continua vindo do fetch client-side.
app.get("/vagas/:id", async (req, res) => {
  const jobId = Number(req.params.id);
  let job = null;
  try {
    const [rows] = await db.query(
      "SELECT id, title, description, company FROM jobs WHERE id = ?",
      [jobId]
    );
    job = rows[0] ?? null;
  } catch (_) {}
  res.render("vaga-publica", { jobId, job });
});

// ── Área do administrador ─────────────────────────────────
app.get("/admin/dashboard",      requireAdmin, (req, res) => res.render("admin-dashboard",      { currentPage: "admin-dashboard" }));
app.get("/admin/usuarios",       requireAdmin, (req, res) => res.render("admin-usuarios",        { currentPage: "admin-usuarios" }));
app.get("/admin/empresas",       requireAdmin, (req, res) => res.render("admin-empresas",        { currentPage: "admin-empresas" }));
app.get("/admin/vagas",          requireAdmin, (req, res) => res.render("admin-vagas",           { currentPage: "admin-vagas" }));
app.get("/admin/matchs",         requireAdmin, (req, res) => res.render("admin-matchs",          { currentPage: "admin-matchs" }));
app.get("/admin/relatorios",     requireAdmin, (req, res) => res.render("admin-relatorios",      { currentPage: "admin-relatorios" }));
app.get("/admin/configuracoes",  requireAdmin, (req, res) => res.render("admin-configuracoes",   { currentPage: "admin-configuracoes" }));

// ── API ───────────────────────────────────────────────────
app.get("/api/user", (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: "Não autenticado" });
  const { accessToken, ...safeUser } = req.session.user;
  res.json(safeUser);
});

// ── Área de perfil ────────────────────────────────────────
app.get("/perfil", requireAuth, (req, res) => {
  if (req.session.user.type === "empresa") return res.redirect("/empresa/perfil");
  res.render("perfil-dev", { currentPage: "perfil" });
});

app.get("/empresa/perfil", requireCompany, (req, res) => {
  res.render("perfil-empresa", { currentPage: "perfil" });
});

// ── Rotas modulares ───────────────────────────────────────
const authRoutes        = require("./routes/auth");
const userRoutes        = require("./routes/users");
const profileRoutes     = require("./routes/profile");
const roadmapRoutes     = require("./routes/roadmap");
const empresaRoutes     = require("./routes/empresa");
const repositoriosRoutes = require("./routes/repositorios");
const adminRoutes       = require("./routes/admin");
const messagesRoutes    = require("./routes/messages");
const companyPublicRoutes = require("./routes/company-public");
const aiRoutes           = require("./routes/ai");

app.use("/auth",        authRoutes);
app.use("/api/auth",    authLimiter, userRoutes);
app.use("/api/user",    profileRoutes);
app.use("/api/user",    repositoriosRoutes);
app.use("/api",         roadmapRoutes);
app.use("/api/empresa", empresaRoutes);
app.use("/api/admin",   adminRoutes);
app.use("/api/messages", messagesRoutes);
app.use("/api/empresas", companyPublicRoutes);
app.use("/api/ai",      aiRoutes);

// ── 404 ───────────────────────────────────────────────────
app.use((req, res) => {
  if (req.accepts("html")) return res.status(404).render("404");
  res.status(404).json({ error: "Rota não encontrada." });
});

// ── 500 ───────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error("[Erro global]", err.message);
  if (req.accepts("html")) return res.status(500).render("500");
  res.status(500).json({ error: "Erro interno. Tente novamente." });
});

// ── Start ─────────────────────────────────────────────────
// Espera as migrações automáticas (db.js) terminarem antes de aceitar
// requisições — sem isso, toda vez que o servidor reinicia (todo deploy)
// existe uma janela onde uma rota pode bater numa coluna/tabela nova
// que a migração ainda não criou, e cair num 500.
const PORT = process.env.PORT || 3000;
db.ready
  .catch(() => {}) // testarConexao() já loga o próprio erro; aqui só evita unhandled rejection
  .finally(() => {
    app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
  });
