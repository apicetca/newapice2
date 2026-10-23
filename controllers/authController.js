const axios  = require("axios");
const crypto = require("crypto");
const db     = require("../database/db");
const { matchSkillsFromGitHub } = require("../services/githubAnalyzer");
const { clearHistory: clearMentorHistory } = require("../services/mentorChat");
const { safeNextPath } = require("../middlewares/auth");

// APP_URL é validada em server.js na subida do processo — aqui já é garantida.
const GITHUB_CALLBACK_PATH = "/auth/github/callback";
const REDIRECT_URI = `${process.env.APP_URL}${GITHUB_CALLBACK_PATH}`;
const APP_HOST = new URL(process.env.APP_URL).host;

// Logins com GitHub em andamento nesta sessão (state anti-CSRF + página de
// retorno). São vários, não só o último: quem clica de novo em "Continuar
// com GitHub" (ou abre duas abas) enquanto o GitHub pede a verificação do
// dispositivo sobrescrevia o state, e a volta do primeiro login dava
// "state inválido". Cada state vale por 10 minutos e só uma vez.
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const OAUTH_MAX_PENDING  = 5;

function pendingLogins(session, now) {
  return (Array.isArray(session.oauthStates) ? session.oauthStates : [])
    .filter(p => p && typeof p.state === "string" && p.exp > now);
}

