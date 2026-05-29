// ============================================
// server.js
// ============================================
require("dotenv").config();
const express = require("express");
const session = require("express-session");

const app = express();

const path = require("path");

// View engine EJS
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

app.use(express.static("public"));
app.use(express.json());

app.use(session({
  secret:            process.env.SESSION_SECRET,
  resave:            false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 },
}));

// Expor `user` para todos os templates (res.locals.user)
app.use((req, res, next) => {
  res.locals.user = req.session ? req.session.user : null;
  next();
});

// ============================================
// PÁGINAS HTML
// ============================================

app.get("/", (req, res) => res.render("index"));

app.get("/vagas", (req, res) => res.render("vagas"));

app.get("/login", (req, res) => res.render("login"));

app.get("/cadastro", (req, res) => res.render("cadastro"));

// Área do desenvolvedor
app.get("/dashboard", (req, res) => res.render("dashboard"));

app.get("/meu-progresso", (req, res) => res.render("progresso"));

app.get("/roadmap", (req, res) => res.render("roadmap"));

// Área da empresa
app.get("/empresa/dashboard", (req, res) => res.render("empresa-dashboard"));

app.get("/minhas-vagas", (req, res) => {
  if (!req.session.user) return res.redirect("/login?next=/minhas-vagas");
  res.render("minhas-vagas");
});

app.get("/perfil", (req, res) => {
  if (!req.session.user) return res.redirect("/login?next=/perfil");
  res.render("perfil");
});

app.get("/configuracoes", (req, res) => {
  if (!req.session.user) return res.redirect("/login?next=/configuracoes");
  res.render("configuracoes");
});

// ============================================
// API
// ============================================
app.get("/api/user", (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "Não autenticado" });
  const { accessToken, ...safeUser } = req.session.user;
  res.json(safeUser);
});

const authRoutes    = require("./routes/auth");
const userRoutes    = require("./routes/users");
const roadmapRoutes = require("./routes/roadmap");
const empresaRoutes = require("./routes/empresa");
const profileRoutes = require("./routes/profile");

app.use("/auth",        authRoutes);
app.use("/api/auth",    userRoutes);
app.use("/api",         roadmapRoutes);
app.use("/api/empresa", empresaRoutes);
app.use("/api/user",    profileRoutes);

// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
  // Roda migration automaticamente ao iniciar (seguro de repetir)
  try {
    const { execSync } = require("child_process");
    execSync("node database/migration.js", { stdio: "inherit" });
  } catch (e) {
    console.warn("Migration automática falhou — rode manualmente: node database/migration.js");
  }
});