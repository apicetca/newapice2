const axios = require("axios");
const db    = require("../database/db");
const { matchSkillsFromGitHub } = require("../services/githubAnalyzer");

// Guarda accessTokens em memória (nunca persistidos no banco de sessões)
const tokenStore = new Map();

const authController = {
  githubLogin: (req, res) => {
    const url =
      `https://github.com/login/oauth/authorize` +
      `?client_id=${process.env.GITHUB_CLIENT_ID}` +
      `&scope=read:user,user:email,public_repo`;
    res.redirect(url);
  },

  githubCallback: async (req, res) => {
    const { code } = req.query;
    if (!code) return res.redirect("/login?error=auth_failed");

    try {
      const tokenResponse = await axios.post(
        "https://github.com/login/oauth/access_token",
        {
          client_id:     process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code,
        },
        { headers: { Accept: "application/json" } }
      );

      const accessToken = tokenResponse.data.access_token;
      if (!accessToken) return res.redirect("/login?error=token_failed");

      const { data: githubUser } = await axios.get("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const { data: repos } = await axios.get(
        "https://api.github.com/user/repos?sort=updated&per_page=30",
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      await matchSkillsFromGitHub(accessToken, githubUser.id, repos);

      const emailToUse = githubUser.email || `${githubUser.login}@users.noreply.github.com`;

      let [existingUsers] = await db.query("SELECT id FROM users WHERE email = ?", [emailToUse]);
      let internalId;

      if (existingUsers.length > 0) {
        internalId = existingUsers[0].id;
      } else {
        const [result] = await db.query(
          "INSERT INTO users (email, type) VALUES (?, 'dev')",
          [emailToUse]
        );
        internalId = result.insertId;
      }

      await db.query(`
        INSERT INTO user_dev_profiles (user_id, nome, github_login, nivel)
        VALUES (?, ?, ?, 'iniciante')
        ON DUPLICATE KEY UPDATE github_login = VALUES(github_login)
      `, [internalId, githubUser.name || githubUser.login, githubUser.login]);

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
        repos: repos.slice(0, 12).map(repo => ({
          name:        repo.name,
          description: repo.description,
          language:    repo.language,
          stars:       repo.stargazers_count,
          url:         repo.html_url,
        })),
      };

      // Guarda token fora da sessão persistida
      req.session.save((err) => {
        if (!err) tokenStore.set(req.session.id, accessToken);
      });

      res.redirect("/dashboard");
    } catch (error) {
      console.error("Erro no callback:", error.message);
      res.redirect("/login?error=server_error");
    }
  },

  logout: (req, res) => {
    const sid = req.session.id;
    req.session.destroy((err) => {
      if (err) console.error("Erro ao destruir sessão:", err);
      tokenStore.delete(sid);
      res.redirect("/");
    });
  },

  getTokenStore: () => tokenStore,
};

module.exports = authController;
 