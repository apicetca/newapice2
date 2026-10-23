// quiet: o dotenv 17 imprime uma "dica" a cada subida (◇ injected env ...).
require("dotenv").config({ quiet: true });

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
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc:    ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc:     ["'self'", "https://fonts.gstatic.com"],
      imgSrc:      ["'self'", "data:", "https://avatars.githubusercontent.com"],
      connectSrc:  ["'self'", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
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

// ── Rate limiting: IA (chamadas ao Gemini custam tokens reais,
// e o mentor com function calling pode disparar múltiplas chamadas
// por mensagem) ────────────────────────────────────────────
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      30,
  message:  { error: "Muitas requisições à IA. Aguarde alguns minutos e tente novamente." },
  standardHeaders: true,
  legacyHeaders:   false,
});

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

app.use(express.static("public"));
app.use(express.json());

// Rotas de API nunca devem ser cacheadas pelo navegador. Cache-Control
// sozinho não basta: o Express calcula e envia ETag mesmo assim, e no
// próximo request o navegador manda If-None-Match — o servidor responde
// 304 sem corpo, e todo fetch() que espera JSON (res.json()) quebra
// tentando parsear um corpo vazio. Apagar o header aqui não adianta (o
// ETag só existe depois que a rota chama res.json()) — em vez disso,
// removemos o If-None-Match recebido, então o Express nunca considera
// a resposta "fresca" e nunca decide responder 304.
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  delete req.headers["if-none-match"];
  next();
});
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

// ── Webhook do Mercado Pago ───────────────────────────────
// Antes da sessão: quem chama é o Mercado Pago, não um usuário logado
// (e não há proteção CSRF a liberar — o site usa cookie sameSite=lax).
app.use("/webhooks", require("./routes/webhooks"));

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
const { exposeUser, requireAuth, requireCompany, requireDev, requireAdmin, redirectIfAuth } = require("./middlewares/auth");

// Expõe `user` para todos os templates, sem o accessToken do GitHub (QA-004)
app.use(exposeUser);

// ── Páginas públicas ──────────────────────────────────────
app.get("/", async (req, res) => {
  let stats = { devs: 0, jobs: 0, skills: 0 };
  try {
    const [[d]] = await db.query("SELECT COUNT(*) AS n FROM users WHERE type = 'dev'");
    const [[j]] = await db.query("SELECT COUNT(*) AS n FROM jobs WHERE active = 1");
    const [[s]] = await db.query("SELECT COUNT(*) AS n FROM skills");
    stats = { devs: d.n, jobs: j.n, skills: s.n };
  } catch (_) {}
  res.render("index", { stats });
});

// Só o /login redireciona quem já tem sessão; as demais páginas do fluxo de visitante nunca "entram" na conta salva.
app.get("/login",    redirectIfAuth, (req, res) => res.render("login"));
app.get("/cadastro",(req, res) => res.render("cadastro"));

app.get("/esqueci-senha",  (req, res) => res.render("esqueci-senha"));
app.get("/redefinir-senha",(req, res) => res.render("redefinir-senha"));

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
  const viewer = req.session?.user?.type === "empresa" ? "empresa" : req.session?.user?.type === "dev" ? "dev" : "visitante";
  res.render("vagas", { currentPage: viewer === "empresa" ? "empresa-vagas" : "vagas", jobs, viewer });
});

// Página pública de apresentação dos planos para devs (menu "Para Devs").
app.get("/para-devs", (req, res) => {
  // Preço do config/plans.js — o mesmo cobrado no Mercado Pago (só mensal).
  const pro = (getPlan("dev_pro").price_cents / 100).toFixed(2).replace(".", ",").replace(/,00$/, "");
  res.render("para-devs", {
    currentPage: "para-devs",
    prices: { free: 0, pro },
  });
});

// Página pública de apresentação dos planos para empresas (menu "Para Empresas").
app.get("/para-empresas", (req, res) => {
  // Preços e limites vêm de config/plans.js — os mesmos cobrados no Mercado Pago.
  const reais = (cents) => (cents / 100).toFixed(2).replace(".", ",").replace(/,00$/, "");
  const basico  = getPlan("empresa_basico");
  const premium = getPlan("empresa_premium");
  res.render("para-empresas", {
    currentPage: "para-empresas",
    planos: {
      free:    { vagas: getPlan("empresa_free").max_active_jobs },
      basico:  { preco: reais(basico.price_cents), vagas: basico.max_active_jobs },
      premium: { preco: reais(premium.price_cents) },
    },
  });
});