const authController = {
  githubLogin: (req, res) => {
    // O GitHub sempre volta para APP_URL. Se o login começou em outro
    // endereço (ex.: 127.0.0.1:3000 com APP_URL=http://localhost:3000), o
    // cookie da sessão não voltaria junto e o state se perderia — então,
    // em desenvolvimento, recomeça o login no endereço certo.
    if (process.env.NODE_ENV !== "production" && req.get("host") !== APP_HOST) {
      return res.redirect(`${process.env.APP_URL}${req.originalUrl}`);
    }

    const now   = Date.now();
    const state = crypto.randomBytes(16).toString("hex");
    // Página para voltar depois do login (ex.: /planos/dev_pro/assinar),
    // vinda do ?next= da tela de login. Só paths internos.
    const next = safeNextPath(req.query.next);
    req.session.oauthStates = [
      ...pendingLogins(req.session, now),
      { state, next, exp: now + OAUTH_STATE_TTL_MS },
    ].slice(-OAUTH_MAX_PENDING);
    delete req.session.oauthState; // formato antigo (um state só)
    delete req.session.oauthNext;

    const url =
      `https://github.com/login/oauth/authorize` +
      `?client_id=${process.env.GITHUB_CLIENT_ID}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&scope=read:user,user:email,public_repo` +
      `&state=${state}`;
    res.redirect(url);
  },

  githubCallback: async (req, res) => {
    const { code, state } = req.query;
    if (!code) return res.redirect("/login?error=auth_failed");

    const pending = pendingLogins(req.session, Date.now());
    const login = typeof state === "string" ? pending.find(p => p.state === state) : undefined;
    const rest = pending.filter(p => p !== login); // state é de uso único
    if (rest.length) req.session.oauthStates = rest;
    else delete req.session.oauthStates;

    if (!login) {
      const motivo = !state
        ? "o GitHub voltou sem o parâmetro state"
        : !pending.length
          ? "não há login com GitHub em andamento nesta sessão (expirou, ou o cookie da sessão não voltou junto)"
          : "o state não corresponde a nenhum login em andamento nesta sessão";
      console.warn(`[github-oauth] Login recusado: ${motivo}.`);
      return res.redirect("/login?error=invalid_state");
    }

    try {
      const tokenResponse = await axios.post(
        "https://github.com/login/oauth/access_token",
        {
          client_id:     process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri:  REDIRECT_URI,
        },
        { headers: { Accept: "application/json" } }
      );

      const accessToken = tokenResponse.data.access_token;
      if (!accessToken) {
        console.error(
          "[github-oauth] token exchange falhou:",
          tokenResponse.data,
          { client_id: process.env.GITHUB_CLIENT_ID, redirect_uri: REDIRECT_URI }
        );
        return res.redirect("/login?error=token_failed");
      }

      const { data: githubUser } = await axios.get("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const { data: repos } = await axios.get(
        "https://api.github.com/user/repos?sort=updated&per_page=30&affiliation=owner",
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      const emailToUse = githubUser.email || `${githubUser.login}@users.noreply.github.com`;

      let [existingUsers] = await db.query("SELECT id, type, active FROM users WHERE email = ?", [emailToUse]);
      let internalId;

      if (existingUsers.length > 0) {
        // Esse e-mail já pertence a uma conta empresa — não hijackar a
        // conta para uma sessão "dev". Login com GitHub só serve dev.
        if (existingUsers[0].type !== "dev") {
          return res.redirect("/login?error=email_in_use_company");
        }
        if (!existingUsers[0].active) {
          return res.redirect("/login?error=account_suspended");
        }
        internalId = existingUsers[0].id;
      } else {
        const [result] = await db.query(
          "INSERT INTO users (email, type) VALUES (?, 'dev')",
          [emailToUse]
        );
        internalId = result.insertId;
      }

      await db.query(`
        INSERT INTO user_dev_profiles (user_id, nome, github_login, github_id, nivel)
        VALUES (?, ?, ?, ?, 'iniciante')
        ON DUPLICATE KEY UPDATE
          github_login = VALUES(github_login),
          github_id    = VALUES(github_id)
      `, [internalId, githubUser.name || githubUser.login, githubUser.login, githubUser.id]);

      const [devProfiles] = await db.query(
        "SELECT nivel, avatar_url FROM user_dev_profiles WHERE user_id = ?",
        [internalId]
      );
      const devProfile = devProfiles[0] ?? {};

      // Fire-and-forget: falha aqui não deve bloquear o login. Roda depois de
      // conhecer o usuário interno para usar os repositórios que ele importou
      // em /repositorios (se houver) em vez dos 30 mais recentes.
      matchSkillsFromGitHub(accessToken, githubUser.id, repos, { userId: internalId }).catch(err => {
        console.error("[github-analyzer]", err.message);
      });

      // Decisão de produto: o mentor de carreira nunca continua a conversa
      // de uma sessão anterior — todo login começa do zero. Fire-and-forget
      // (mesmo padrão de matchSkillsFromGitHub acima): não bloqueia o login
      // se isso falhar, só loga o erro.
      clearMentorHistory(internalId).catch(err => {
        console.error("[mentor-history]", err.message);
      });

      req.session.user = {
        id:          internalId,
        github_id:   githubUser.id,
        type:        "dev",
        name:        githubUser.name || githubUser.login,
        login:       githubUser.login,
        email:       emailToUse,
        avatar:      devProfile.avatar_url ?? githubUser.avatar_url,
        nivel:       devProfile.nivel ?? "iniciante",
        bio:         githubUser.bio,
        publicRepos: githubUser.public_repos,
        followers:   githubUser.followers,
        following:   githubUser.following,
        githubUrl:   githubUser.html_url,
        accessToken,
        repos: repos.map(repo => ({
          name:        repo.name,
          full_name:   repo.full_name,
          description: repo.description,
          language:    repo.language,
          stars:       repo.stargazers_count,
          forks:       repo.forks_count,
          url:         repo.html_url,
          updatedAt:   repo.updated_at,
        })),
      };

      res.redirect(safeNextPath(login.next) ?? "/dashboard");
    } catch (error) {
      console.error("Erro no callback:", error.message);
      res.redirect("/login?error=server_error");
    }
  },

  logout: (req, res) => {
    req.session.destroy((err) => {
      if (err) console.error("[logout] Erro ao destruir sessão:", err.message);
      res.redirect("/");
    });
  },
};

module.exports = authController;
 