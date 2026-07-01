require("dotenv").config();
const express    = require("express");
const session    = require("express-session");
const path       = require("path");
const helmet     = require("helmet");
const MySQLStore = require("express-mysql-session")(session);
const db         = require("./database/db");

const app = express();

app.use(helmet({
  contentSecurityPolicy: false,
}));

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

app.use(express.static("public"));
app.use(express.json());
app.get("/favicon.ico", (req, res) => {
  res.type("image/webp").sendFile(path.join(__dirname, "public", "img", "principal-gradiente.webp"));
});

app.use(session({
  secret:            process.env.SESSION_SECRET,
  resave:            false,
  saveUninitialized: false,
  store:             new MySQLStore({}, db),
  cookie: {
    secure:   process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    maxAge:   24 * 60 * 60 * 1000,
  },
}));

// Expõe `user` para todos os templates
app.use((req, res, next) => {
  res.locals.user = req.session?.user ?? null;
  next();
});

// ── Middlewares de auth ───────────────────────────────────
const { requireAuth, requireCompany, redirectIfAuth, csrfProtect } = require("./middlewares/auth");

app.use("/api", csrfProtect);

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

// Vagas — pública, mas mostra sidebar se autenticado
app.get("/vagas", (req, res) => res.render("vagas", { currentPage: "vagas" }));

// ── Área do desenvolvedor ─────────────────────────────────
app.get("/dashboard", requireAuth, async (req, res) => {
  let jobs = [];
  try {
    const [rows] = await Promise.race([
      db.query("SELECT id, title, company, description, level FROM jobs ORDER BY id"),
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

app.get("/roadmap", requireAuth, (req, res) => {
  res.render("roadmap", { currentPage: "roadmap" });
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
app.get("/vagas/:id", (req, res) => {
  res.render("vaga-publica", { jobId: Number(req.params.id) });
});

// ── Admin: limpa vagas de teste (remover após usar em produção) ──
app.get("/admin/delete-test-jobs", async (req, res) => {
  const titles = ["Eterno Tebas", "entrilhado", "estagio dev", "LAMBERT"];
  try {
    const [result] = await db.query(
      "DELETE FROM jobs WHERE title IN (?)",
      [titles]
    );
    res.json({ deleted: result.affectedRows, titles });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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

app.get("/empresa/dev/:id/perfil", requireCompany, (req, res) => {
  res.render("perfil-dev-publico", { devId: Number(req.params.id), currentPage: "empresa-devs" });
});

// ── Rotas modulares ───────────────────────────────────────
const authRoutes    = require("./routes/auth");
const userRoutes    = require("./routes/users");
const profileRoutes = require("./routes/profile");
const roadmapRoutes = require("./routes/roadmap");
const empresaRoutes = require("./routes/empresa");

app.use("/auth",        authRoutes);
app.use("/api/auth",    userRoutes);
app.use("/api/user",    profileRoutes);
app.use("/api",         roadmapRoutes);
app.use("/api/empresa", empresaRoutes);

// ── Erros ─────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render("404");
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render("500");
});

// ── Start ─────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
