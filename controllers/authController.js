const axios  = require("axios");
const crypto = require("crypto");
const db     = require("../database/db");
const { matchSkillsFromGitHub } = require("../services/githubAnalyzer");

// APP_URL é validada em server.js na subida do processo — aqui já é garantida.
const GITHUB_CALLBACK_PATH = "/auth/github/callback";
const REDIRECT_URI = `${process.env.APP_URL}${GITHUB_CALLBACK_PATH}`;

const authController = {
  githubLogin: (req, res) => {
    const state = crypto.randomBytes(16).toString("hex");
    req.session.oauthState = state;

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

    const expectedState = req.session.oauthState;
    delete req.session.oauthState;
    if (!state || !expectedState || state !== expectedState) {
      console.error("[github-oauth] state inválido ou ausente no callback");
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
        "https://api.github.com/user/repos?sort=updated&per_page=30",
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      // Fire-and-forget: falha aqui não deve bloquear o login
      matchSkillsFromGitHub(accessToken, githubUser.id, repos).catch(err => {
        console.error("[github-analyzer]", err.message);
      });

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

      res.redirect("/dashboard");
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
 