app.get("/sobre", async (req, res) => {
  let stats = { devs: 0, jobs: 0, skills: 0 };
  try {
    const [[d]] = await db.query("SELECT COUNT(*) AS n FROM users WHERE type = 'dev'");
    const [[j]] = await db.query("SELECT COUNT(*) AS n FROM jobs WHERE active = 1");
    const [[s]] = await db.query("SELECT COUNT(*) AS n FROM skills");
    stats = { devs: d.n, jobs: j.n, skills: s.n };
  } catch (_) {}
  // Página institucional sempre pública: ignora a sessão e renderiza como visitante.
  res.render("sobre", { currentPage: "sobre", stats, viewer: "visitante", user: null });
});

// SEO (QA-020): renderiza o resumo já cacheado (se existir) no servidor,
// em vez de deixar a página inteira depender do fetch client-side.
app.get("/insights-mercado", async (req, res) => {
  let insights = null;
  try {
    insights = await getLatestInsights();
  } catch (_) {}
  const viewer = req.session?.user?.type === "empresa" ? "empresa" : req.session?.user?.type === "dev" ? "dev" : "visitante";
  res.render("insights-mercado", { currentPage: "insights-mercado", insights, viewer });
});

// ── Área do desenvolvedor ─────────────────────────────────
app.get("/dashboard", requireDev, async (req, res) => {
  let jobs = [];
  try {
    const [rows] = await Promise.race([
      db.query("SELECT id, title, company, description, level FROM jobs WHERE active = 1 ORDER BY id"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000)),
    ]);
    jobs = rows;
    const preview = jobs.slice(0, 2);
    if (preview.length) {
      const [skillRows] = await db.query(
        `SELECT js.job_id, s.name FROM job_skills js JOIN skills s ON s.id = js.skill_id
         WHERE js.job_id IN (?) ORDER BY js.importance DESC, js.learn_order`,
        [preview.map(j => j.id)]
      );
      for (const j of preview) {
        j.skills = skillRows.filter(r => r.job_id === j.id).slice(0, 6).map(r => r.name);
      }
    }
  } catch (_) {}
  // Roadmap ativo (sistema novo, /trilha) — alimenta o card "Tarefas do Roadmap".
  let trilha = null;
  try {
    const [[roadmap]] = await db.query(
      "SELECT id FROM roadmaps WHERE usuario_id = ? AND status = 'ativo' ORDER BY gerado_em DESC LIMIT 1",
      [req.session.user.id]
    );
    if (roadmap) {
      const [fases] = await db.query(
        "SELECT id, nome, ordem, projeto_status FROM roadmap_fases WHERE roadmap_id = ? ORDER BY ordem",
        [roadmap.id]
      );
      const [etapas] = await db.query(
        `SELECT re.id, re.fase_id, re.titulo, re.status
         FROM roadmap_etapas re JOIN roadmap_fases rf ON rf.id = re.fase_id
         WHERE rf.roadmap_id = ? ORDER BY rf.ordem, re.ordem`,
        [roadmap.id]
      );
      const porFase = {};
      for (const e of etapas) (porFase[e.fase_id] ??= []).push(e);
      const concluidas = etapas.filter(e => e.status === "concluida").length;
      trilha = {
        id: roadmap.id,
        pct: etapas.length ? Math.round((concluidas / etapas.length) * 100) : 0,
        fases: fases.map(f => ({
          id: f.id,
          nome: f.nome,
          projetoStatus: f.projeto_status,
          etapas: (porFase[f.id] ?? []).map(e => ({ id: e.id, titulo: e.titulo, status: e.status })),
        })),
      };
    }
  } catch (_) {}
  const { accessToken, ...safeUser } = req.session.user;
  res.render("dashboard", { currentPage: "dashboard", jobs, user: safeUser, trilha });
});

app.get("/meu-progresso", requireDev, (req, res) => {
  res.render("progresso", { currentPage: "progresso" });
});

app.get("/repositorios", requireAuth, (req, res) => {
  if (req.session.user.type !== "dev") return res.redirect("/empresa/dashboard");
  res.render("repositorios", { currentPage: "repositorios" });
});

app.get("/roadmap", requireDev, (req, res) => {
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

// O simulador de entrevista virou parte do mentor de carreira: links
// antigos para /entrevista caem direto no mentor.
app.get("/entrevista", (req, res) => res.redirect("/mentor"));

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

app.get("/empresa/vagas/:id/candidaturas", requireCompany, (req, res) => {
  const jobId = Number(req.params.id);
  if (!Number.isInteger(jobId) || jobId <= 0) return res.redirect("/empresa/vagas");
  res.render("empresa-candidaturas", { currentPage: "empresa-vagas", jobId });
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
      "SELECT id, title, description, company, company_id FROM jobs WHERE id = ?",
      [jobId]
    );
    job = rows[0] ?? null;
  } catch (_) {}
  const sessionUser = req.session?.user;
  const viewer  = sessionUser?.type === "empresa" ? "empresa" : sessionUser?.type === "dev" ? "dev" : "visitante";
  const isOwner = viewer === "empresa" && job != null && job.company_id === sessionUser.id;
  res.render("vaga-publica", { jobId, job, viewer, isOwner, currentPage: viewer === "empresa" ? "empresa-vagas" : "vagas" });
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

// ── Planos ────────────────────────────────────────────────
// Acessível por dev ou empresa (não por admin nem visitante) — usa
// requireAuth em vez de um requireDev/requireCompany específico porque
// o conteúdo se adapta ao tipo (ver plansController.getPlans).
app.get("/planos", requireAuth, (req, res) => {
  if (req.session.user.type === "admin") return res.redirect("/admin/dashboard");
  res.render("planos", { currentPage: "planos", userType: req.session.user.type });
});

// ── Assinatura recorrente (Mercado Pago) ──────────────────
// /planos/:id/assinar faz o próprio redirect de login (volta para cá
// depois). As páginas com o Card Payment Brick recebem a CSP que libera
// os domínios do Mercado Pago (middlewares/mpCheckoutCsp.js).
const assinaturasController = require("./controllers/assinaturasController");
const { mpCheckoutCsp }     = require("./middlewares/mpCheckoutCsp");

app.get("/planos/:id/assinar", mpCheckoutCsp, assinaturasController.assinarPage);
app.get("/assinatura/retorno", assinaturasController.retornoPage);
app.get("/minha-assinatura",   requireAuth, mpCheckoutCsp, assinaturasController.minhaAssinaturaPage);

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
const { getPlan } = require("./config/plans");
const plansRoutes         = require("./routes/plans");
const trilhaRoutes        = require("./routes/trilha");

app.use("/auth",        authRoutes);
app.use("/api/auth",    authLimiter, userRoutes);
app.use("/api/user",    profileRoutes);
app.use("/api/user",    repositoriosRoutes);
app.use("/api",         roadmapRoutes);
app.use("/api/empresa", empresaRoutes);
app.use("/api/admin",   adminRoutes);
app.use("/api/messages", messagesRoutes);
app.use("/api/empresas", companyPublicRoutes);
app.use("/api/ai",      aiLimiter, aiRoutes);
app.use("/api/plans",   plansRoutes);
app.use("/api/assinaturas", require("./routes/assinaturas"));
app.use("/trilha",      trilhaRoutes);

// ── 404 ───────────────────────────────────────────────────
app.use((req, res) => {
  if (req.accepts("html")) return res.status(404).render("404");
  res.status(404).json({ error: "Rota não encontrada." });
});

// ── 500 ───────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  // Método, rota e código (ex.: ER_USER_LIMIT_REACHED, ECONNRESET) para dar
  // para diagnosticar um 500 só pelo log.
  console.error("[Erro global]", req.method, req.originalUrl, err.code ? `[${err.code}]` : "", err.message);
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
    // Cria/atualiza os planos de assinatura no Mercado Pago (idempotente, em
    // segundo plano). Assim cada ambiente precisa só das credenciais — sem
    // rodar npm run mp:sync-plans à mão (o Render gratuito não tem Shell).
    require("./services/mpPlanSync").syncPlansOnStartup();
  });
